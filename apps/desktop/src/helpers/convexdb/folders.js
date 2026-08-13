// Folders domain, migrated off better-sqlite3 onto Convex.
//
// The Electron main process still calls these methods SYNCHRONOUSLY and expects
// the exact same return shapes the SQLite DatabaseManager produced. We satisfy
// that by keeping an in-memory cache of the `folders` rows: reads are served
// synchronously from memory, writes mutate memory synchronously (so a
// read-after-write is consistent) and additionally fire a best-effort async
// Convex mutation that is never awaited and never allowed to throw.
//
// Field/return-shape parity is with apps/desktop/src/helpers/database.js
// (getFolders / createFolder / deleteFolder / renameFolder / moveFolderToSpace /
// getFolderNoteCounts / getMeetingsFolder / getPendingFolders /
// getPendingFolderDeletes / restoreFolderAfterDeniedDelete / hardDeleteFolder /
// relocateRevokedFolder / getFolderByClientId / upsertFolderFromCloud /
// markFolderSynced / acknowledgeFolderCreate / markFolderSyncedIfUnchanged /
// forkFolderIdentity / getFolderIdMap) and the row layout of the `folders` table
// declared there:
//   id (local numeric, AUTOINCREMENT), name, is_default (0|1), sort_order,
//   created_at, updated_at, client_folder_id, cloud_id, sync_status, deleted_at,
//   space_id (LOCAL numeric space id | null), left_team (0|1).
//
// Convex mapping notes (see convex/folders.ts, convex/schema.ts):
//   - Convex `folders.list` returns owner-scoped LIVE folders as `toCloudFolder`
//     docs: { id (=_id), client_folder_id, name, is_default (boolean),
//     sort_order, workspace_id, space_id (CLOUD space _id string | null),
//     previous_space_id, deleted_at, created_at, updated_at }. We map each into a
//     database.js row on load(): cloud `id` -> `cloud_id`, `is_default` boolean
//     -> 0|1, sync_status -> 'synced', left_team -> 0, and allocate a client-side
//     numeric `id`. The Convex-only columns (workspace_id, previous_space_id) are
//     dropped — the local `folders` table never had them.
//   - space_id is the #1 cross-store impedance mismatch: database.js stores a
//     LOCAL numeric space id, while Convex stores a CLOUD space _id STRING (or
//     null for personal). This store does not own the spaces table, so it cannot
//     translate cloud<->local space ids on its own. Exactly like the SQLite
//     `upsertFolderFromCloud(cloudFolder, localSpaceId)`, the resolved LOCAL id is
//     supplied by the caller; when omitted we fall back to `this.privateSpaceId`
//     (a hint an orchestrator may set from SpacesStore.getPrivateSpaceId()).
//     See the // GAP: notes on load / moveFolderToSpace / createFolder for the
//     cloud-space-id write path.
//   - User mutations map to Convex writes: createFolder -> `folders.create`,
//     renameFolder -> `folders.update`, deleteFolder -> `folders.remove`,
//     moveFolderToSpace -> `folders.moveToSpace`. Each mutates memory FIRST, then
//     fires a best-effort mutation only when the row already carries a `cloud_id`
//     (nothing to PATCH/DELETE server-side before the create lands) — mirroring
//     SpacesStore.updateSpace only writing through for cloud-backed rows.
//   - The local sync-machinery methods (markFolderSynced, acknowledgeFolderCreate,
//     markFolderSyncedIfUnchanged, forkFolderIdentity, getPendingFolders,
//     getPendingFolderDeletes) and the inbound mirror (upsertFolderFromCloud) are
//     MEMORY-ONLY by design — they are local bookkeeping / inbound mirroring,
//     matching how SpacesStore treats setSpaceSyncStatus / upsertSpaceFromCloud.
//   - Cross-ENTITY cascades are GAPs. deleteFolder / hardDeleteFolder /
//     restoreFolderAfterDeniedDelete / relocateRevokedFolder / getFolderNoteCounts
//     in SQLite also touch notes / agent_conversations / speakers. Those rows live
//     in their own stores (this store owns only `folders`), so the cross-entity
//     effects are orchestrated by the caller and the cross-entity result fields
//     are returned EMPTY here (noteIds: [], notes: [], etc.) — the same contract
//     SpacesStore.purgeSpace documents. Each such method is tagged // GAP:.

const { randomUUID } = require("crypto");
const { anyApi } = require("convex/server");

// Must mirror FolderPushSnapshot / FOLDER_ACK_FIELDS in database.js: the exact
// set of fields an acknowledgement compares against the pushed snapshot.
const FOLDER_ACK_FIELDS = [
  "client_folder_id",
  "name",
  "is_default",
  "sort_order",
  "space_id",
  "created_at",
  "updated_at",
  "sync_status",
  "deleted_at",
  "left_team",
];

// Copied verbatim from database.js so acknowledgement semantics match: an absent
// snapshot field is treated as null, and every field must be strictly equal.
function rowMatchesSnapshot(row, snapshot, fields) {
  return fields.every((field) => {
    const expected = snapshot[field] === undefined ? null : snapshot[field];
    return row[field] === expected;
  });
}

class FoldersStore {
  /**
   * @param {import("convex/browser").ConvexHttpClient | null} client Shared
   *   Convex HTTP client (created in ./client.js). May be null — then the store
   *   operates purely in-memory and never touches Convex.
   */
  constructor(client) {
    this.client = client || null;
    // local numeric id -> full row object
    this.folders = new Map();
    this._nextId = 1;
    // Optional cross-store hint: the SpacesStore's private ("Personal") space
    // LOCAL id. database.js resolves this via getPrivateSpaceId(); this store
    // doesn't own the spaces table, so an orchestrator may assign it after
    // construction. Null is tolerated (folders then land with space_id = null
    // until reconciled). Kept off the constructor args so the signature stays
    // (client), identical to the other convexdb stores.
    this.privateSpaceId = null;
    // Folder-scoped optimistic-delete journal (the FOLDER entity rows of
    // SQLite's optimistic_folder_delete_rows). Note/conversation journal rows are
    // cross-entity and owned by their stores — see the GAPs on deleteFolder /
    // restoreFolderAfterDeniedDelete. Map: folder_id -> { original_sync_status,
    // original_deleted_at, original_updated_at }.
    this.folderDeleteJournal = new Map();
  }

  // ─── Cache load ────────────────────────────────────────────────────────────

  // Populate the cache from Convex. Safe to call more than once (rows are matched
  // by client_folder_id, so repeats update in place instead of forking).
  async load() {
    if (!this.client) return;
    let cloudFolders;
    try {
      cloudFolders = await this.client.query(anyApi.folders.list, {});
    } catch (err) {
      console.warn("[FoldersStore] load: folders.list query failed:", err?.message || err);
      return;
    }
    if (!Array.isArray(cloudFolders)) return;
    for (const cloud of cloudFolders) {
      // GAP: cloud.space_id is a CLOUD space _id string; without the SpacesStore
      // we cannot translate it to a LOCAL numeric space id. Reuse the inbound
      // mirror with localSpaceId omitted, so team folders fall back to
      // this.privateSpaceId (null when unset), exactly as the SQLite
      // upsertFolderFromCloud does when called without an explicit localSpaceId.
      // A caller that knows the mapping should re-run upsertFolderFromCloud with
      // the resolved localSpaceId.
      this.upsertFolderFromCloud(cloud);
    }
  }

  // ─── Public API: reads (parity with database.js) ────────────────────────────

  getFolders(spaceId = null) {
    const rows = [...this.folders.values()].filter((r) => {
      if (r.deleted_at) return false;
      if (spaceId != null && r.space_id !== spaceId) return false;
      return true;
    });
    // Mirrors: ORDER BY sort_order ASC, created_at ASC.
    rows.sort((a, b) => {
      const ao = typeof a.sort_order === "number" ? a.sort_order : 0;
      const bo = typeof b.sort_order === "number" ? b.sort_order : 0;
      if (ao !== bo) return ao - bo;
      return this._compareText(a.created_at, b.created_at);
    });
    return rows.map((r) => this._clone(r));
  }

  // Only the `id` column is selected in SQLite, so the shape is { id } | null.
  getMeetingsFolder(spaceId = null) {
    const target = spaceId ?? this.privateSpaceId;
    for (const row of this.folders.values()) {
      if (row.name === "Meetings" && row.is_default && row.space_id === target) {
        return { id: row.id };
      }
    }
    return null;
  }

  getFolderByClientId(clientFolderId) {
    for (const row of this.folders.values()) {
      if (row.client_folder_id === clientFolderId) return this._clone(row);
    }
    return null;
  }

  getFolderIdMap() {
    return [...this.folders.values()].filter((r) => !r.deleted_at).map((r) => this._clone(r));
  }

  // GAP: this counts NOTES per (space_id, folder_id). Notes live in their own
  // store, so without a notes cache we cannot produce counts. Returns the same
  // shape (array of { space_id, folder_id, count }) but empty — the caller
  // orchestrates the count against the notes store.
  getFolderNoteCounts() {
    return [];
  }

  getPendingFolders(spaceKind = null) {
    if (spaceKind != null) {
      // GAP: the SQLite query joins `spaces` and filters on `s.kind = ?` (plus a
      // left_team OR clause). We own only `folders`, so the space-kind predicate
      // is unresolvable here. We honor the parts we CAN evaluate — pending &
      // live, plus the left_team escape hatch — and leave kind filtering to the
      // caller. `left_team` is a folder column, so that clause is faithful.
      return [...this.folders.values()]
        .filter(
          (r) =>
            (r.sync_status === "pending" && !r.deleted_at) ||
            (r.left_team === 1 && r.cloud_id != null && !r.deleted_at)
        )
        .map((r) => this._clone(r));
    }
    return [...this.folders.values()]
      .filter((r) => r.sync_status === "pending" && !r.deleted_at)
      .map((r) => this._clone(r));
  }

  getPendingFolderDeletes() {
    return [...this.folders.values()]
      .filter(
        (r) =>
          r.deleted_at != null &&
          r.cloud_id != null &&
          (r.sync_status === "pending" || this.folderDeleteJournal.has(r.id))
      )
      .map((r) => this._clone(r));
  }

  // ─── Public API: user mutations (write-through to Convex) ───────────────────

  createFolder(name, spaceId = null) {
    const trimmed = (name || "").trim();
    if (!trimmed) return { success: false, error: "Folder name is required" };
    if (spaceId == null) spaceId = this.privateSpaceId;

    if (this._nameTaken(trimmed, spaceId, null)) {
      return { success: false, error: "A folder with that name already exists" };
    }

    // MAX(sort_order) over the space — SQLite does NOT filter deleted rows here.
    let maxOrder = 0;
    let seen = false;
    for (const row of this.folders.values()) {
      if (row.space_id === spaceId && typeof row.sort_order === "number") {
        if (!seen || row.sort_order > maxOrder) maxOrder = row.sort_order;
        seen = true;
      }
    }
    const sortOrder = (seen ? maxOrder : 0) + 1;

    const now = new Date().toISOString();
    const clientFolderId = randomUUID();
    const id = this._allocId();
    const row = {
      id,
      name: trimmed,
      is_default: 0,
      sort_order: sortOrder,
      created_at: now,
      updated_at: now,
      client_folder_id: clientFolderId,
      cloud_id: null,
      sync_status: "pending",
      deleted_at: null,
      space_id: spaceId ?? null,
      left_team: 0,
    };
    this.folders.set(id, row);

    // Write-through: fire `folders.create`. The Convex `space_id` must be a CLOUD
    // space _id string (or null for personal). We can only faithfully supply null
    // — for the private space, or when unspaced.
    const input = {
      client_folder_id: clientFolderId,
      name: trimmed,
      is_default: false,
      sort_order: sortOrder,
      created_at: now,
      updated_at: now,
    };
    if (spaceId == null || spaceId === this.privateSpaceId) {
      input.space_id = null;
    }
    // GAP: for a TEAM space we cannot resolve local -> cloud space id, so we omit
    // space_id (Convex defaults it to null = personal); a later moveToSpace with
    // the resolved cloud id corrects placement.
    this._fireMutation(anyApi.folders.create, { input }, "createFolder");

    return { success: true, folder: this._clone(row) };
  }

  renameFolder(id, name) {
    const folder = this._get(id);
    if (!folder || folder.deleted_at) return { success: false, error: "Folder not found" };
    if (folder.is_default) return { success: false, error: "Cannot rename default folders" };
    const trimmed = (name || "").trim();
    if (!trimmed) return { success: false, error: "Folder name is required" };
    if (this._nameTaken(trimmed, folder.space_id, id)) {
      return { success: false, error: "A folder with that name already exists" };
    }

    folder.name = trimmed;
    folder.sync_status = "pending";
    folder.updated_at = new Date().toISOString();

    if (folder.cloud_id) {
      this._fireMutation(
        anyApi.folders.update,
        { id: folder.cloud_id, input: { name: trimmed } },
        "renameFolder"
      );
    }
    return { success: true, folder: this._clone(folder) };
  }

  moveFolderToSpace(id, spaceId) {
    const folder = this._get(id);
    if (!folder || folder.deleted_at) return { success: false, error: "Folder not found" };
    if (folder.is_default) return { success: false, error: "Cannot move default folders" };
    // GAP: SQLite validates the target space exists (SELECT ... FROM spaces) and
    // reads old/new `kind` to compute `left_team`. We don't own spaces, so the
    // existence/kind checks are delegated to the caller; left_team can only be
    // set faithfully when moving OUT of a team, which we cannot detect here → 0.
    if (folder.space_id === spaceId) {
      return { success: true, folder: this._clone(folder), notes: [] };
    }
    if (this._nameTaken(folder.name, spaceId, id)) {
      return { success: false, error: "A folder with that name already exists" };
    }

    folder.space_id = spaceId;
    folder.sync_status = "pending";
    folder.updated_at = new Date().toISOString();
    folder.left_team = 0; // GAP: needs spaces.kind (old team -> private).

    // Write-through: `folders.moveToSpace` needs a CLOUD space id string or null.
    // We can only supply null (moving to the private/personal space). Moving into
    // a team needs a local->cloud id mapping we don't have.
    if (folder.cloud_id && (spaceId == null || spaceId === this.privateSpaceId)) {
      this._fireMutation(
        anyApi.folders.moveToSpace,
        { id: folder.cloud_id, space_id: null },
        "moveFolderToSpace"
      );
    }
    // GAP: notes cascade (a note's space follows its folder) is cross-entity;
    // the moved notes are orchestrated by the caller, so `notes` is empty.
    return { success: true, folder: this._clone(folder), notes: [] };
  }

  deleteFolder(id) {
    const folder = this._get(id);
    if (!folder || folder.deleted_at) return { success: false, error: "Folder not found" };
    if (folder.is_default) return { success: false, error: "Cannot delete default folders" };

    // GAP: noteIds is derived from live child notes (SELECT id FROM notes WHERE
    // folder_id = ? AND deleted_at IS NULL) and the child note/conversation/
    // speaker cascade is cross-entity. Both are orchestrated by the caller, so
    // noteIds is returned empty.
    const noteIds = [];

    if (!folder.cloud_id) {
      // No server row to delete — finalize locally (drop from cache). Child
      // content cleanup is the caller's job (cross-entity GAP).
      this.folders.delete(folder.id);
      return { success: true, id, noteIds };
    }

    // Journal the folder's pre-delete state so restoreFolderAfterDeniedDelete can
    // undo a server denial. (Note/conversation journal rows are cross-entity.)
    if (!this.folderDeleteJournal.has(folder.id)) {
      this.folderDeleteJournal.set(folder.id, {
        original_sync_status: folder.sync_status ?? "synced",
        original_deleted_at: folder.deleted_at ?? null,
        original_updated_at: folder.updated_at ?? null,
      });
    }
    const now = new Date().toISOString();
    folder.deleted_at = now;
    folder.sync_status = "pending";
    folder.updated_at = now;

    this._fireMutation(anyApi.folders.remove, { id: folder.cloud_id }, "deleteFolder");
    return { success: true, id, noteIds };
  }

  // ─── Public API: sync/cloud bookkeeping (memory-only) ───────────────────────

  // Inbound mirror: cloud folder -> local cache. The data already lives in Convex
  // (called from load() and from a sync pull), so this is memory-only — writing
  // it back would be circular. Mirrors the SQLite ON CONFLICT(client_folder_id)
  // upsert, including the same-space same-name convergence/fork fallback.
  upsertFolderFromCloud(cloudFolder, localSpaceId = null) {
    const spaceId = localSpaceId ?? this.privateSpaceId;
    const updatedAt = cloudFolder.updated_at || cloudFolder.created_at;
    const isDefault = cloudFolder.is_default ? 1 : 0;
    const sortOrder = cloudFolder.sort_order || 0;

    // Primary path: match by client_folder_id.
    let existing = null;
    for (const row of this.folders.values()) {
      if (row.client_folder_id === cloudFolder.client_folder_id) {
        existing = row;
        break;
      }
    }

    if (existing) {
      existing.cloud_id = cloudFolder.id;
      existing.name = cloudFolder.name;
      existing.sort_order = sortOrder;
      existing.space_id = spaceId ?? null;
      existing.sync_status = "synced";
      existing.left_team = 0;
      existing.updated_at = updatedAt;
      return this._clone(existing);
    }

    // A live same-named folder already occupies this space (the SQLite partial
    // unique index idx_folders_space_name). Converge onto it by adopting the
    // cloud identity instead of forking the pull.
    let collided = null;
    for (const row of this.folders.values()) {
      if (row.space_id === (spaceId ?? null) && row.name === cloudFolder.name && !row.deleted_at) {
        collided = row;
        break;
      }
    }
    if (collided) {
      // A different local row already tracked this cloud client id (rename
      // collision) — fork it so the winner can take the identity uniquely.
      for (const row of this.folders.values()) {
        if (row.client_folder_id === cloudFolder.client_folder_id && row.id !== collided.id) {
          this.forkFolderIdentity(row.id);
        }
      }
      collided.client_folder_id = cloudFolder.client_folder_id;
      collided.cloud_id = cloudFolder.id;
      collided.sort_order = sortOrder;
      collided.sync_status = "synced";
      collided.left_team = 0;
      collided.updated_at = updatedAt;
      return this._clone(collided);
    }

    // New folder row from cloud.
    const id = this._allocId();
    const row = {
      id,
      name: cloudFolder.name,
      is_default: isDefault,
      sort_order: sortOrder,
      created_at: cloudFolder.created_at,
      updated_at: updatedAt,
      client_folder_id: cloudFolder.client_folder_id,
      cloud_id: cloudFolder.id,
      sync_status: "synced",
      deleted_at: null,
      space_id: spaceId ?? null,
      left_team: 0,
    };
    this.folders.set(id, row);
    return this._clone(row);
  }

  markFolderSynced(id, cloudId) {
    const folder = this._get(id);
    if (folder) {
      folder.sync_status = "synced";
      folder.cloud_id = cloudId;
      folder.left_team = 0;
    }
    return { success: true };
  }

  // Guarded create-acknowledgement — settle a pending create only for the exact
  // identity that issued the request and only when every pushed field still
  // matches. Reproduces database.js.acknowledgeFolderCreate against the cache.
  acknowledgeFolderCreate(
    id,
    snapshot,
    expectedCloudId,
    responseClientFolderId,
    cloudId,
    cloudUpdatedAt = null
  ) {
    if (
      !snapshot?.client_folder_id ||
      (expectedCloudId !== null && typeof expectedCloudId !== "string") ||
      !responseClientFolderId ||
      !cloudId
    ) {
      return { success: false, outcome: "unresolved", changes: 0 };
    }

    const current = this._get(id);
    if (
      !current ||
      current.client_folder_id !== snapshot.client_folder_id ||
      current.cloud_id !== expectedCloudId
    ) {
      return { success: true, outcome: "identity-changed", changes: 0 };
    }
    if (expectedCloudId !== null && expectedCloudId !== cloudId) {
      return { success: true, outcome: "unresolved", changes: 0 };
    }
    for (const row of this.folders.values()) {
      if (row.client_folder_id === responseClientFolderId && row.id !== id) {
        return { success: true, outcome: "unresolved", changes: 0 };
      }
    }

    const unchanged = rowMatchesSnapshot(current, snapshot, FOLDER_ACK_FIELDS);
    const leftTeam = this._leftTeamDuringPush(snapshot.space_id, current.space_id);

    if (unchanged) {
      current.client_folder_id = responseClientFolderId;
      current.cloud_id = cloudId;
      current.sync_status = "synced";
      current.left_team = 0;
      if (cloudUpdatedAt != null) current.updated_at = cloudUpdatedAt;
      return { success: true, outcome: "synced", changes: 1 };
    }

    current.client_folder_id = responseClientFolderId;
    current.cloud_id = cloudId;
    current.sync_status = "pending";
    if (leftTeam === 1) current.left_team = 1;
    return { success: true, outcome: "pending", changes: 1 };
  }

  // Guarded PATCH-acknowledgement twin. Reproduces markFolderSyncedIfUnchanged.
  markFolderSyncedIfUnchanged(id, snapshot, expectedCloudId) {
    if (!snapshot?.client_folder_id || !expectedCloudId) {
      return { success: false, outcome: "identity-changed", changes: 0 };
    }
    const current = this._get(id);
    if (
      !current ||
      current.client_folder_id !== snapshot.client_folder_id ||
      current.cloud_id !== expectedCloudId
    ) {
      return { success: true, outcome: "identity-changed", changes: 0 };
    }
    const unchanged = rowMatchesSnapshot(current, snapshot, FOLDER_ACK_FIELDS);
    if (!unchanged) {
      return { success: true, outcome: "pending", changes: 0 };
    }
    current.sync_status = "synced";
    current.left_team = 0;
    return { success: true, outcome: "synced", changes: 1 };
  }

  forkFolderIdentity(id) {
    const folder = this._get(id);
    if (!folder) return { success: false };
    folder.client_folder_id = randomUUID();
    folder.cloud_id = null;
    folder.sync_status = "pending";
    folder.left_team = 0;
    return { success: true };
  }

  // ─── Public API: delete lifecycle (folder-side; cross-entity GAPs) ──────────

  // Undo a folder DELETE that the server denied. Restores the FOLDER row from the
  // journal. GAP: the note/conversation rows hidden by the same optimistic op are
  // cross-entity — their restore is orchestrated by the caller, so `notes` and
  // `conversationIds` are returned empty.
  restoreFolderAfterDeniedDelete(id) {
    const folderState = this.folderDeleteJournal.get(this._normId(id));
    if (!folderState) {
      return { success: false, id, error: "Folder delete rollback not found" };
    }
    const folder = this._get(id);
    if (!folder) {
      return { success: false, id, error: "Folder row is missing" };
    }
    // Name is available again only if no OTHER live folder took it meanwhile.
    for (const row of this.folders.values()) {
      if (
        row.id !== folder.id &&
        row.name === folder.name &&
        row.space_id === folder.space_id &&
        !row.deleted_at
      ) {
        return {
          success: false,
          id,
          reason: "name-taken",
          error: "Folder name is no longer available",
        };
      }
    }

    folder.deleted_at = folderState.original_deleted_at;
    folder.sync_status = folderState.original_sync_status;
    folder.updated_at = folderState.original_updated_at;
    this.folderDeleteJournal.delete(folder.id);

    return { success: true, id, folder: this._clone(folder), notes: [], conversationIds: [] };
  }

  // Finalize an optimistic folder delete (server confirmed). GAP: noteIds and the
  // note/conversation/speaker cascade are cross-entity and orchestrated by the
  // caller; only the folder row + its journal entry are removed here.
  hardDeleteFolder(id) {
    const folder = this._get(id);
    if (!folder) return { success: false, id, error: "Folder not found" };
    const name = folder.name ?? null;
    const noteIds = [];
    this.folders.delete(folder.id);
    this.folderDeleteJournal.delete(folder.id);
    return { success: true, id, noteIds, name };
  }

  // The folder's server row moved into a scope this user can no longer access.
  // Folder-side effects only. GAP: the dirty-note preservation / server-owned-
  // child deletion / conversation reparenting are all cross-entity and handled
  // by the caller, so relocatedNotes and deletedNoteIds are returned empty.
  relocateRevokedFolder(id, privateSpaceId, preserveFolder = false) {
    // If an optimistic delete is in flight, roll the folder back first so the
    // relocation classifies it from its real pre-delete state.
    if (this.folderDeleteJournal.has(this._normId(id))) {
      const rollback = this.restoreFolderAfterDeniedDelete(id);
      if (!rollback.success) return rollback;
    }

    const folder = this._get(id);
    if (!folder) return { success: false, error: "Folder not found" };
    const folderName = folder.name;

    let preservedFolder = null;
    if (preserveFolder) {
      // Rename on collision: "name", "name (2)", "name (3)", …
      let name = folder.name;
      for (let n = 2; this._liveNameTakenInSpace(name, privateSpaceId, folder.id); n++) {
        name = `${folder.name} (${n})`;
      }
      folder.space_id = privateSpaceId;
      folder.name = name;
      folder.client_folder_id = randomUUID();
      folder.cloud_id = null;
      folder.sync_status = "pending";
      folder.left_team = 0;
      folder.updated_at = new Date().toISOString();
      preservedFolder = this._clone(folder);
    } else {
      this.folders.delete(folder.id);
    }

    return {
      success: true,
      folderName,
      folder: preservedFolder,
      relocatedNotes: [],
      deletedNoteIds: [],
    };
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  _allocId() {
    const id = this._nextId;
    this._nextId = id + 1;
    return id;
  }

  // Look up by numeric id, tolerating a numeric-string id from IPC callers.
  _get(id) {
    if (this.folders.has(id)) return this.folders.get(id);
    const n = Number(id);
    if (!Number.isNaN(n) && this.folders.has(n)) return this.folders.get(n);
    return null;
  }

  // Normalize an id to the key form used by the cache/journal Maps (numeric when
  // possible), so a numeric-string id from IPC still hits journal entries.
  _normId(id) {
    if (this.folders.has(id) || this.folderDeleteJournal.has(id)) return id;
    const n = Number(id);
    return Number.isNaN(n) ? id : n;
  }

  // Return a defensive copy so callers can't mutate the cache. Folder rows are
  // flat (no nested arrays), so a shallow spread is sufficient.
  _clone(row) {
    return { ...row };
  }

  // Reproduces the SQLite FOLDER_NAME_TAKEN_FILTER: a name is taken by any folder
  // in the space that is either live OR optimistically-deleted (journaled),
  // excluding `excludeId`.
  _nameTaken(name, spaceId, excludeId) {
    for (const row of this.folders.values()) {
      if (excludeId != null && row.id === excludeId) continue;
      if (row.name !== name) continue;
      if (row.space_id !== (spaceId ?? null)) continue;
      if (!row.deleted_at || this.folderDeleteJournal.has(row.id)) return true;
    }
    return false;
  }

  // Collision check against LIVE folders only (used by relocate's rename loop).
  _liveNameTakenInSpace(name, spaceId, excludeId) {
    for (const row of this.folders.values()) {
      if (row.id === excludeId) continue;
      if (row.name === name && row.space_id === spaceId && !row.deleted_at) return true;
    }
    return false;
  }

  // GAP: SQLite reads spaces.kind for both ids to decide "team -> private". We
  // don't own spaces, so this can't be evaluated and always reports 0 (no
  // scope-retraction flag). Kept as a hook so callers can override if a spaces
  // resolver is wired in later.
  _leftTeamDuringPush(_snapshotSpaceId, _currentSpaceId) {
    return 0;
  }

  // Match SQLite's default BINARY collation (code-unit order) for text columns.
  _compareText(a, b) {
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
          console.warn(`[FoldersStore] ${label} write-through failed:`, err?.message || err)
        );
      }
    } catch (err) {
      console.warn(`[FoldersStore] ${label} write-through threw:`, err?.message || err);
    }
  }
}

module.exports = { FoldersStore };
