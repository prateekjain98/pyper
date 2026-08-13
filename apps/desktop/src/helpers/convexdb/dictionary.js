// Custom-dictionary domain, migrated off SQLite onto Convex.
//
// The Electron main process still calls these methods SYNCHRONOUSLY and expects
// the exact same return shapes the SQLite DatabaseManager produced for the
// `custom_dictionary` table. We satisfy that by keeping an in-memory cache of the
// dictionary rows: reads are served synchronously from memory, writes mutate
// memory synchronously (so a read-after-write is consistent) and additionally
// fire a best-effort async Convex mutation that is never awaited and never
// allowed to throw.
//
// Parity target — apps/desktop/src/helpers/database.js:
//   getDictionary / applyDictionaryChanges / setDictionary / getPendingDictionary /
//   getPendingDictionaryDeletes / hardDeleteDictionaryEntry /
//   getDictionaryEntryByClientId / upsertDictionaryFromCloud /
//   markDictionaryEntrySynced / clearDictionaryCloudId
// and the full row layout of the `custom_dictionary` table declared there:
//   { id, word, created_at, client_dict_id, cloud_id, source, sync_status,
//     deleted_at, updated_at }
//   - id:          local numeric AUTOINCREMENT (client-side, via _allocId)
//   - cloud_id:    the Convex document `_id` string (null until known)
//   - source:      'manual' | 'learned'
//   - sync_status: 'pending' | 'synced'
// The private write helpers (_normalizeDictionaryWords / _dictionaryRows /
// _upsertDictionaryWord / _deleteDictionaryRow) and their exact rules are ported
// verbatim so the whole-list (setDictionary) and delta (applyDictionaryChanges)
// paths cannot drift apart, matching the original.
//
// Convex mapping (convex/dictionary.ts):
//   - load() pulls `dictionary.list` (already deleted-filtered, updated_at desc)
//     and folds each row in through upsertDictionaryFromCloud — the same inbound
//     mirror a later sync pull uses — so the cloud `id` (= doc `_id`) lands on the
//     local `cloud_id` column and a fresh local numeric `id` is allocated.
//   - A word ADD / RESTORE / rename / source-promote maps to `dictionary.create`,
//     whose server-side upsert keys on `client_dict_id` (insert-or-patch word +
//     source, clear deleted_at, bump updated_at). One fire per REAL change; an
//     unchanged word fires nothing, mirroring the SQLite `word != ?` guard.
//     `dictionary.update` (patch by cloud `_id`) is intentionally unused — the
//     client_dict_id upsert subsumes it and needs no round-tripped `_id`.
//   - A word DELETE maps to `dictionary.remove({ id: cloud_id })` — but only when
//     we already hold the cloud `_id` (see GAPs).
//
// GAPs (memory-only — no faithful Convex write):
//   * markDictionaryEntrySynced / clearDictionaryCloudId — local sync-bookkeeping
//     over `sync_status` / `cloud_id`, which Convex does not model. Memory-only,
//     exactly like SpacesStore.setSpaceSyncStatus.
//   * upsertDictionaryFromCloud — inbound mirror; the data already lives in Convex,
//     so writing it back would be circular. Memory-only (matches SpacesStore).
//   * hardDeleteDictionaryEntry — local cache eviction by numeric id (the SQLite
//     version is a bare local DELETE with no cloud write). Memory-only.
//   * getPendingDictionary / getPendingDictionaryDeletes — reads that fed the old
//     pull/push SyncService. Reproduced as faithful sync reads (exact same row
//     shape); with eager write-through they are largely vestigial.
//   * DELETE of a row added THIS session whose cloud `_id` we never learned
//     (cloud_id still null): evicted from memory only. Convex exposes remove by
//     `_id` only, and the `dictionary.create` write-through is fire-and-forget, so
//     the adapter never learns the `_id` to tombstone. Mirrors the SQLite
//     hard-delete-when-cloud_id-null branch (which likewise writes nothing to the
//     cloud); the only divergence is that our eager create may already have
//     inserted the cloud row.
//
// Note: local write timestamps use ISO-8601 (`new Date().toISOString()`) to match
// the canonical SpacesStore adapter and Convex's string date columns, rather than
// SQLite's `datetime('now')` "YYYY-MM-DD HH:MM:SS" format. Keys / types / ordering
// of every return shape are otherwise unchanged.

const { randomUUID } = require("crypto");
const { anyApi } = require("convex/server");

class DictionaryStore {
  /**
   * @param {import("convex/browser").ConvexHttpClient | null} client Shared
   *   Convex HTTP client (created in ./client.js). May be null — then the store
   *   operates purely in-memory and never touches Convex.
   */
  constructor(client) {
    this.client = client || null;
    // local numeric id -> full row object
    this.words = new Map();
    this._nextId = 1;
  }

  // ─── Cache load ────────────────────────────────────────────────────────────

  // Populate the cache from Convex. Safe to call more than once (rows are matched
  // by client_dict_id / cloud_id, so repeats update in place instead of forking).
  async load() {
    if (!this.client) return;
    let cloudRows;
    try {
      cloudRows = await this.client.query(anyApi.dictionary.list, {});
    } catch (err) {
      console.warn(
        "[DictionaryStore] load: dictionary.list query failed:",
        err?.message || err
      );
      return;
    }
    if (!Array.isArray(cloudRows)) return;
    for (const cloud of cloudRows) {
      // Reuse the inbound-mirror path so load() and a later sync pull agree.
      this.upsertDictionaryFromCloud(cloud);
    }
  }

  // ─── Public API (parity with database.js) ──────────────────────────────────

  // SELECT word ... WHERE deleted_at IS NULL ORDER BY id ASC  ->  string[]
  getDictionary() {
    return [...this.words.values()]
      .filter((r) => !r.deleted_at)
      .sort((a, b) => a.id - b.id)
      .map((r) => r.word);
  }

  // Add and/or remove specific words, leaving every other row untouched.
  // `source` tags additions ('manual' for user-typed, 'learned' for auto-learn).
  applyDictionaryChanges({ add = [], remove = [] } = {}, source = "manual") {
    const additions = this._normalizeDictionaryWords(add);
    const removals = this._normalizeDictionaryWords(remove);
    // A word on both sides is a rename to itself; adding wins.
    for (const lower of additions.keys()) removals.delete(lower);
    if (additions.size === 0 && removals.size === 0) {
      return { success: true, added: 0, removed: 0 };
    }

    const { byLower } = this._dictionaryRows();
    let added = 0;
    let removed = 0;

    for (const lower of removals.keys()) {
      if (this._deleteDictionaryRow(byLower.get(lower))) removed += 1;
    }
    for (const [lower, word] of additions) {
      if (this._upsertDictionaryWord(word, byLower.get(lower), source)) added += 1;
    }

    return { success: true, added, removed };
  }

  // Replace the entire dictionary: anything absent from `words` is deleted.
  // Diff-based so unchanged rows keep their source / created_at / cloud_id.
  setDictionary(words, sourceForNewWords = "manual") {
    const incomingByLower = this._normalizeDictionaryWords(words);
    const { rows, byLower } = this._dictionaryRows();

    for (const existing of rows) {
      if (incomingByLower.has(existing.word.toLowerCase())) continue;
      this._deleteDictionaryRow(existing);
    }
    for (const [lower, word] of incomingByLower) {
      this._upsertDictionaryWord(word, byLower.get(lower), sourceForNewWords);
    }

    return { success: true };
  }

  // SELECT * WHERE sync_status = 'pending' AND deleted_at IS NULL
  getPendingDictionary() {
    return [...this.words.values()]
      .filter((r) => r.sync_status === "pending" && !r.deleted_at)
      .map((r) => this._clone(r));
  }

  // SELECT * WHERE deleted_at IS NOT NULL AND cloud_id IS NOT NULL AND
  //              sync_status = 'pending'
  getPendingDictionaryDeletes() {
    return [...this.words.values()]
      .filter((r) => r.deleted_at && r.cloud_id != null && r.sync_status === "pending")
      .map((r) => this._clone(r));
  }

  // DELETE FROM custom_dictionary WHERE id = ?  ->  { success, id }
  // Local cache eviction only (the SQLite version is a bare DELETE, no cloud
  // write); see GAPs in the header.
  hardDeleteDictionaryEntry(id) {
    const row = this._get(id);
    if (row) this.words.delete(row.id);
    return { success: !!row, id };
  }

  // SELECT * WHERE client_dict_id = ?  ->  row | null
  getDictionaryEntryByClientId(clientDictId) {
    const row = this._findByClientId(clientDictId);
    return row ? this._clone(row) : null;
  }

  // Inbound mirror: cloud entry -> local cache. The data already lives in Convex
  // (called from load() and from a sync pull), so this is memory-only — writing
  // it back would be circular. Returns the resulting row, or null on a payload we
  // refuse to store (matching the SQLite guards exactly).
  upsertDictionaryFromCloud(cloudEntry) {
    // Reject incomplete payloads rather than corrupt a row with defaults.
    if (!cloudEntry || typeof cloudEntry !== "object") return null;
    if (typeof cloudEntry.id !== "string" || !cloudEntry.id) return null;

    const word = typeof cloudEntry.word === "string" ? cloudEntry.word.trim() : "";
    if (!word) return null;

    const clientDictId =
      typeof cloudEntry.client_dict_id === "string" && cloudEntry.client_dict_id
        ? cloudEntry.client_dict_id
        : randomUUID();
    const incomingSource = cloudEntry.source === "learned" ? "learned" : "manual";
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

    // Resolve the local row deterministically: client_dict_id, then cloud_id,
    // then lower(word) — first match wins, matching the SQLite LIMIT 1 lookups.
    const existing =
      this._findByClientId(clientDictId) ||
      this._findByCloudId(cloudEntry.id) ||
      this._findByLowerWord(word);

    if (existing) {
      // Manual is sticky — a pull never demotes a local manual row to learned.
      const mergedSource =
        existing.source === "manual" || incomingSource === "manual" ? "manual" : "learned";
      existing.cloud_id = cloudEntry.id;
      existing.client_dict_id = clientDictId;
      existing.word = word;
      existing.source = mergedSource;
      existing.sync_status = "synced";
      existing.deleted_at = null;
      existing.updated_at = updatedAt;
      // created_at is intentionally left untouched.
      return this._clone(existing);
    }

    const row = this._makeRow({
      word,
      source: incomingSource,
      client_dict_id: clientDictId,
      cloud_id: cloudEntry.id,
      sync_status: "synced",
      created_at: createdAt,
      updated_at: updatedAt,
    });
    this.words.set(row.id, row);
    return this._clone(row);
  }

  // Local sync-bookkeeping only — Convex models neither sync_status nor cloud_id.
  // UPDATE ... SET sync_status='synced', cloud_id=? WHERE id=? AND deleted_at IS NULL
  markDictionaryEntrySynced(id, cloudId) {
    const row = this._get(id);
    // Guard on deleted_at so a delete/tombstone that raced the push isn't flipped
    // back to 'synced' (which would strand the deletion); changes=0 signals that
    // race, exactly like the SQLite version.
    if (!row || row.deleted_at) return { success: false, changes: 0 };
    row.sync_status = "synced";
    row.cloud_id = cloudId;
    return { success: true, changes: 1 };
  }

  // Local sync-bookkeeping only. Clears cloud_id after a 404 so the next push
  // re-creates the row instead of retrying a dead reference.
  clearDictionaryCloudId(id) {
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

  // Build a full 9-column row applying the same defaults the SQLite schema does.
  _makeRow(fields) {
    const now = this._now();
    return {
      id: this._allocId(),
      word: fields.word,
      created_at: fields.created_at != null ? fields.created_at : now,
      client_dict_id:
        fields.client_dict_id != null ? fields.client_dict_id : randomUUID(),
      cloud_id: fields.cloud_id != null ? fields.cloud_id : null,
      source: fields.source != null ? fields.source : "manual",
      sync_status: fields.sync_status != null ? fields.sync_status : "pending",
      deleted_at: fields.deleted_at != null ? fields.deleted_at : null,
      updated_at: fields.updated_at != null ? fields.updated_at : now,
    };
  }

  // Look up by numeric id, tolerating a numeric-string id from IPC callers.
  _get(id) {
    if (this.words.has(id)) return this.words.get(id);
    const n = Number(id);
    if (!Number.isNaN(n) && this.words.has(n)) return this.words.get(n);
    return null;
  }

  // Return a defensive copy so callers can't mutate the cache.
  _clone(row) {
    return { ...row };
  }

  _findByClientId(clientDictId) {
    for (const row of this.words.values()) {
      if (row.client_dict_id === clientDictId) return row;
    }
    return null;
  }

  _findByCloudId(cloudId) {
    for (const row of this.words.values()) {
      if (row.cloud_id === cloudId) return row;
    }
    return null;
  }

  _findByLowerWord(word) {
    const lower = word.toLowerCase();
    for (const row of this.words.values()) {
      if (row.word.toLowerCase() === lower) return row;
    }
    return null;
  }

  // INSERT OR IGNORE collides on the case-sensitive UNIQUE(word); mirror that.
  _hasExactWord(word) {
    for (const row of this.words.values()) {
      if (row.word === word) return true;
    }
    return false;
  }

  // Dedupe by lower(word), keeping the first occurrence's casing, so no caller
  // can present two spellings of the same word to a write loop.
  _normalizeDictionaryWords(words) {
    const byLower = new Map();
    for (const raw of Array.isArray(words) ? words : []) {
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      if (!byLower.has(lower)) byLower.set(lower, trimmed);
    }
    return byLower;
  }

  // Snapshot of live row refs + a lower(word) -> row index (last occurrence wins,
  // matching the SQLite `new Map(rows.map(...))` build). Refs are live so the
  // upsert/delete helpers mutate the cache in place.
  _dictionaryRows() {
    const rows = [...this.words.values()];
    return { rows, byLower: new Map(rows.map((r) => [r.word.toLowerCase(), r])) };
  }

  // Returns true when the word became present (insert or restore), so callers can
  // report how many words they actually added rather than how many they asked for.
  _upsertDictionaryWord(word, existing, source) {
    if (!existing) {
      // INSERT OR IGNORE: a case-sensitive duplicate word is silently ignored.
      if (this._hasExactWord(word)) return false;
      const row = this._makeRow({ word, source, sync_status: "pending" });
      this.words.set(row.id, row);
      this._fireCreate(row);
      return true;
    }
    if (existing.deleted_at) {
      // Restore. source = CASE WHEN source='learned' AND ?='manual' THEN 'manual'
      //                       ELSE source END  (uses the pre-update source).
      const newSource =
        existing.source === "learned" && source === "manual" ? "manual" : existing.source;
      existing.deleted_at = null;
      existing.source = newSource;
      existing.word = word;
      existing.updated_at = this._now();
      existing.sync_status = "pending";
      this._fireCreate(existing);
      return true;
    }
    if (source === "manual" && existing.source === "learned") {
      // Promote a learned row to manual.
      existing.word = word;
      existing.source = "manual";
      existing.updated_at = this._now();
      existing.sync_status = "pending";
      this._fireCreate(existing);
      return false;
    }
    // updateWord, guarded on word != ? so an unchanged row keeps its sync_status.
    if (existing.word !== word) {
      existing.word = word;
      existing.updated_at = this._now();
      existing.sync_status = "pending";
      this._fireCreate(existing);
    }
    return false;
  }

  // Hard-delete (evict) when the row never reached the cloud, else tombstone so
  // the next push tells the server about the deletion. Returns true when a live
  // row was removed / tombstoned.
  _deleteDictionaryRow(existing) {
    if (!existing || existing.deleted_at) return false;
    if (existing.cloud_id == null) {
      // Never reached the cloud (as far as we know) — local eviction only.
      this.words.delete(existing.id);
      return true;
    }
    const now = this._now();
    existing.deleted_at = now;
    existing.updated_at = now;
    existing.sync_status = "pending";
    this._fireMutation(anyApi.dictionary.remove, { id: existing.cloud_id }, "deleteWord");
    return true;
  }

  // Write-through for an add / restore / rename / source-promote: one best-effort
  // `dictionary.create` (the server upserts by client_dict_id).
  _fireCreate(row) {
    this._fireMutation(
      anyApi.dictionary.create,
      {
        input: {
          client_dict_id: row.client_dict_id,
          word: row.word,
          source: row.source,
          created_at: row.created_at,
          updated_at: row.updated_at,
        },
      },
      "upsertWord"
    );
  }

  // Fire a Convex mutation without awaiting; never throw from a write path just
  // because Convex is unavailable.
  _fireMutation(fnRef, args, label) {
    if (!this.client) return;
    try {
      const p = this.client.mutation(fnRef, args);
      if (p && typeof p.catch === "function") {
        p.catch((err) =>
          console.warn(`[DictionaryStore] ${label} write-through failed:`, err?.message || err)
        );
      }
    } catch (err) {
      console.warn(`[DictionaryStore] ${label} write-through threw:`, err?.message || err);
    }
  }
}

module.exports = { DictionaryStore };
