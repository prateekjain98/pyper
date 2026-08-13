// Notes domain, migrated off better-sqlite3 onto Convex.
//
// The Electron main process still calls these methods SYNCHRONOUSLY and expects
// the exact same return shapes the SQLite DatabaseManager produced. We satisfy
// that by keeping an in-memory cache of the `notes` rows: reads are served
// synchronously from memory, writes mutate memory synchronously (so a
// read-after-write is consistent) and additionally fire a best-effort async
// Convex mutation that is never awaited and never allowed to throw.
//
// Field/return-shape parity is with apps/desktop/src/helpers/database.js — every
// public method that touches the `notes` table:
//   reads:   getNote / getNoteByCloudId / getNotes / getNotesForSpace /
//            getNoteIdsInFolder / getNoteIdsInScope / getFolderNoteCounts /
//            getNoteByCalendarEventId / getNoteByClientId / searchNotes /
//            getPendingNotes / getPendingNoteDeletes / countTeamNotesMissingOwner
//   writes:  saveNote / updateNote / deleteNote / hardDeleteNote /
//            updateNoteCloudId / updateNoteShareState
//   sync bookkeeping: upsertNoteFromCloud / markNoteSynced / acknowledgeNoteCreate /
//            markNoteSyncedIfUnchanged / setNoteOwnerFromCloud / setNoteCloudBase /
//            markNoteSyncError / restoreNoteAfterDeniedDelete
//
// Every returned row carries the full `notes` column set in table order (see
// NOTE_ROW_TEMPLATE): id, title, content, note_type, source_file,
// audio_duration_seconds, created_at, updated_at, enhanced_content,
// enhancement_prompt, enhanced_at_content_hash, cloud_id, folder_id, transcript,
// calendar_event_id, participants, diarization_enabled, expected_speaker_count,
// client_note_id, sync_status, deleted_at, is_shared, share_token, space_id,
// left_team, updated_by_user_id, cloud_updated_at, owner_user_id. Integer columns
// (is_shared, left_team, diarization_enabled) stay as 0/1 numbers, and locally
// generated timestamps use SQLite's `datetime('now')` format (`YYYY-MM-DD
// HH:MM:SS`, UTC), exactly like CURRENT_TIMESTAMP did.
//
// Convex mapping notes (convex/notes.ts):
//   - load() seeds from the public `notes.list` query (live, non-deleted notes,
//     newest first) and funnels each doc through upsertNoteFromCloud, the same
//     inbound-mirror path a later sync pull uses. Convex `_id` (string) -> local
//     `cloud_id`; the numeric `id` is client-side via an allocator.
//   - saveNote  -> `notes.create`  (idempotent on client_note_id)
//     updateNote -> `notes.update`  (content fields only)
//     deleteNote -> `notes.remove`  (soft delete / tombstone)
//   - The internal fns (upsert/applyUpdate/softDelete/listDelta/…) are
//     internalMutation/internalQuery — NOT client-callable — so they are never
//     targeted here.
//
// GAPs (see per-method `// GAP:` comments):
//   - folder_id / space_id are LOCAL numeric ids referencing the folders/spaces
//     tables. Convex stores its own string ids. This store owns only `notes`, so
//     it cannot translate between them: load() leaves them null, write-throughs
//     omit them, and the folder->space follow / default-folder / private-space
//     resolution that database.js does is dropped. The caller (or Folders/Spaces
//     stores) owns that mapping, mirroring SpacesStore.upsertSpaceFromCloud.
//   - searchNotes was FTS5 (BM25 rank). Reproduced as an in-memory prefix filter
//     ordered by updated_at DESC.
//   - is_shared/share_token, updateNoteCloudId, all sync bookkeeping columns
//     (sync_status/cloud_updated_at/owner_user_id/left_team), the
//     optimistic_folder_delete journal and hardDeleteNote's cross-entity cascade
//     have no Convex column/equivalent and are memory-only.

const { randomUUID } = require("crypto");
const { anyApi } = require("convex/server");
const { normalizeStoredSpeakerCount } = require("../speakerCount");

// Every local field a note create (POST) carries; the acknowledgement compares
// these atomically against the pushed snapshot. Copied verbatim from database.js
// (they are module-private there, not exported).
const NOTE_CREATE_ACK_FIELDS = [
  "client_note_id",
  "title",
  "content",
  "enhanced_content",
  "enhancement_prompt",
  "enhanced_at_content_hash",
  "note_type",
  "source_file",
  "audio_duration_seconds",
  "folder_id",
  "space_id",
  "transcript",
  "calendar_event_id",
  "participants",
  "diarization_enabled",
  "expected_speaker_count",
  "created_at",
  "updated_at",
  "sync_status",
  "deleted_at",
];
// A PATCH additionally pins the server base and any pending scope retraction.
const NOTE_PATCH_ACK_FIELDS = [...NOTE_CREATE_ACK_FIELDS, "cloud_updated_at", "left_team"];

function rowMatchesSnapshot(row, snapshot, fields) {
  return fields.every((field) => {
    const expected = snapshot[field] === undefined ? null : snapshot[field];
    return row[field] === expected;
  });
}

// Fields writable through database.js updateNote() that also exist in Convex's
// MUTABLE set (convex/notes.ts) AND are not a local-numeric id. folder_id /
// space_id are intentionally excluded — see the GAP note above.
const CLOUD_UPDATABLE_FIELDS = [
  "title",
  "content",
  "enhanced_content",
  "enhancement_prompt",
  "enhanced_at_content_hash",
  "transcript",
  "calendar_event_id",
  "participants",
  "diarization_enabled",
  "expected_speaker_count",
];

// database.js updateNote() whitelist (verbatim).
const NOTE_UPDATE_ALLOWED_FIELDS = [
  "title",
  "content",
  "enhanced_content",
  "enhancement_prompt",
  "enhanced_at_content_hash",
  "folder_id",
  "space_id",
  "transcript",
  "calendar_event_id",
  "participants",
  "diarization_enabled",
  "expected_speaker_count",
  "sync_status",
  "deleted_at",
  "client_note_id",
  "cloud_id",
  "cloud_updated_at",
  "owner_user_id",
  "updated_by_user_id",
  "left_team",
];

// Full `notes` row in table (SELECT *) order, with the SQLite column defaults.
// created_at/updated_at are placeholders — _makeRow() stamps them.
const NOTE_ROW_TEMPLATE = {
  id: null,
  title: "Untitled Note",
  content: "",
  note_type: "personal",
  source_file: null,
  audio_duration_seconds: null,
  created_at: null,
  updated_at: null,
  enhanced_content: null,
  enhancement_prompt: null,
  enhanced_at_content_hash: null,
  cloud_id: null,
  folder_id: null,
  transcript: null,
  calendar_event_id: null,
  participants: null,
  diarization_enabled: null,
  expected_speaker_count: null,
  client_note_id: null,
  sync_status: "pending",
  deleted_at: null,
  is_shared: 0,
  share_token: null,
  space_id: null,
  left_team: 0,
  updated_by_user_id: null,
  cloud_updated_at: null,
  owner_user_id: null,
};

// SQLite CURRENT_TIMESTAMP / datetime('now') format: "YYYY-MM-DD HH:MM:SS" (UTC).
function sqliteNow() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// Word tokenizer matching noteSearch.js so the "no usable tokens -> []" contract
// and prefix semantics survive the FTS5 -> in-memory downgrade.
const WORD_RE = /[\p{L}\p{N}_][\p{L}\p{M}\p{N}_]*/gu;
function noteSearchTokens(input) {
  if (typeof input !== "string") return [];
  const tokens = input
    .normalize("NFC")
    .match(WORD_RE)
    ?.filter((token) => /[\p{L}\p{N}]/u.test(token));
  return tokens?.length ? tokens.map((t) => t.toLowerCase()) : [];
}

class NotesStore {
  /**
   * @param {import("convex/browser").ConvexHttpClient | null} client Shared
   *   Convex HTTP client (created in ./client.js). May be null — then the store
   *   operates purely in-memory and never touches Convex.
   */
  constructor(client) {
    this.client = client || null;
    // local numeric id -> full row object
    this.notes = new Map();
    this._nextId = 1;
  }

  // ─── Cache load ────────────────────────────────────────────────────────────

  // Populate the cache from Convex. Safe to call more than once (rows are matched
  // by client_note_id, so repeats update in place instead of forking).
  async load(resolveLocalSpaceId, resolveLocalFolderId) {
    if (!this.client) return;
    let cloudNotes;
    try {
      cloudNotes = await this.client.query(anyApi.notes.list, {});
    } catch (err) {
      console.warn("[NotesStore] load: notes.list query failed:", err?.message || err);
      return;
    }
    if (!Array.isArray(cloudNotes)) return;
    for (const cloud of cloudNotes) {
      // Reuse the inbound-mirror path so load() and a later sync pull agree. An
      // orchestrator (the facade) may pass resolvers that translate the CLOUD
      // space_id/folder_id (_id strings) to LOCAL numeric ids; without them we
      // keep the SQLite-parity fallback (null local ids).
      const localSpaceId =
        typeof resolveLocalSpaceId === "function" ? resolveLocalSpaceId(cloud.space_id) : null;
      const localFolderId =
        typeof resolveLocalFolderId === "function" ? resolveLocalFolderId(cloud.folder_id) : null;
      this.upsertNoteFromCloud(cloud, localFolderId, localSpaceId);
    }
  }

  // ─── Reads (parity with database.js) ───────────────────────────────────────

  getNote(id) {
    // database.js getNote does NOT filter deleted_at — soft-deleted rows return.
    const row = this._get(id);
    return row ? this._clone(row) : null;
  }

  getNoteByCloudId(cloudId) {
    if (cloudId == null) return null;
    for (const row of this.notes.values()) {
      if (row.cloud_id === cloudId && !row.deleted_at) return this._clone(row);
    }
    return null;
  }

  getNotes(noteType = null, limit = 100, folderId = null, spaceId = null) {
    const rows = [...this.notes.values()].filter((r) => {
      if (r.deleted_at) return false;
      if (noteType && r.note_type !== noteType) return false;
      if (folderId != null) {
        if (r.folder_id !== folderId) return false;
      } else if (spaceId != null) {
        // spaceId without folderId lists a space's root: folderless notes only.
        if (r.folder_id != null) return false;
      }
      if (spaceId != null && r.space_id !== spaceId) return false;
      return true;
    });
    rows.sort((a, b) => this._compareText(b.updated_at, a.updated_at));
    return rows.slice(0, limit).map((r) => this._clone(r));
  }

  // Unlike getNotes(null, limit, null, spaceId) — which is root-only — this
  // lists every note in the space, foldered or not (space overview list).
  getNotesForSpace(spaceId, limit = 50) {
    const rows = [...this.notes.values()].filter(
      (r) => !r.deleted_at && r.space_id === spaceId
    );
    rows.sort((a, b) => this._compareText(b.updated_at, a.updated_at));
    return rows.slice(0, limit).map((r) => this._clone(r));
  }

  getNoteIdsInFolder(folderId) {
    return this.getNoteIdsInScope(null, folderId);
  }

  getNoteIdsInScope(spaceId = null, folderId = null, candidateIds = null) {
    if (candidateIds && candidateIds.length === 0) return [];
    const candidateSet = candidateIds ? new Set(candidateIds) : null;
    const ids = [];
    for (const row of this.notes.values()) {
      if (row.deleted_at) continue;
      if (candidateSet && !candidateSet.has(row.id)) continue;
      if (spaceId != null && row.space_id !== spaceId) continue;
      if (folderId != null && row.folder_id !== folderId) continue;
      ids.push(row.id);
    }
    return ids;
  }

  getFolderNoteCounts() {
    // folder_id NULL rows are space-root notes; grouping by space_id too
    // attributes them per space so the tree shows true space totals.
    const groups = new Map();
    for (const row of this.notes.values()) {
      if (row.deleted_at) continue;
      const key = JSON.stringify([row.space_id ?? null, row.folder_id ?? null]);
      const existing = groups.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        groups.set(key, {
          space_id: row.space_id ?? null,
          folder_id: row.folder_id ?? null,
          count: 1,
        });
      }
    }
    return [...groups.values()];
  }

  getNoteByCalendarEventId(eventId, excludeNoteId = null) {
    for (const row of this.notes.values()) {
      if (row.deleted_at) continue;
      if (row.calendar_event_id !== eventId) continue;
      if (excludeNoteId && row.id === excludeNoteId) continue;
      return this._clone(row);
    }
    return null;
  }

  getNoteByClientId(clientNoteId) {
    const row = this._getByClientId(clientNoteId);
    if (!row) return null;
    // GAP: no optimistic_folder_delete journal in this store, so the derived
    // folder_delete_pending flag database.js computes is always 0.
    return { ...this._clone(row), folder_delete_pending: 0 };
  }

  // GAP: database.js used FTS5 (notes_fts MATCH, BM25 rank). Reproduced as an
  // in-memory prefix-AND filter over title/content/enhanced_content, ordered by
  // updated_at DESC (rank order is not reproducible without the FTS index).
  searchNotes(query, limit = 50, spaceId = null, folderId = null) {
    const tokens = noteSearchTokens(query);
    if (!tokens.length) return [];
    const rows = [...this.notes.values()].filter((row) => {
      if (row.deleted_at) return false;
      if (spaceId != null && row.space_id !== spaceId) return false;
      if (folderId != null && row.folder_id !== folderId) return false;
      const haystack = `${row.title || ""} ${row.content || ""} ${row.enhanced_content || ""}`;
      const words = (haystack.toLowerCase().match(WORD_RE) || []);
      return tokens.every((tok) => words.some((w) => w.startsWith(tok)));
    });
    rows.sort((a, b) => this._compareText(b.updated_at, a.updated_at));
    return rows.slice(0, limit).map((r) => this._clone(r));
  }

  getPendingNotes(spaceKind = null) {
    // GAP: database.js JOINs spaces to filter by kind; this store has no spaces,
    // so the kind filter is dropped. For 'team' we still union the left_team
    // scope-retraction rows (D6) the DB adds, best-effort.
    const rows = [];
    for (const row of this.notes.values()) {
      if (row.deleted_at) continue;
      const isPending = row.sync_status === "pending" || row.sync_status === "error";
      const leftTeamRetraction =
        spaceKind === "team" && row.left_team === 1 && row.cloud_id != null;
      if (isPending || leftTeamRetraction) rows.push(this._clone(row));
    }
    return rows;
  }

  getPendingNoteDeletes() {
    // GAP: the optimistic_folder_delete NOT EXISTS check is always true here (no
    // journal table), so folder-delete tombstones are not excluded.
    const rows = [];
    for (const row of this.notes.values()) {
      if (
        row.deleted_at != null &&
        row.cloud_id != null &&
        row.sync_status === "pending"
      ) {
        rows.push(this._clone(row));
      }
    }
    return rows;
  }

  // GAP: database.js JOINs spaces (s.kind = 'team'); without a SpacesStore the
  // team-kind filter is dropped, so this over-approximates by counting every
  // live cloud-backed note whose owner is still unknown.
  countTeamNotesMissingOwner() {
    let count = 0;
    for (const row of this.notes.values()) {
      if (row.deleted_at == null && row.cloud_id != null && row.owner_user_id == null) {
        count += 1;
      }
    }
    return count;
  }

  // ─── Writes (memory-first, best-effort Convex write-through) ────────────────

  saveNote(
    title,
    content,
    noteType = "personal",
    sourceFile = null,
    audioDuration = null,
    folderId = null,
    spaceId = null
  ) {
    // GAP: database.js resolves the note's space from its folder (D2), falls back
    // to the default "Personal"/"Meetings" folder, and defaults space to
    // getPrivateSpaceId(). All of that needs the Folders/Spaces stores, so here
    // folderId/spaceId are stored as passed (null stays null).
    const clientNoteId = randomUUID();
    const row = this._makeRow({
      id: this._allocId(),
      title,
      content,
      note_type: noteType,
      source_file: sourceFile,
      audio_duration_seconds: audioDuration,
      folder_id: folderId,
      space_id: spaceId,
      client_note_id: clientNoteId,
      // sync_status defaults to 'pending', matching a fresh local INSERT.
    });
    this.notes.set(row.id, row);

    // Write-through: notes.create is idempotent on client_note_id. The returned
    // cloud _id is not captured here — the sync ack path (acknowledgeNoteCreate)
    // links it. GAP: local-numeric folder_id/space_id are omitted from the cloud
    // input (no local->cloud id mapping in this store).
    this._fireMutation(
      anyApi.notes.create,
      {
        input: {
          client_note_id: clientNoteId,
          title,
          content,
          note_type: noteType,
          source_file: sourceFile,
          audio_duration_seconds: audioDuration,
        },
      },
      "saveNote"
    );
    return { success: true, note: this._clone(row) };
  }

  updateNote(id, updates) {
    const note = this._get(id);
    if (!note) return { success: false };
    // GAP: database.js follows the folder's space (D2) and toggles left_team on
    // team<->private moves via the spaces table. Without a SpacesStore those
    // auto-derivations are skipped; only the explicitly-provided fields apply.

    const patch = {};
    for (const [key, value] of Object.entries(updates)) {
      if (NOTE_UPDATE_ALLOWED_FIELDS.includes(key) && value !== undefined) {
        patch[key] = value;
      }
    }
    if (Object.keys(patch).length === 0) return { success: false };

    // Memory first (sync, consistent read-after-write).
    Object.assign(note, patch);
    // Re-queue for cloud sync on any local edit unless the caller set it.
    if (!("sync_status" in updates)) note.sync_status = "pending";
    note.updated_at = sqliteNow();

    // Best-effort Convex content update (cloud-backed rows only). Local-only and
    // local-numeric-id fields are never sent — see CLOUD_UPDATABLE_FIELDS.
    if (note.cloud_id) {
      const input = {};
      for (const field of CLOUD_UPDATABLE_FIELDS) {
        if (field in patch) input[field] = patch[field];
      }
      if (Object.keys(input).length > 0) {
        this._fireMutation(
          anyApi.notes.update,
          { id: note.cloud_id, input },
          "updateNote"
        );
      }
    }
    return { success: true, note: this._clone(note) };
  }

  deleteNote(id) {
    const note = this._get(id);
    // Matches `WHERE id = ? AND deleted_at IS NULL`: a re-delete is a no-op.
    if (!note || note.deleted_at) return { success: false, id };
    note.deleted_at = sqliteNow();
    note.sync_status = "pending";
    note.updated_at = sqliteNow();
    if (note.cloud_id) {
      this._fireMutation(anyApi.notes.remove, { id: note.cloud_id }, "deleteNote");
    }
    return { success: true, id };
  }

  // Confirmed cloud deletes and access revocation hard-remove the local row.
  // Memory-only cache eviction: the cloud tombstone is already handled by the
  // deleteNote() write-through / a sync pull, and this store owns only `notes`
  // (database.js additionally retires conversations and speaker rows — those are
  // other stores' concern, orchestrated by the caller, exactly like
  // SpacesStore.purgeSpace).
  hardDeleteNote(id) {
    const note = this._get(id);
    if (!note) return { success: false, id };
    this.notes.delete(note.id);
    return { success: true, id };
  }

  // Establishes the local<->cloud link. Memory-only: this is inbound bookkeeping
  // (cloud_id has no independent server write) and, like database.js, must NOT
  // bump updated_at.
  updateNoteCloudId(id, cloudId) {
    const note = this._get(id);
    if (!note) return null;
    note.cloud_id = cloudId;
    return this._clone(note);
  }

  // GAP: is_shared / share_token have no Convex column, so this is memory-only.
  // Share bookkeeping, not a content edit — must NOT bump updated_at.
  updateNoteShareState(id, { is_shared, share_token } = {}) {
    const note = this._get(id);
    if (!note) return null;
    note.is_shared = is_shared;
    if (share_token !== undefined) note.share_token = share_token;
    return this._clone(note);
  }

  // ─── Sync bookkeeping (inbound mirror + local sync state; memory-only) ──────

  // Inbound mirror: cloud note -> local cache, reproducing database.js's
  // ON CONFLICT(client_note_id) merge (never overwrite non-empty local
  // content/enhanced_content/transcript with an empty cloud value; COALESCE the
  // optional metadata). Memory-only — the data already lives in Convex.
  // GAP: localFolderId/localSpaceId must be resolved by the caller; the DB
  // defaulted space to getPrivateSpaceId(), which this store can't do (null).
  upsertNoteFromCloud(cloudNote, localFolderId = null, localSpaceId = null) {
    const clientNoteId = cloudNote.client_note_id;
    // "excluded.*" — the values a fresh INSERT would bind (matches database.js).
    const ex = {
      cloud_id: cloudNote.id,
      title: cloudNote.title,
      content: cloudNote.content,
      enhanced_content: cloudNote.enhanced_content || null,
      enhancement_prompt: cloudNote.enhancement_prompt || null,
      enhanced_at_content_hash: cloudNote.enhanced_at_content_hash || null,
      note_type: cloudNote.note_type || "personal",
      source_file: cloudNote.source_file || null,
      audio_duration_seconds: cloudNote.audio_duration_seconds || null,
      transcript: cloudNote.transcript || null,
      folder_id: localFolderId,
      space_id: localSpaceId ?? null,
      participants: cloudNote.participants || null,
      calendar_event_id: cloudNote.calendar_event_id || null,
      diarization_enabled: cloudNote.diarization_enabled ?? null,
      expected_speaker_count: normalizeStoredSpeakerCount(cloudNote.expected_speaker_count),
      updated_by_user_id: cloudNote.updated_by_user_id || null,
      owner_user_id: cloudNote.user_id || null,
      created_at: cloudNote.created_at,
      updated_at: cloudNote.updated_at,
      cloud_updated_at: cloudNote.updated_at,
    };

    const existing = this._getByClientId(clientNoteId);
    if (existing) {
      const cloudEnhancedEmpty =
        this._isEmpty(ex.enhanced_content) && !this._isEmpty(existing.enhanced_content);
      existing.cloud_id = ex.cloud_id;
      existing.title = ex.title;
      existing.content = this._keepLocalIfCloudEmpty(ex.content, existing.content);
      existing.enhanced_content = cloudEnhancedEmpty
        ? existing.enhanced_content
        : ex.enhanced_content;
      existing.enhancement_prompt = cloudEnhancedEmpty
        ? existing.enhancement_prompt
        : ex.enhancement_prompt;
      existing.enhanced_at_content_hash = cloudEnhancedEmpty
        ? existing.enhanced_at_content_hash
        : ex.enhanced_at_content_hash;
      existing.transcript = this._keepLocalIfCloudEmpty(ex.transcript, existing.transcript);
      existing.folder_id = ex.folder_id;
      existing.space_id = ex.space_id;
      existing.participants = ex.participants ?? existing.participants;
      existing.calendar_event_id = ex.calendar_event_id ?? existing.calendar_event_id;
      existing.diarization_enabled = ex.diarization_enabled ?? existing.diarization_enabled;
      existing.expected_speaker_count =
        ex.expected_speaker_count ?? existing.expected_speaker_count;
      existing.updated_by_user_id = ex.updated_by_user_id ?? existing.updated_by_user_id;
      existing.owner_user_id = ex.owner_user_id ?? existing.owner_user_id;
      existing.sync_status = "synced";
      existing.left_team = 0;
      existing.updated_at = ex.updated_at;
      existing.cloud_updated_at = ex.cloud_updated_at;
      return this._clone(existing);
    }

    const row = this._makeRow({
      id: this._allocId(),
      client_note_id: clientNoteId,
      ...ex,
      sync_status: "synced",
      left_team: 0,
    });
    this.notes.set(row.id, row);
    return this._clone(row);
  }

  markNoteSynced(id, cloudId, cloudUpdatedAt = null, ownerUserId = null) {
    const note = this._get(id);
    if (!note) return { success: true };
    note.sync_status = "synced";
    note.cloud_id = cloudId;
    note.left_team = 0;
    note.cloud_updated_at = cloudUpdatedAt;
    note.owner_user_id = ownerUserId;
    return { success: true };
  }

  // Adopt a create response only for the exact local identity that issued it, and
  // settle only when every pushed field still matches the snapshot. Mirrors
  // database.js outcomes: unresolved / orphaned / already-linked / synced / pending.
  acknowledgeNoteCreate(
    id,
    snapshot,
    cloudId,
    cloudUpdatedAt = null,
    ownerUserId = null,
    settleIfUnchanged = true
  ) {
    const expectedClientNoteId = snapshot?.client_note_id;
    if (!expectedClientNoteId || !cloudId) {
      return { success: false, outcome: "unresolved" };
    }

    const current = this._get(id);
    if (!current || current.client_note_id !== expectedClientNoteId) {
      const identityStillExists = this._getByClientId(expectedClientNoteId);
      return {
        success: true,
        outcome: identityStillExists ? "unresolved" : "orphaned",
      };
    }

    if (current.cloud_id) {
      return {
        success: true,
        outcome: current.cloud_id === cloudId ? "already-linked" : "unresolved",
      };
    }

    const unchanged = rowMatchesSnapshot(current, snapshot, NOTE_CREATE_ACK_FIELDS);
    // GAP: database.js recomputes left_team from the spaces table on a
    // team->private move that raced the POST. Without a SpacesStore that flag
    // can't be derived; left_team is left as-is.

    if (unchanged && settleIfUnchanged) {
      current.sync_status = "synced";
      current.cloud_id = cloudId;
      current.left_team = 0;
      current.cloud_updated_at = cloudUpdatedAt;
      current.owner_user_id = ownerUserId;
      return { success: true, outcome: "synced" };
    }

    current.cloud_id = cloudId;
    current.cloud_updated_at = cloudUpdatedAt;
    current.owner_user_id = ownerUserId;
    current.sync_status = "pending";
    return { success: true, outcome: "pending" };
  }

  // A PATCH response belongs to both the local client identity and the cloud
  // identity that issued it. An exact pushed snapshot settles; newer work on the
  // same identity stays pending while advancing its server base.
  markNoteSyncedIfUnchanged(
    id,
    snapshot,
    expectedCloudId,
    cloudUpdatedAt = null,
    ownerUserId = null
  ) {
    if (!snapshot?.client_note_id || !expectedCloudId) {
      return { success: false, outcome: "identity-changed", changes: 0 };
    }

    const current = this._get(id);
    if (
      !current ||
      current.client_note_id !== snapshot.client_note_id ||
      current.cloud_id !== expectedCloudId
    ) {
      return { success: true, outcome: "identity-changed", changes: 0 };
    }

    const unchanged = rowMatchesSnapshot(current, snapshot, NOTE_PATCH_ACK_FIELDS);
    const nextCloudUpdatedAt = (() => {
      if (!cloudUpdatedAt) return current.cloud_updated_at;
      if (!current.cloud_updated_at) return cloudUpdatedAt;
      const incomingMs = Date.parse(cloudUpdatedAt);
      const currentMs = Date.parse(current.cloud_updated_at);
      if (Number.isFinite(incomingMs) && Number.isFinite(currentMs)) {
        return incomingMs > currentMs ? cloudUpdatedAt : current.cloud_updated_at;
      }
      return cloudUpdatedAt > current.cloud_updated_at
        ? cloudUpdatedAt
        : current.cloud_updated_at;
    })();

    if (unchanged) {
      current.sync_status = "synced";
      current.left_team = 0;
      current.cloud_updated_at = nextCloudUpdatedAt;
      if (ownerUserId != null) current.owner_user_id = ownerUserId;
      return { success: true, outcome: "synced", changes: 1 };
    }

    current.cloud_updated_at = nextCloudUpdatedAt;
    if (ownerUserId != null) current.owner_user_id = ownerUserId;
    return { success: true, outcome: "pending", changes: 0 };
  }

  // Copies the cloud owner onto a local row without touching updated_at or
  // sync_status (the owner_user_id backfill relies on this).
  setNoteOwnerFromCloud(id, ownerUserId) {
    const note = this._get(id);
    if (note) note.owner_user_id = ownerUserId;
    return { success: true };
  }

  // Records the server revision the user knowingly overwrites ("Keep editing").
  // Leaves updated_at and sync_status alone.
  setNoteCloudBase(id, cloudUpdatedAt) {
    const note = this._get(id);
    if (note) note.cloud_updated_at = cloudUpdatedAt;
    return { success: true };
  }

  markNoteSyncError(id) {
    const note = this._get(id);
    if (note) note.sync_status = "error";
    return { success: true };
  }

  // A denied optimistic delete revives the local tombstone in place; the
  // deliberately old timestamp lets the mandatory snapshot pull replace it.
  restoreNoteAfterDeniedDelete(id) {
    const note = this._get(id);
    if (!note || note.deleted_at == null) return { success: false, id };
    note.deleted_at = null;
    note.sync_status = "synced";
    note.updated_at = "1970-01-01 00:00:00";
    return { success: true, id };
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  _allocId() {
    const id = this._nextId;
    this._nextId = id + 1;
    return id;
  }

  // Build a full row: start from the column template (table order), stamp the
  // timestamps, then apply defined overrides only (undefined never clobbers a
  // default, so every column is always present — SELECT * parity).
  _makeRow(overrides = {}) {
    const now = sqliteNow();
    const row = { ...NOTE_ROW_TEMPLATE, created_at: now, updated_at: now };
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) row[key] = value;
    }
    return row;
  }

  // Look up by numeric id, tolerating a numeric-string id from IPC callers.
  _get(id) {
    if (this.notes.has(id)) return this.notes.get(id);
    const n = Number(id);
    if (!Number.isNaN(n) && this.notes.has(n)) return this.notes.get(n);
    return null;
  }

  _getByClientId(clientNoteId) {
    if (clientNoteId == null) return null;
    for (const row of this.notes.values()) {
      if (row.client_note_id === clientNoteId) return row;
    }
    return null;
  }

  _isEmpty(value) {
    return value === null || value === undefined || value === "";
  }

  // Reproduces database.js's `CASE WHEN cloud empty AND local non-empty THEN
  // local ELSE cloud` guard (#1290): never blank out local content with an empty
  // cloud value.
  _keepLocalIfCloudEmpty(cloudValue, localValue) {
    return this._isEmpty(cloudValue) && !this._isEmpty(localValue) ? localValue : cloudValue;
  }

  // Defensive copy so callers can't mutate the cache.
  _clone(row) {
    return { ...row };
  }

  // Match SQLite's default BINARY collation (code-unit order) for TEXT columns.
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
          console.warn(`[NotesStore] ${label} write-through failed:`, err?.message || err)
        );
      }
    } catch (err) {
      console.warn(`[NotesStore] ${label} write-through threw:`, err?.message || err);
    }
  }
}

module.exports = { NotesStore };
