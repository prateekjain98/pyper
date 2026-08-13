// Spaces domain, migrated off better-sqlite3 onto Convex.
//
// The Electron main process still calls these methods SYNCHRONOUSLY and expects
// the exact same return shapes the SQLite DatabaseManager produced. We satisfy
// that by keeping an in-memory cache of the `spaces` rows: reads are served
// synchronously from memory, writes mutate memory synchronously (so a
// read-after-write is consistent) and additionally fire a best-effort async
// Convex mutation that is never awaited and never allowed to throw.
//
// Field/return-shape parity is with apps/desktop/src/helpers/database.js
// (getPrivateSpaceId / getSpaces / getSpace / updateSpace / setSpaceSyncStatus /
// getSpaceByCloudSpaceId / upsertSpaceFromCloud / purgeSpace) and the row layout
// of the `spaces` table declared there.
//
// Convex mapping notes:
//   - The private ("Personal") space is a LOCAL-ONLY construct — Convex only
//     models shared TEAM spaces (see convex/spaces.ts). We synthesize it in
//     memory so getPrivateSpaceId() is always valid, exactly like the SQLite
//     seed row. It is never pushed to Convex.
//   - Team spaces are mirrored FROM Convex (`spaces.list`) into memory on load()
//     and via upsertSpaceFromCloud(); the local numeric `id` is client-side, the
//     Convex `_id` string lives on `cloud_space_id`.
//   - The only user mutation that maps to a Convex write is updateSpace() ->
//     `spaces.update`. setSpaceSyncStatus (local bookkeeping), upsertSpaceFromCloud
//     (inbound mirror) and purgeSpace (local cache eviction) are memory-only by
//     design — see each method.

const { randomUUID } = require("crypto");
const { anyApi } = require("convex/server");

const PRIVATE_KIND = "private";
const TEAM_KIND = "team";

class SpacesStore {
  /**
   * @param {import("convex/browser").ConvexHttpClient | null} client Shared
   *   Convex HTTP client (created in ./client.js). May be null — then the store
   *   operates purely in-memory and never touches Convex.
   */
  constructor(client) {
    this.client = client || null;
    // local numeric id -> full row object (teams stored as a parsed array)
    this.spaces = new Map();
    this._nextId = 1;
    // A private space must always exist: getPrivateSpaceId() is relied on by the
    // notes/folders paths and must never return null before load() runs.
    this._ensurePrivateSpace();
  }

  // ─── Cache load ────────────────────────────────────────────────────────────

  // Populate the cache from Convex. Safe to call more than once (team rows are
  // matched by cloud_space_id, so repeats update in place instead of forking).
  async load() {
    this._ensurePrivateSpace();
    if (!this.client) return;
    let cloudSpaces;
    try {
      cloudSpaces = await this.client.query(anyApi.spaces.list, {});
    } catch (err) {
      console.warn("[SpacesStore] load: spaces.list query failed:", err?.message || err);
      return;
    }
    if (!Array.isArray(cloudSpaces)) return;
    for (const cloud of cloudSpaces) {
      // Reuse the inbound-mirror path so load() and a later sync pull agree.
      this.upsertSpaceFromCloud(cloud);
    }
  }

  // ─── Public API (parity with database.js) ──────────────────────────────────

  getPrivateSpaceId() {
    for (const row of this.spaces.values()) {
      if (row.kind === PRIVATE_KIND) return row.id;
    }
    return null;
  }

  getSpaces() {
    const rows = [...this.spaces.values()].filter((r) => !r.deleted_at);
    // Mirrors: ORDER BY (kind='private' first), sort_order ASC, name ASC.
    rows.sort((a, b) => {
      const ap = a.kind === PRIVATE_KIND ? 0 : 1;
      const bp = b.kind === PRIVATE_KIND ? 0 : 1;
      if (ap !== bp) return ap - bp;
      const ao = typeof a.sort_order === "number" ? a.sort_order : 0;
      const bo = typeof b.sort_order === "number" ? b.sort_order : 0;
      if (ao !== bo) return ao - bo;
      return this._compareName(a.name, b.name);
    });
    return rows.map((r) => this._clone(r));
  }

  getSpace(id) {
    const row = this._get(id);
    if (!row || row.deleted_at) return null;
    return this._clone(row);
  }

  updateSpace(id, { name, emoji } = {}) {
    const space = this._get(id);
    if (!space) return { success: false, error: "Space not found" };

    const patch = {};
    if (name !== undefined) {
      if (space.kind === PRIVATE_KIND) {
        return { success: false, error: "Cannot rename the private space" };
      }
      const trimmed = (name || "").trim();
      if (!trimmed) return { success: false, error: "Space name is required" };
      patch.name = trimmed;
    }
    if (emoji !== undefined) {
      patch.emoji = emoji;
    }
    if (Object.keys(patch).length === 0) return { success: false };

    // Write-through: memory first (sync, consistent read-after-write) …
    Object.assign(space, patch, {
      sync_status: "pending",
      updated_at: new Date().toISOString(),
    });
    // … then a best-effort Convex mutation (only for cloud-backed team spaces).
    if (space.cloud_space_id) {
      const input = {};
      if (patch.name !== undefined) input.name = patch.name;
      if (patch.emoji !== undefined) input.emoji = patch.emoji;
      this._fireMutation(
        anyApi.spaces.update,
        { id: space.cloud_space_id, input },
        "updateSpace"
      );
    }
    return { success: true, space: this._clone(space) };
  }

  // Local sync-bookkeeping only — Convex has no `sync_status` column, so this is
  // deliberately memory-only (no write-through).
  setSpaceSyncStatus(id, status) {
    const space = this._get(id);
    const success = !!(space && !space.deleted_at);
    if (success) space.sync_status = status;
    return { success, space: success ? this.getSpace(id) : null };
  }

  getSpaceByCloudSpaceId(cloudSpaceId) {
    // SQL `WHERE cloud_space_id = NULL` never matches, so a nullish arg must
    // return null — and must NOT match the local-only private space (whose
    // cloud_space_id is null) or any not-yet-mirrored team row.
    if (cloudSpaceId == null) return null;
    for (const row of this.spaces.values()) {
      if (row.cloud_space_id === cloudSpaceId) return this._clone(row);
    }
    return null;
  }

  // Inbound mirror: cloud space -> local cache. The data already lives in Convex
  // (this is called from load() and from a sync pull), so this is memory-only —
  // writing it back would be circular.
  upsertSpaceFromCloud(space) {
    const updatedAt = space.updated_at || space.created_at || new Date().toISOString();
    const teams = Array.isArray(space.teams) ? space.teams : [];

    let existing = null;
    for (const row of this.spaces.values()) {
      if (row.cloud_space_id === space.id) {
        existing = row;
        break;
      }
    }
    if (!existing && teams.length === 1) {
      // Adopt a pre-spaces row backfilled from a single legacy team, keeping the
      // local id alive for chats / vector payloads / tree state.
      for (const row of this.spaces.values()) {
        if (row.cloud_space_id == null && row.cloud_team_id === teams[0].id) {
          existing = row;
          break;
        }
      }
    }

    if (existing) {
      existing.cloud_space_id = space.id;
      existing.workspace_id = space.workspace_id ?? null;
      existing.name = space.name;
      existing.emoji = space.emoji ?? null;
      existing.my_role = space.my_role ?? null;
      existing.member_count = space.member_count ?? null;
      existing.teams = teams.slice();
      existing.deleted_at = null;
      existing.updated_at = updatedAt;
      return this._clone(existing);
    }

    // New team space: 'pending' skeleton until any content backfill completes
    // (updates never touch sync_status, matching the SQLite version).
    let maxOrder = 0;
    for (const row of this.spaces.values()) {
      if (typeof row.sort_order === "number" && row.sort_order > maxOrder) {
        maxOrder = row.sort_order;
      }
    }
    const id = this._allocId();
    const row = {
      id,
      client_space_id: randomUUID(),
      cloud_team_id: null,
      cloud_space_id: space.id,
      workspace_id: space.workspace_id ?? null,
      kind: TEAM_KIND,
      name: space.name,
      emoji: space.emoji ?? null,
      sort_order: maxOrder + 1,
      my_role: space.my_role ?? null,
      member_count: space.member_count ?? null,
      teams: teams.slice(),
      sync_status: "pending",
      deleted_at: null,
      created_at: space.created_at || updatedAt,
      updated_at: updatedAt,
    };
    this.spaces.set(id, row);
    return this._clone(row);
  }

  purgeSpace(localSpaceId, options = {}) {
    const mode = options?.mode ?? "preserve-dirty";
    if (mode !== "preserve-dirty" && mode !== "destructive") {
      return { success: false, error: "Invalid purge mode" };
    }
    const space = this._get(localSpaceId);
    if (!space) return { success: false, error: "Space not found" };
    if (space.kind === PRIVATE_KIND) {
      return { success: false, error: "Cannot purge the private space" };
    }

    // Evict the space row from the in-memory cache. This is intentionally
    // memory-only: purgeSpace runs on space REVOCATION (the caller is no longer a
    // member, so a Convex `spaces.remove` would be forbidden) or on destructive
    // ACCOUNT-reset cleanup (which must not delete a still-shared cloud space).
    //
    // NOTE: the original SQLite purgeSpace also cascades across
    // notes/folders/conversations/speaker rows and relocates dirty notes to
    // Personal. Those entities live in their own stores (this store owns only
    // `spaces`), so that cross-entity cascade is orchestrated by the caller
    // against the notes/folders stores — it is not reproduced here. The
    // cross-entity result fields are therefore returned empty.
    this.spaces.delete(space.id);
    return {
      success: true,
      noteIds: [],
      folderNames: [],
      spaceId: localSpaceId,
      relocatedNotes: [],
      relocatedCount: 0,
      relocatedTitles: [],
    };
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  _allocId() {
    const id = this._nextId;
    this._nextId = id + 1;
    return id;
  }

  _ensurePrivateSpace() {
    for (const row of this.spaces.values()) {
      if (row.kind === PRIVATE_KIND) return row;
    }
    const now = new Date().toISOString();
    const id = this._allocId();
    const row = {
      id,
      client_space_id: randomUUID(),
      cloud_team_id: null,
      cloud_space_id: null,
      workspace_id: null,
      kind: PRIVATE_KIND,
      name: "Personal",
      emoji: null,
      sort_order: 0,
      my_role: null,
      member_count: null,
      teams: [],
      sync_status: "synced",
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };
    this.spaces.set(id, row);
    return row;
  }

  // Look up by numeric id, tolerating a numeric-string id from IPC callers.
  _get(id) {
    if (this.spaces.has(id)) return this.spaces.get(id);
    const n = Number(id);
    if (!Number.isNaN(n) && this.spaces.has(n)) return this.spaces.get(n);
    return null;
  }

  // Return a defensive copy so callers can't mutate the cache; teams is copied
  // to an array to match database.js's `_spaceRow` (teams is always an array).
  _clone(row) {
    return { ...row, teams: Array.isArray(row.teams) ? row.teams.slice() : [] };
  }

  // Match SQLite's default BINARY collation (code-unit order) for `name ASC`.
  _compareName(a, b) {
    const as = a == null ? "" : String(a);
    const bs = b == null ? "" : String(b);
    if (as < bs) return -1;
    if (as > bs) return 1;
    return 0;
  }

  // Fire a Convex mutation without awaiting; never throw from a write path just
  // because Convex is unavailable.
  _fireMutation(fnRef, args, label) {
    if (!this.client) return;
    try {
      const p = this.client.mutation(fnRef, args);
      if (p && typeof p.catch === "function") {
        p.catch((err) =>
          console.warn(`[SpacesStore] ${label} write-through failed:`, err?.message || err)
        );
      }
    } catch (err) {
      console.warn(`[SpacesStore] ${label} write-through threw:`, err?.message || err);
    }
  }
}

module.exports = { SpacesStore };
