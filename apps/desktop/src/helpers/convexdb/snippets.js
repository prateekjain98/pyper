// Snippets domain, migrated off SQLite onto Convex.
//
// The Electron main process still calls these methods SYNCHRONOUSLY and expects
// the exact same return shapes the SQLite DatabaseManager produced. We satisfy
// that by keeping an in-memory cache of the `snippets` rows: reads are served
// synchronously from memory, writes mutate memory synchronously (so a
// read-after-write is consistent) and additionally fire a best-effort async
// Convex mutation that is never awaited and never allowed to throw.
//
// Field/return-shape parity is with apps/desktop/src/helpers/database.js
// (getSnippets / setSnippets / getPendingSnippets / getPendingSnippetDeletes /
// hardDeleteSnippet / getSnippetForCloudMerge / upsertSnippetFromCloud /
// markSnippetSynced / clearSnippetCloudId) and the row layout of the `snippets`
// table declared there:
//   { id, trigger, replacement, client_snippet_id, cloud_id, sync_status,
//     deleted_at, created_at, updated_at }
//   - id                : local numeric autoincrement (client-side, via _allocId)
//   - cloud_id          : the Convex document `_id` string (null until mirrored)
//   - sync_status       : 'pending' | 'synced' (local bookkeeping; no Convex column)
//   - deleted_at        : ISO string tombstone marker, or null
//
// Convex mapping notes (see apps/desktop/convex/snippets.ts):
//   - snippets.list  (query)    -> seed / refresh the cache. Returns the
//       `toCloudSnippet` shape { id:_id, client_snippet_id, trigger, replacement,
//       deleted_at, created_at, updated_at, user_id } for NON-deleted rows only.
//       Mapped into a database.js row via upsertSnippetFromCloud() (cloud `id`
//       -> `cloud_id`, sync_status forced to 'synced').
//   - snippets.create (mutation) <- setSnippets() upsert path. Server-side
//       `upsert` matches by client_snippet_id, so one create call faithfully
//       covers insert + edit + restore of an active snippet.
//   - snippets.remove (mutation) <- setSnippets() tombstone path (soft delete),
//       keyed by the row's cloud_id.
//   - snippets.update exists server-side but is unused here: create/upsert keyed
//       by client_snippet_id already handles edits and doesn't require a cloud id
//       we may not have captured yet (writes are fire-and-forget, so a freshly
//       created row's cloud `_id` is not learned until the next load()).
//
// GAPs (intentional divergences, each flagged inline with `// GAP:`):
//   - getPendingSnippets / getPendingSnippetDeletes / markSnippetSynced /
//     clearSnippetCloudId / hardDeleteSnippet reproduce the local sync-bookkeeping
//     surface but have NO Convex write-through: Convex owns durability and has no
//     `sync_status` / `cloud_id` columns, so these stay memory-only.
//   - upsertSnippetFromCloud is an inbound mirror (data already lives in Convex) and
//     is therefore memory-only, matching the spaces.js precedent.
//   - Timestamps are written as ISO 8601 (`new Date().toISOString()`) throughout,
//     matching spaces.js. The SQLite original used `datetime('now')` (space-separated,
//     second precision) for local writes; consumers treat these as opaque strings.

const { randomUUID } = require("crypto");
const { anyApi } = require("convex/server");

// Mirrors MAX_SNIPPET_TRIGGER_LENGTH in database.js (and MAX_TRIGGER in convex/snippets.ts).
const MAX_SNIPPET_TRIGGER_LENGTH = 100;

class SnippetsStore {
  /**
   * @param {import("convex/browser").ConvexHttpClient | null} client Shared
   *   Convex HTTP client (created in ./client.js). May be null — then the store
   *   operates purely in-memory and never touches Convex.
   */
  constructor(client) {
    this.client = client || null;
    // local numeric id -> full row object
    this.snippets = new Map();
    this._nextId = 1;
  }

  // ─── Cache load ────────────────────────────────────────────────────────────

  // Populate the cache from Convex. Safe to call more than once (rows are matched
  // by client_snippet_id / cloud_id, so repeats update in place instead of forking).
  async load() {
    if (!this.client) return;
    let cloudSnippets;
    try {
      cloudSnippets = await this.client.query(anyApi.snippets.list, {});
    } catch (err) {
      console.warn("[SnippetsStore] load: snippets.list query failed:", err?.message || err);
      return;
    }
    if (!Array.isArray(cloudSnippets)) return;
    for (const cloud of cloudSnippets) {
      // Reuse the inbound-mirror path so load() and a later sync pull agree.
      this.upsertSnippetFromCloud(cloud);
    }
  }

  // ─── Public API (parity with database.js) ──────────────────────────────────

  // SELECT trigger, replacement FROM snippets WHERE deleted_at IS NULL ORDER BY id ASC
  // -> array of { trigger, replacement } (only those two columns).
  getSnippets() {
    return this._sortedRows()
      .filter((r) => !r.deleted_at)
      .map((r) => ({ trigger: r.trigger, replacement: r.replacement }));
  }

  // Bulk reconcile of the active snippet set. Mirrors database.js.setSnippets:
  // trims + de-dupes incoming by lowercased trigger (dropping empties and any
  // trigger longer than MAX_SNIPPET_TRIGGER_LENGTH), then diffs against the cache.
  setSnippets(snippets) {
    const incomingByLower = new Map();
    for (const raw of Array.isArray(snippets) ? snippets : []) {
      if (!raw || typeof raw !== "object") continue;
      const trigger = typeof raw.trigger === "string" ? raw.trigger.trim() : "";
      const replacement = typeof raw.replacement === "string" ? raw.replacement.trim() : "";
      if (!trigger || !replacement) continue;
      if (trigger.length > MAX_SNIPPET_TRIGGER_LENGTH) continue;
      const lower = trigger.toLowerCase();
      if (!incomingByLower.has(lower)) incomingByLower.set(lower, { trigger, replacement });
    }
    const cleaned = Array.from(incomingByLower.values());
    const incomingLower = new Set(incomingByLower.keys());

    // Snapshot the row references up front (we delete from the Map as we go).
    const existingRows = this._sortedRows();
    const existingByLower = new Map();
    for (const row of existingRows) {
      const lower = row.trigger.toLowerCase();
      const current = existingByLower.get(lower);
      if (!current || (current.deleted_at && !row.deleted_at)) existingByLower.set(lower, row);
    }

    // Best-effort Convex writes, collected while memory is mutated and fired last.
    const cloudRemovals = []; // cloud_id strings to soft-delete
    const cloudUpserts = []; // live rows to create/upsert by client_snippet_id

    // Deletion phase: drop active rows no longer present in the incoming set.
    // cloud_id === null  -> hard delete locally (never synced; no cloud write).
    // cloud_id !== null  -> tombstone locally + snippets.remove(cloud_id).
    for (const existing of existingRows) {
      if (incomingLower.has(existing.trigger.toLowerCase())) continue;
      if (existing.deleted_at) continue;
      if (existing.cloud_id == null) {
        this.snippets.delete(existing.id);
      } else {
        const now = this._now();
        existing.deleted_at = now;
        existing.updated_at = now;
        existing.sync_status = "pending";
        cloudRemovals.push(existing.cloud_id);
      }
    }

    // Upsert phase: restore / update / insert each cleaned incoming snippet.
    for (const snippet of cleaned) {
      const existing = existingByLower.get(snippet.trigger.toLowerCase());
      if (existing) {
        if (existing.deleted_at) {
          // Restore a tombstoned row in place.
          existing.deleted_at = null;
          existing.trigger = snippet.trigger;
          existing.replacement = snippet.replacement;
          existing.updated_at = this._now();
          existing.sync_status = "pending";
          cloudUpserts.push(existing);
        } else if (
          existing.trigger !== snippet.trigger ||
          existing.replacement !== snippet.replacement
        ) {
          // Update an active row only when it actually changed (matches the
          // SQL `WHERE trigger != ? OR replacement != ?` guard).
          existing.trigger = snippet.trigger;
          existing.replacement = snippet.replacement;
          existing.updated_at = this._now();
          existing.sync_status = "pending";
          cloudUpserts.push(existing);
        }
        continue;
      }
      // Brand-new snippet: allocate a local id + client_snippet_id.
      const now = this._now();
      const id = this._allocId();
      const row = {
        id,
        trigger: snippet.trigger,
        replacement: snippet.replacement,
        client_snippet_id: randomUUID(),
        cloud_id: null,
        sync_status: "pending",
        deleted_at: null,
        created_at: now,
        updated_at: now,
      };
      this.snippets.set(id, row);
      cloudUpserts.push(row);
    }

    // Memory is now consistent; fan out best-effort Convex writes.
    for (const cloudId of cloudRemovals) {
      this._fireMutation(anyApi.snippets.remove, { id: cloudId }, "setSnippets/remove");
    }
    for (const row of cloudUpserts) {
      this._fireMutation(
        anyApi.snippets.create,
        {
          input: {
            client_snippet_id: row.client_snippet_id,
            trigger: row.trigger,
            replacement: row.replacement,
          },
        },
        "setSnippets/upsert"
      );
    }

    return { success: true };
  }

  // GAP: memory-only. Local sync-queue read — Convex has no `sync_status` column,
  // and durability is owned by Convex, so there is nothing to write through.
  // SELECT * FROM snippets WHERE sync_status = 'pending' AND deleted_at IS NULL
  getPendingSnippets() {
    return this._sortedRows()
      .filter((r) => r.sync_status === "pending" && !r.deleted_at)
      .map((r) => this._clone(r));
  }

  // GAP: memory-only (see getPendingSnippets).
  // SELECT * FROM snippets WHERE deleted_at IS NOT NULL AND cloud_id IS NOT NULL
  //   AND sync_status = 'pending'
  getPendingSnippetDeletes() {
    return this._sortedRows()
      .filter((r) => r.deleted_at != null && r.cloud_id != null && r.sync_status === "pending")
      .map((r) => this._clone(r));
  }

  // GAP: memory-only. Local cache eviction used by the sync reconciler after a
  // cloud delete is confirmed; the Convex delete itself flows through
  // setSnippets()/snippets.remove, not here.
  // DELETE FROM snippets WHERE id = ?
  hardDeleteSnippet(id) {
    const row = this._get(id);
    if (!row) return { success: false, id };
    this.snippets.delete(row.id);
    return { success: true, id };
  }

  // Read-only lookup used to reconcile an inbound cloud snippet against local rows.
  // Match priority mirrors database.js exactly: client_snippet_id, then cloud_id,
  // then an active trigger (case-insensitive), then a tombstoned trigger.
  getSnippetForCloudMerge(cloudEntry) {
    const row = this._findForCloudMerge(cloudEntry);
    return row ? this._clone(row) : null;
  }

  // Inbound mirror: cloud snippet -> local cache. The data already lives in Convex
  // (this is called from load() and from a sync pull), so this is memory-only —
  // writing it back would be circular.
  upsertSnippetFromCloud(cloudEntry) {
    if (!cloudEntry || typeof cloudEntry !== "object") return null;
    if (typeof cloudEntry.id !== "string" || !cloudEntry.id) return null;

    const trigger = typeof cloudEntry.trigger === "string" ? cloudEntry.trigger.trim() : "";
    const replacement =
      typeof cloudEntry.replacement === "string" ? cloudEntry.replacement.trim() : "";
    if (!trigger || !replacement) return null;

    const clientSnippetId =
      typeof cloudEntry.client_snippet_id === "string" && cloudEntry.client_snippet_id
        ? cloudEntry.client_snippet_id
        : randomUUID();
    const updatedAt =
      typeof cloudEntry.updated_at === "string" && cloudEntry.updated_at
        ? cloudEntry.updated_at
        : typeof cloudEntry.created_at === "string" && cloudEntry.created_at
          ? cloudEntry.created_at
          : new Date().toISOString();
    const createdAt =
      typeof cloudEntry.created_at === "string" && cloudEntry.created_at
        ? cloudEntry.created_at
        : updatedAt;

    const existing = this._findForCloudMerge({
      ...cloudEntry,
      client_snippet_id: clientSnippetId,
      trigger,
    });

    if (existing) {
      // A different active row may already hold this trigger (cross-device
      // rename); it must yield first or two rows would share an active trigger.
      const lower = trigger.toLowerCase();
      let collidingActive = null;
      for (const row of this._sortedRows()) {
        if (row.id !== existing.id && !row.deleted_at && row.trigger.toLowerCase() === lower) {
          collidingActive = row;
          break;
        }
      }
      // Tombstone existing -> keep the active collider; else keep existing and
      // drop the stale collider.
      const target = existing.deleted_at && collidingActive ? collidingActive : existing;
      const orphanId =
        target.id === existing.id ? (collidingActive ? collidingActive.id : undefined) : existing.id;
      if (orphanId != null) {
        this.snippets.delete(orphanId);
      }
      target.cloud_id = cloudEntry.id;
      target.client_snippet_id = clientSnippetId;
      target.trigger = trigger;
      target.replacement = replacement;
      target.sync_status = "synced";
      target.deleted_at = null;
      target.updated_at = updatedAt;
      return this._clone(target);
    }

    const id = this._allocId();
    const row = {
      id,
      trigger,
      replacement,
      client_snippet_id: clientSnippetId,
      cloud_id: cloudEntry.id,
      sync_status: "synced",
      deleted_at: null,
      created_at: createdAt,
      updated_at: updatedAt,
    };
    this.snippets.set(id, row);
    return this._clone(row);
  }

  // GAP: memory-only. Push-ack bookkeeping — Convex has no `sync_status` column,
  // so this only reconciles the local cache. Guards mirror the SQL: skip when the
  // row is missing/deleted or when a user edit changed trigger/replacement between
  // the push and this ack (leaving it 'pending' to re-push).
  markSnippetSynced(
    id,
    cloudId,
    serverUpdatedAt = null,
    expectedTrigger = null,
    expectedReplacement = null
  ) {
    const row = this._get(id);
    let changes = 0;
    if (
      row &&
      !row.deleted_at &&
      (expectedTrigger == null || row.trigger === expectedTrigger) &&
      (expectedReplacement == null || row.replacement === expectedReplacement)
    ) {
      row.sync_status = "synced";
      row.cloud_id = cloudId;
      if (serverUpdatedAt != null) row.updated_at = serverUpdatedAt;
      changes = 1;
    }
    return { success: changes > 0, changes };
  }

  // GAP: memory-only. Local bookkeeping used to force a re-push; no Convex column
  // for cloud_id / sync_status to mutate.
  // UPDATE snippets SET cloud_id = NULL, sync_status = 'pending' WHERE id = ?
  clearSnippetCloudId(id) {
    const row = this._get(id);
    if (!row) return { success: false };
    row.cloud_id = null;
    row.sync_status = "pending";
    return { success: true };
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  _allocId() {
    const id = this._nextId;
    this._nextId = id + 1;
    return id;
  }

  _now() {
    return new Date().toISOString();
  }

  // Look up by numeric id, tolerating a numeric-string id from IPC callers.
  _get(id) {
    if (this.snippets.has(id)) return this.snippets.get(id);
    const n = Number(id);
    if (!Number.isNaN(n) && this.snippets.has(n)) return this.snippets.get(n);
    return null;
  }

  // Live row references, sorted by numeric id ASC (SQLite rowid order — the order
  // an un-ORDERed `SELECT *` and a `LIMIT 1` see).
  _sortedRows() {
    return [...this.snippets.values()].sort((a, b) => a.id - b.id);
  }

  // Return a defensive copy so callers can't mutate the cache.
  _clone(row) {
    return { ...row };
  }

  // Live-row variant of getSnippetForCloudMerge (used internally where the row is
  // then mutated). Returns the actual cache object, not a clone.
  _findForCloudMerge(cloudEntry) {
    if (!cloudEntry || typeof cloudEntry !== "object") return null;

    const clientSnippetId =
      typeof cloudEntry.client_snippet_id === "string" && cloudEntry.client_snippet_id
        ? cloudEntry.client_snippet_id
        : "";
    const rows = this._sortedRows();

    if (clientSnippetId) {
      for (const row of rows) {
        if (row.client_snippet_id === clientSnippetId) return row;
      }
    }

    if (typeof cloudEntry.id === "string" && cloudEntry.id) {
      for (const row of rows) {
        if (row.cloud_id === cloudEntry.id) return row;
      }
    }

    const trigger = typeof cloudEntry.trigger === "string" ? cloudEntry.trigger.trim() : "";
    if (!trigger) return null;
    const lower = trigger.toLowerCase();

    for (const row of rows) {
      if (row.trigger.toLowerCase() === lower && !row.deleted_at) return row;
    }
    for (const row of rows) {
      if (row.trigger.toLowerCase() === lower && row.deleted_at) return row;
    }
    return null;
  }

  // Fire a Convex mutation without awaiting; never throw from a write path just
  // because Convex is unavailable.
  _fireMutation(fnRef, args, label) {
    if (!this.client) return;
    try {
      const p = this.client.mutation(fnRef, args);
      if (p && typeof p.catch === "function") {
        p.catch((err) =>
          console.warn(`[SnippetsStore] ${label} write-through failed:`, err?.message || err)
        );
      }
    } catch (err) {
      console.warn(`[SnippetsStore] ${label} write-through threw:`, err?.message || err);
    }
  }
}

module.exports = { SnippetsStore };
