// ConvexDatabaseManager — a drop-in replacement for the SQLite `DatabaseManager`
// (src/helpers/database.js), selected behind an env flag while the default stays
// SQLite. INERT until wired: constructing it must be a faithful stand-in for
// `new DatabaseManager()` in main.js, which is SYNCHRONOUS and un-awaited.
//
// ── What this class is ────────────────────────────────────────────────────────
// A FACADE that composes the already-built convexdb single-table stores and adds
// local persistence for the tables that have no Convex backend. It exposes the
// EXACT public method surface of DatabaseManager, with the same argument lists
// and return shapes, so `new ConvexDatabaseManager()` swaps in cleanly.
//
// ── Delegated to Convex-backed stores (group A) ───────────────────────────────
//   spaces         -> SpacesStore          transcriptions -> TranscriptionsStore
//   notes          -> NotesStore           folders        -> FoldersStore
//   conversations  -> ConversationsStore    (+ messages)
//   dictionary     -> DictionaryStore       snippets       -> SnippetsStore
// Each store keeps an in-memory cache (seeded from Convex by an async load()),
// serves reads synchronously, and best-effort-writes through to Convex. Simple
// group-A methods below are one-line delegations to the matching store.
//
// ── Backed by local JSON (group B — NO Convex backend) ────────────────────────
// Persisted via ./convexdb/localStore.js (JSON under userData; memory-only under
// plain node/tests). Tables:
//   actions, google_calendar_tokens, google_calendars, microsoft_calendar_tokens,
//   microsoft_calendars, calendar_events, apple_calendars, contacts,
//   speaker_profiles, speaker_mappings, note_speaker_embeddings,
//   pending_vector_purges.
// Their DatabaseManager methods are re-implemented here against those stores,
// preserving the SQLite column names, id types, ordering and return shapes.
//
// ── Cross-entity cascades (orchestrated here) ─────────────────────────────────
// The single-table stores flag cross-entity effects as GAPs (they return empty
// cross-entity arrays). This facade fills them: it calls the owning store for the
// row-level effect, then reaches across the notes / conversations(+messages) /
// speaker stores to delete, tombstone, relocate or restore the dependent rows,
// and assembles the combined return shape database.js produced. Covered:
//   deleteFolder, hardDeleteFolder, restoreFolderAfterDeniedDelete,
//   relocateRevokedFolder, moveFolderToSpace, purgeSpace, hardDeleteNote.
// The optimistic folder-delete journal spans folder+note+conversation rows: the
// FoldersStore journals the folder row; this facade journals the note/conversation
// rows (`_folderChildJournal`) so a denied delete restores all three.
//
// ── Residual GAPs vs database.js (documented) ─────────────────────────────────
//   * saveNote/updateNote do not auto-resolve a note's space from its folder / the
//     default folder / the private space (the NotesStore GAP): folder_id/space_id
//     are stored as passed. Callers that already pass resolved ids are unaffected.
//   * searchNotes is an in-memory prefix filter (NotesStore), not FTS5 BM25 rank.
//   * getPendingNotes/getPendingFolders can't apply the spaces.kind JOIN filter
//     inside the single-table stores; the team-scope over-approximation is
//     inherited from those stores.
//   * cleanup() clears local caches instead of deleting a DB file (there is none).
// None of these change a return shape; they are behavioural approximations noted
// at their source.

const { randomUUID } = require("crypto");
const { getConvexClient } = require("./convexdb/client");
const { SpacesStore } = require("./convexdb/spaces");
const { TranscriptionsStore } = require("./convexdb/transcriptions");
const { NotesStore } = require("./convexdb/notes");
const { FoldersStore } = require("./convexdb/folders");
const { ConversationsStore } = require("./convexdb/conversations");
const { DictionaryStore } = require("./convexdb/dictionary");
const { SnippetsStore } = require("./convexdb/snippets");
const { LocalStore } = require("./convexdb/localStore");

// SQLite CURRENT_TIMESTAMP / datetime('now'): "YYYY-MM-DD HH:MM:SS" (UTC).
function sqliteNow() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

const GENERATE_NOTES_PROMPT =
  "Transform the provided content into clean, well-structured notes in markdown. Preserve the user's intent and all substantive information. Remove filler, small talk, false starts, and redundant content. For personal notes, improve grammar and structure for readability. For meeting transcripts, extract key discussion points, decisions, action items, and follow-ups.";

class ConvexDatabaseManager {
  constructor() {
    this.client = getConvexClient();

    // ── Group A: Convex-backed stores ──────────────────────────────────────
    this.spacesStore = new SpacesStore(this.client);
    this.transcriptionsStore = new TranscriptionsStore(this.client);
    this.notesStore = new NotesStore(this.client);
    this.foldersStore = new FoldersStore(this.client);
    this.conversationsStore = new ConversationsStore(this.client);
    this.dictionaryStore = new DictionaryStore(this.client);
    this.snippetsStore = new SnippetsStore(this.client);
    // Cross-store hint: folders default their space to the private ("Personal")
    // space, which the SpacesStore always seeds synchronously in its ctor.
    this.foldersStore.privateSpaceId = this.spacesStore.getPrivateSpaceId();

    // ── Group B: local-only JSON stores (no Convex backend) ────────────────
    this.actionsStore = new LocalStore("actions");
    this.googleTokensStore = new LocalStore("google_calendar_tokens");
    this.googleCalendarsStore = new LocalStore("google_calendars");
    this.microsoftTokensStore = new LocalStore("microsoft_calendar_tokens");
    this.microsoftCalendarsStore = new LocalStore("microsoft_calendars");
    this.calendarEventsStore = new LocalStore("calendar_events");
    this.appleCalendarsStore = new LocalStore("apple_calendars");
    // Gmail meeting detection reads a separate token store (its own OAuth scope,
    // independent of calendar). Detected meetings land in calendar_events with
    // provider="gmail"; Slack detection uses provider="slack" (token via env).
    this.gmailTokensStore = new LocalStore("gmail_tokens");
    this.contactsStore = new LocalStore("contacts");
    this.speakerProfilesStore = new LocalStore("speaker_profiles");
    this.speakerMappingsStore = new LocalStore("speaker_mappings");
    this.noteEmbeddingsStore = new LocalStore("note_speaker_embeddings");
    this.vectorPurgesStore = new LocalStore("pending_vector_purges");

    // Facade-level optimistic folder-delete journal for the note/conversation
    // rows hidden by a folder delete (folder-id -> { notes:[…], conversations:[…] }).
    this._folderChildJournal = new Map();

    this._seedActions();

    // Fire-and-forget async cache seed from Convex — construction stays sync, so
    // reads before this settles just see the seed/empty caches (each store seeds
    // sane defaults). main.js may await whenReady() if it wants (additive).
    this._ready = this._loadAll().catch(() => {});
  }

  // No-op: construction already seeded caches. Kept for API compatibility with
  // callers/tests that invoke initDatabase().
  initDatabase() {
    return { success: true };
  }

  // Additive over the SQLite version: resolves once every store's load() settles.
  whenReady() {
    return this._ready;
  }

  async ready() {
    return this._ready;
  }

  async _loadAll() {
    // Ordered so folders/notes can resolve their CLOUD space/folder ids to LOCAL
    // ids: spaces first (builds the cloud_space_id -> local id map), then folders
    // (needed to resolve note.folder_id), then the rest. Without this ordering the
    // single-table stores can't translate ids and team content collapses into the
    // Personal space by name.
    await this.spacesStore.load();
    this.foldersStore.privateSpaceId = this.spacesStore.getPrivateSpaceId();

    const resolveSpace = (cloudSpaceId) => {
      const priv = this.spacesStore.getPrivateSpaceId();
      if (cloudSpaceId == null) return priv;
      const s = this.spacesStore.getSpaceByCloudSpaceId(cloudSpaceId);
      return s ? s.id : priv;
    };

    await this.foldersStore.load(resolveSpace);

    // Build a cloud folder _id -> local folder id map from the loaded folders.
    const folderByCloud = new Map();
    for (const row of this.foldersStore.folders.values()) {
      if (row.cloud_id != null) folderByCloud.set(row.cloud_id, row.id);
    }
    const resolveFolder = (cloudFolderId) =>
      cloudFolderId == null ? null : folderByCloud.get(cloudFolderId) ?? null;

    await Promise.all([
      this.transcriptionsStore.load(),
      this.notesStore.load(resolveSpace, resolveFolder),
      this.conversationsStore.load(),
      this.dictionaryStore.load(),
      this.snippetsStore.load(),
    ]);
    // Team spaces may have arrived; keep the folders' private-space hint current.
    this.foldersStore.privateSpaceId = this.spacesStore.getPrivateSpaceId();
  }

  // ══ Transcriptions (delegate) ═══════════════════════════════════════════════
  saveTranscription(...a) { return this.transcriptionsStore.saveTranscription(...a); }
  getTranscriptions(...a) { return this.transcriptionsStore.getTranscriptions(...a); }
  clearTranscriptions(...a) { return this.transcriptionsStore.clearTranscriptions(...a); }
  deleteTranscriptionsExpiredBefore(...a) { return this.transcriptionsStore.deleteTranscriptionsExpiredBefore(...a); }
  deleteTranscription(...a) { return this.transcriptionsStore.deleteTranscription(...a); }
  updateTranscriptionAudio(...a) { return this.transcriptionsStore.updateTranscriptionAudio(...a); }
  updateTranscriptionText(...a) { return this.transcriptionsStore.updateTranscriptionText(...a); }
  updateTranscriptionStatus(...a) { return this.transcriptionsStore.updateTranscriptionStatus(...a); }
  getTranscriptionById(...a) { return this.transcriptionsStore.getTranscriptionById(...a); }
  clearAudioFlags(...a) { return this.transcriptionsStore.clearAudioFlags(...a); }
  getPendingTranscriptions(...a) { return this.transcriptionsStore.getPendingTranscriptions(...a); }
  getPendingTranscriptionDeletes(...a) { return this.transcriptionsStore.getPendingTranscriptionDeletes(...a); }
  hardDeleteTranscription(...a) { return this.transcriptionsStore.hardDeleteTranscription(...a); }
  getTranscriptionByClientId(...a) { return this.transcriptionsStore.getTranscriptionByClientId(...a); }
  upsertTranscriptionFromCloud(...a) { return this.transcriptionsStore.upsertTranscriptionFromCloud(...a); }
  markTranscriptionSynced(...a) { return this.transcriptionsStore.markTranscriptionSynced(...a); }

  // ══ Dictionary (delegate) ═══════════════════════════════════════════════════
  getDictionary(...a) { return this.dictionaryStore.getDictionary(...a); }
  applyDictionaryChanges(...a) { return this.dictionaryStore.applyDictionaryChanges(...a); }
  setDictionary(...a) { return this.dictionaryStore.setDictionary(...a); }
  getPendingDictionary(...a) { return this.dictionaryStore.getPendingDictionary(...a); }
  getPendingDictionaryDeletes(...a) { return this.dictionaryStore.getPendingDictionaryDeletes(...a); }
  hardDeleteDictionaryEntry(...a) { return this.dictionaryStore.hardDeleteDictionaryEntry(...a); }
  getDictionaryEntryByClientId(...a) { return this.dictionaryStore.getDictionaryEntryByClientId(...a); }
  upsertDictionaryFromCloud(...a) { return this.dictionaryStore.upsertDictionaryFromCloud(...a); }
  markDictionaryEntrySynced(...a) { return this.dictionaryStore.markDictionaryEntrySynced(...a); }
  clearDictionaryCloudId(...a) { return this.dictionaryStore.clearDictionaryCloudId(...a); }

  // ══ Snippets (delegate) ═════════════════════════════════════════════════════
  getSnippets(...a) { return this.snippetsStore.getSnippets(...a); }
  setSnippets(...a) { return this.snippetsStore.setSnippets(...a); }
  getPendingSnippets(...a) { return this.snippetsStore.getPendingSnippets(...a); }
  getPendingSnippetDeletes(...a) { return this.snippetsStore.getPendingSnippetDeletes(...a); }
  hardDeleteSnippet(...a) { return this.snippetsStore.hardDeleteSnippet(...a); }
  getSnippetForCloudMerge(...a) { return this.snippetsStore.getSnippetForCloudMerge(...a); }
  upsertSnippetFromCloud(...a) { return this.snippetsStore.upsertSnippetFromCloud(...a); }
  markSnippetSynced(...a) { return this.snippetsStore.markSnippetSynced(...a); }
  clearSnippetCloudId(...a) { return this.snippetsStore.clearSnippetCloudId(...a); }

  // ══ Notes (delegate; hardDeleteNote cascades — see below) ═══════════════════
  saveNote(...a) { return this.notesStore.saveNote(...a); }
  getNote(...a) { return this.notesStore.getNote(...a); }
  getNoteByCloudId(...a) { return this.notesStore.getNoteByCloudId(...a); }
  getNotes(...a) { return this.notesStore.getNotes(...a); }
  getNotesForSpace(...a) { return this.notesStore.getNotesForSpace(...a); }
  getNoteIdsInFolder(...a) { return this.notesStore.getNoteIdsInFolder(...a); }
  getNoteIdsInScope(...a) { return this.notesStore.getNoteIdsInScope(...a); }
  updateNote(...a) { return this.notesStore.updateNote(...a); }
  searchNotes(...a) { return this.notesStore.searchNotes(...a); }
  getNoteByCalendarEventId(...a) { return this.notesStore.getNoteByCalendarEventId(...a); }
  updateNoteCloudId(...a) { return this.notesStore.updateNoteCloudId(...a); }
  updateNoteShareState(...a) { return this.notesStore.updateNoteShareState(...a); }
  deleteNote(...a) { return this.notesStore.deleteNote(...a); }
  getPendingNotes(...a) { return this.notesStore.getPendingNotes(...a); }
  getPendingNoteDeletes(...a) { return this.notesStore.getPendingNoteDeletes(...a); }
  getNoteByClientId(...a) { return this.notesStore.getNoteByClientId(...a); }
  upsertNoteFromCloud(...a) { return this.notesStore.upsertNoteFromCloud(...a); }
  markNoteSynced(...a) { return this.notesStore.markNoteSynced(...a); }
  acknowledgeNoteCreate(...a) { return this.notesStore.acknowledgeNoteCreate(...a); }
  markNoteSyncedIfUnchanged(...a) { return this.notesStore.markNoteSyncedIfUnchanged(...a); }
  setNoteOwnerFromCloud(...a) { return this.notesStore.setNoteOwnerFromCloud(...a); }
  countTeamNotesMissingOwner(...a) { return this.notesStore.countTeamNotesMissingOwner(...a); }
  setNoteCloudBase(...a) { return this.notesStore.setNoteCloudBase(...a); }
  markNoteSyncError(...a) { return this.notesStore.markNoteSyncError(...a); }
  restoreNoteAfterDeniedDelete(...a) { return this.notesStore.restoreNoteAfterDeniedDelete(...a); }
  // Notes own the note-count aggregation (folders' copy is an empty GAP).
  getFolderNoteCounts(...a) { return this.notesStore.getFolderNoteCounts(...a); }

  // ══ Folders (delegate; delete/move/relocate cascade — see below) ════════════
  getFolders(...a) { return this.foldersStore.getFolders(...a); }
  createFolder(...a) { return this.foldersStore.createFolder(...a); }
  renameFolder(...a) { return this.foldersStore.renameFolder(...a); }
  getMeetingsFolder(...a) { return this.foldersStore.getMeetingsFolder(...a); }
  getPendingFolders(...a) { return this.foldersStore.getPendingFolders(...a); }
  getPendingFolderDeletes(...a) { return this.foldersStore.getPendingFolderDeletes(...a); }
  getFolderByClientId(...a) { return this.foldersStore.getFolderByClientId(...a); }
  upsertFolderFromCloud(...a) { return this.foldersStore.upsertFolderFromCloud(...a); }
  markFolderSynced(...a) { return this.foldersStore.markFolderSynced(...a); }
  acknowledgeFolderCreate(...a) { return this.foldersStore.acknowledgeFolderCreate(...a); }
  markFolderSyncedIfUnchanged(...a) { return this.foldersStore.markFolderSyncedIfUnchanged(...a); }
  forkFolderIdentity(...a) { return this.foldersStore.forkFolderIdentity(...a); }
  getFolderIdMap(...a) { return this.foldersStore.getFolderIdMap(...a); }

  // ══ Spaces (delegate; purgeSpace cascades — see below) ══════════════════════
  getPrivateSpaceId(...a) { return this.spacesStore.getPrivateSpaceId(...a); }
  getSpaces(...a) { return this.spacesStore.getSpaces(...a); }
  getSpace(...a) { return this.spacesStore.getSpace(...a); }
  updateSpace(...a) { return this.spacesStore.updateSpace(...a); }
  setSpaceSyncStatus(...a) { return this.spacesStore.setSpaceSyncStatus(...a); }
  getSpaceByCloudSpaceId(...a) { return this.spacesStore.getSpaceByCloudSpaceId(...a); }
  upsertSpaceFromCloud(...a) { return this.spacesStore.upsertSpaceFromCloud(...a); }

  // ══ Conversations + messages (delegate) ═════════════════════════════════════
  createAgentConversation(...a) { return this.conversationsStore.createAgentConversation(...a); }
  getConversationsForNote(...a) { return this.conversationsStore.getConversationsForNote(...a); }
  getConversationsForContainer(...a) { return this.conversationsStore.getConversationsForContainer(...a); }
  getAgentConversations(...a) { return this.conversationsStore.getAgentConversations(...a); }
  getAgentConversation(...a) { return this.conversationsStore.getAgentConversation(...a); }
  deleteAgentConversation(...a) { return this.conversationsStore.deleteAgentConversation(...a); }
  updateAgentConversationTitle(...a) { return this.conversationsStore.updateAgentConversationTitle(...a); }
  addAgentMessage(...a) { return this.conversationsStore.addAgentMessage(...a); }
  getAgentMessages(...a) { return this.conversationsStore.getAgentMessages(...a); }
  getAgentConversationsWithPreview(...a) { return this.conversationsStore.getAgentConversationsWithPreview(...a); }
  searchAgentConversations(...a) { return this.conversationsStore.searchAgentConversations(...a); }
  archiveAgentConversation(...a) { return this.conversationsStore.archiveAgentConversation(...a); }
  unarchiveAgentConversation(...a) { return this.conversationsStore.unarchiveAgentConversation(...a); }
  updateAgentConversationCloudId(...a) { return this.conversationsStore.updateAgentConversationCloudId(...a); }
  getPendingConversations(...a) { return this.conversationsStore.getPendingConversations(...a); }
  getPendingConversationDeletes(...a) { return this.conversationsStore.getPendingConversationDeletes(...a); }
  getConversationByClientId(...a) { return this.conversationsStore.getConversationByClientId(...a); }
  upsertConversationFromCloud(...a) { return this.conversationsStore.upsertConversationFromCloud(...a); }
  markConversationSynced(...a) { return this.conversationsStore.markConversationSynced(...a); }
  hardDeleteConversation(...a) { return this.conversationsStore.hardDeleteConversation(...a); }

  // ══ Cross-entity cascades ═══════════════════════════════════════════════════

  // Confirmed cloud deletes / access revocation retire a note's chats + speaker
  // rows, then drop the note. Reproduces database.js hardDeleteNote.
  hardDeleteNote(id) {
    this._retireConversations((c) => this._eqId(c.note_id, id), { scrubSyncedMessages: true });
    this._deleteSpeakerRowsForNoteIds([id]);
    return this.notesStore.hardDeleteNote(id);
  }

  // Optimistic folder delete. Folder-row + folder-journal effects are the store's;
  // this fills the note/conversation/speaker cascade + the noteIds return.
  deleteFolder(id) {
    const key = this._num(id);
    const folder = this._liveFolderRow(id); // capture cloud_id before the store mutates it
    const noteIds = this.notesStore.getNoteIdsInFolder(id); // live children, pre-delete
    const res = this.foldersStore.deleteFolder(id);
    if (!res.success) return res;

    if (!folder || !folder.cloud_id) {
      // No server row to deny — finalize locally, including local-only children.
      for (const noteId of noteIds) {
        this._retireConversations((c) => this._eqId(c.note_id, noteId), { scrubSyncedMessages: true });
        this._deleteSpeakerRowsForNoteIds([noteId]);
        const n = this._noteRow(noteId);
        if (n) this.notesStore.notes.delete(n.id);
      }
      this._retireConversations((c) => this._eqId(c.folder_id, id), { scrubSyncedMessages: true });
    } else {
      // Journal + hide children so a denial can revive them (see restore below).
      const now = sqliteNow();
      const noteStates = [];
      for (const noteId of noteIds) {
        const n = this._noteRow(noteId);
        if (!n) continue;
        noteStates.push({
          id: n.id,
          sync_status: n.sync_status ?? "pending",
          deleted_at: n.deleted_at ?? null,
          updated_at: n.updated_at ?? null,
        });
        n.deleted_at = now;
        n.sync_status = "folder_delete_pending";
        n.updated_at = now;
      }
      const conversations = this._journalAndTombstoneFolderConversations(id, noteIds);
      this._folderChildJournal.set(key, { notes: noteStates, conversations });
    }
    return { success: true, id, noteIds };
  }

  // Undo a folder DELETE the server denied. Folder row is restored by the store
  // (from its journal, with the name-collision guard); this restores the journaled
  // note/conversation rows and returns the combined shape.
  restoreFolderAfterDeniedDelete(id) {
    const key = this._num(id);
    const child = this._folderChildJournal.get(key);
    if (child) {
      for (const st of child.notes) {
        if (!this._noteRow(st.id)) return { success: false, id, error: "A folder note row is missing" };
      }
      for (const st of child.conversations) {
        if (!this._mapGet(this.conversationsStore.conversations, st.id)) {
          return { success: false, id, error: "A folder conversation row is missing" };
        }
      }
    }
    const folderRes = this.foldersStore.restoreFolderAfterDeniedDelete(id);
    if (!folderRes.success) return folderRes;

    const notes = [];
    const conversationIds = [];
    if (child) {
      for (const st of child.notes) {
        const n = this._noteRow(st.id);
        if (!n) continue;
        n.deleted_at = st.deleted_at;
        n.sync_status = st.sync_status;
        n.updated_at = st.updated_at;
        notes.push({ ...n });
      }
      for (const st of child.conversations) {
        const c = this._mapGet(this.conversationsStore.conversations, st.id);
        if (!c) continue;
        c.deleted_at = st.deleted_at;
        c.sync_status = st.sync_status;
        c.updated_at = st.updated_at;
        conversationIds.push(st.id);
      }
      this._folderChildJournal.delete(key);
    }
    return { success: true, id, folder: folderRes.folder, notes, conversationIds };
  }

  // Finalize a confirmed folder delete: purge held + child notes/conversations/
  // speakers, then drop the folder. Reproduces database.js hardDeleteFolder.
  hardDeleteFolder(id) {
    const key = this._num(id);
    const folder = this._anyFolderRow(id); // no deleted filter (SELECT name ...)
    if (!folder) return { success: false, id, error: "Folder not found" };

    // Child notes = every note in the folder (deleted or not).
    const noteIds = [];
    for (const n of this.notesStore.notes.values()) {
      if (this._eqId(n.folder_id, id)) noteIds.push(n.id);
    }
    const childSet = new Set(noteIds.map((n) => this._num(n)));
    this._retireConversations(
      (c) => c.note_id != null && childSet.has(this._num(c.note_id)),
      { scrubSyncedMessages: true }
    );

    // Journaled ("held") conversations become ordinary pending cloud deletes;
    // never-synced ones hard-delete.
    const child = this._folderChildJournal.get(key);
    const heldConvIds = child ? child.conversations.map((s) => s.id) : [];
    const heldConvSet = new Set(heldConvIds.map((i) => this._num(i)));
    for (const [mk, m] of this.conversationsStore.messages) {
      if (heldConvSet.has(this._num(m.conversation_id))) this.conversationsStore.messages.delete(mk);
    }
    const now = sqliteNow();
    for (const cid of heldConvIds) {
      const c = this._mapGet(this.conversationsStore.conversations, cid);
      if (!c) continue;
      if (c.cloud_id == null) {
        this.conversationsStore.conversations.delete(c.id);
      } else {
        c.deleted_at = c.deleted_at ?? now;
        c.sync_status = "pending";
        c.updated_at = now;
      }
    }

    const heldNoteIds = child ? child.notes.map((s) => s.id) : [];
    this._deleteSpeakerRowsForNoteIds([...noteIds, ...heldNoteIds]);
    for (const nId of [...heldNoteIds, ...noteIds]) {
      const n = this._noteRow(nId);
      if (n) this.notesStore.notes.delete(n.id);
    }
    this._retireConversations((c) => this._eqId(c.folder_id, id), { scrubSyncedMessages: true });

    const res = this.foldersStore.hardDeleteFolder(id);
    this._folderChildJournal.delete(key);
    return { success: res.success, id, noteIds, name: folder.name ?? null };
  }

  // A folder was moved to another space: its notes follow. Store handles the
  // folder row; this validates the target space, fixes left_team, and cascades
  // the space change onto the child notes (returning them, like database.js).
  moveFolderToSpace(id, spaceId) {
    const folder = this._liveFolderRow(id);
    if (!folder) return { success: false, error: "Folder not found" };
    if (folder.is_default) return { success: false, error: "Cannot move default folders" };
    const targetSpace = this.spacesStore.getSpace(spaceId);
    if (!targetSpace) return { success: false, error: "Space not found" };
    if (folder.space_id === spaceId) return { success: true, folder: this._cloneFolder(folder), notes: [] };

    const oldKind = this.spacesStore.getSpace(folder.space_id)?.kind ?? null;
    const leftTeam = oldKind === "team" && targetSpace.kind === "private" ? 1 : 0;

    const res = this.foldersStore.moveFolderToSpace(id, spaceId);
    if (!res.success) return res;

    // Fix left_team on the folder (store GAP: it can't read spaces.kind).
    const folderRow = this._anyFolderRow(id);
    if (folderRow) folderRow.left_team = leftTeam && folderRow.cloud_id ? 1 : 0;

    // Cascade to the folder's live child notes.
    const noteIds = this.notesStore.getNoteIdsInScope(null, id);
    const now = sqliteNow();
    const notes = [];
    for (const nId of noteIds) {
      const n = this._noteRow(nId);
      if (!n) continue;
      n.space_id = spaceId;
      n.sync_status = "pending";
      n.updated_at = now;
      n.left_team = leftTeam && n.cloud_id ? 1 : 0;
      notes.push({ ...n });
    }
    return { success: true, folder: folderRow ? this._cloneFolder(folderRow) : res.folder, notes };
  }

  // The folder's server row moved into a space this user can't access. Clean
  // server-owned children are dropped; dirty/never-synced children relocate to the
  // private space with forked identities. Reproduces database.js relocateRevokedFolder.
  relocateRevokedFolder(id, privateSpaceId, preserveFolder = false) {
    const key = this._num(id);
    if (this.foldersStore.folderDeleteJournal.has(key) || this.foldersStore.folderDeleteJournal.has(id)) {
      const rollback = this.restoreFolderAfterDeniedDelete(id);
      if (!rollback.success) return rollback;
    }
    const folder = this._anyFolderRow(id);
    if (!folder) return { success: false, error: "Folder not found" };

    const preservedIds = [];
    const deletedNoteIds = [];
    for (const n of this.notesStore.notes.values()) {
      if (!this._eqId(n.folder_id, id)) continue;
      const serverOwned = n.deleted_at != null || (n.sync_status === "synced" && n.cloud_id != null);
      if (n.deleted_at == null && (n.sync_status !== "synced" || n.cloud_id == null)) preservedIds.push(n.id);
      if (serverOwned) deletedNoteIds.push(n.id);
    }

    const serverSet = new Set(deletedNoteIds.map((n) => this._num(n)));
    this._retireConversations(
      (c) => c.note_id != null && serverSet.has(this._num(c.note_id)),
      { scrubSyncedMessages: true }
    );
    this._deleteSpeakerRowsForNoteIds(deletedNoteIds);
    for (const nId of deletedNoteIds) {
      const n = this._noteRow(nId);
      if (n) this.notesStore.notes.delete(n.id);
    }

    const now = sqliteNow();
    for (const nId of preservedIds) {
      const n = this._noteRow(nId);
      if (!n) continue;
      this._forkNoteToPrivate(n, privateSpaceId, preserveFolder ? key : null, now);
      this._detachNoteConversations(nId);
    }

    let preservedFolder = null;
    const folderRow = this._anyFolderRow(id);
    if (preserveFolder) {
      let name = folder.name;
      for (let k = 2; this._liveFolderNameTaken(name, privateSpaceId, key); k++) {
        name = `${folder.name} (${k})`;
      }
      if (folderRow) {
        folderRow.space_id = privateSpaceId;
        folderRow.name = name;
        folderRow.client_folder_id = randomUUID();
        folderRow.cloud_id = null;
        folderRow.sync_status = "pending";
        folderRow.left_team = 0;
        folderRow.updated_at = now;
        preservedFolder = this._cloneFolder(folderRow);
      }
      // Folder-scoped chats follow the preserved folder into the private space.
      for (const c of this.conversationsStore.conversations.values()) {
        if (this._eqId(c.folder_id, id)) c.space_id = privateSpaceId;
      }
    } else {
      this._retireConversations((c) => this._eqId(c.folder_id, id), { scrubSyncedMessages: true });
      if (folderRow) {
        this.foldersStore.folders.delete(folderRow.id);
        this.foldersStore.folderDeleteJournal.delete(folderRow.id);
      }
    }

    const relocatedNotes = preservedIds.map((nId) => {
      const n = this._noteRow(nId);
      return n ? { ...n } : null;
    }).filter(Boolean);

    return { success: true, folderName: folder.name, folder: preservedFolder, relocatedNotes, deletedNoteIds };
  }

  // Remove a whole space. Store drops the space row; this cascades to its notes,
  // folders, conversations and speaker rows, relocating dirty notes to Personal
  // (preserve-dirty) or hard-wiping everything (destructive). Reproduces purgeSpace.
  purgeSpace(localSpaceId, options = {}) {
    const mode = options?.mode ?? "preserve-dirty";
    if (mode !== "preserve-dirty" && mode !== "destructive") {
      return { success: false, error: "Invalid purge mode" };
    }
    const destructive = mode === "destructive";
    const space = this._anySpaceRow(localSpaceId);
    if (!space) return { success: false, error: "Space not found" };
    if (space.kind === "private") return { success: false, error: "Cannot purge the private space" };

    if (!destructive) {
      // Space revocation supersedes any unresolved folder delete in this space.
      const heldFolderIds = [];
      for (const fid of this.foldersStore.folderDeleteJournal.keys()) {
        const f = this._mapGet(this.foldersStore.folders, fid);
        if (f && this._eqId(f.space_id, localSpaceId)) heldFolderIds.push(fid);
      }
      for (const fId of heldFolderIds) {
        const rollback = this.restoreFolderAfterDeniedDelete(fId);
        if (!rollback.success) return rollback;
      }
    }

    const privateSpaceId = this.getPrivateSpaceId();
    const now = sqliteNow();

    // Relocate dirty / never-synced notes to the private root (preserve-dirty).
    let relocated = [];
    if (!destructive && privateSpaceId != null) {
      const preservedIds = [];
      for (const n of this.notesStore.notes.values()) {
        if (
          this._eqId(n.space_id, localSpaceId) &&
          n.deleted_at == null &&
          (n.sync_status !== "synced" || n.cloud_id == null)
        ) {
          preservedIds.push(n.id);
        }
      }
      for (const nId of preservedIds) {
        const n = this._noteRow(nId);
        if (!n) continue;
        this._forkNoteToPrivate(n, privateSpaceId, null, now);
        this._detachNoteConversations(nId);
      }
      relocated = preservedIds.map((nId) => {
        const n = this._noteRow(nId);
        return n ? { ...n } : null;
      }).filter(Boolean);
    }

    // Full ids/names in this space (notes include tombstones, like database.js).
    const noteIds = [];
    for (const n of this.notesStore.notes.values()) {
      if (this._eqId(n.space_id, localSpaceId)) noteIds.push(n.id);
    }
    const folderIdsInSpace = new Set();
    const folderNames = [];
    for (const f of this.foldersStore.folders.values()) {
      if (this._eqId(f.space_id, localSpaceId)) {
        folderNames.push(f.name);
        folderIdsInSpace.add(this._num(f.id));
      }
    }

    const noteInSpace = new Set(noteIds.map((n) => this._num(n)));
    if (destructive) {
      this._hardDeleteConversations(
        (c) =>
          (c.note_id != null && noteInSpace.has(this._num(c.note_id))) ||
          this._eqId(c.space_id, localSpaceId) ||
          (c.folder_id != null && folderIdsInSpace.has(this._num(c.folder_id)))
      );
      for (const fId of folderIdsInSpace) {
        this.foldersStore.folderDeleteJournal.delete(fId);
        this._folderChildJournal.delete(fId);
      }
    } else {
      this._retireConversations(
        (c) => c.note_id != null && noteInSpace.has(this._num(c.note_id)),
        { scrubSyncedMessages: true }
      );
    }

    this._deleteSpeakerRowsForNoteIds(noteIds);
    for (const nId of noteIds) {
      const n = this._noteRow(nId);
      if (n) this.notesStore.notes.delete(n.id);
    }
    // Clear folder refs on notes in OTHER spaces that pointed at this space's folders.
    for (const n of this.notesStore.notes.values()) {
      if (!this._eqId(n.space_id, localSpaceId) && n.folder_id != null && folderIdsInSpace.has(this._num(n.folder_id))) {
        n.folder_id = null;
      }
    }
    if (!destructive) {
      this._retireConversations(
        (c) => this._eqId(c.space_id, localSpaceId) || (c.folder_id != null && folderIdsInSpace.has(this._num(c.folder_id))),
        { scrubSyncedMessages: true }
      );
    }
    for (const fId of folderIdsInSpace) {
      this.foldersStore.folders.delete(fId);
      this.foldersStore.folderDeleteJournal.delete(fId);
      this._folderChildJournal.delete(fId);
    }
    this.spacesStore.spaces.delete(space.id);

    return {
      success: true,
      noteIds,
      folderNames,
      spaceId: localSpaceId,
      relocatedNotes: relocated,
      relocatedCount: relocated.length,
      relocatedTitles: relocated.slice(0, 3).map((n) => n.title),
    };
  }

  // ══ Actions (local) ═════════════════════════════════════════════════════════
  getActions() {
    return this.actionsStore
      .all()
      .slice()
      .sort((a, b) => {
        const ao = a.sort_order ?? 0;
        const bo = b.sort_order ?? 0;
        if (ao !== bo) return ao - bo;
        return this._cmp(a.created_at, b.created_at);
      })
      .map((r) => ({ ...r }));
  }

  getAction(id) {
    const row = this.actionsStore.all().find((r) => this._eqId(r.id, id));
    return row ? { ...row } : null;
  }

  createAction(name, description, prompt, icon = "sparkles") {
    const trimmedName = (name || "").trim();
    const trimmedPrompt = (prompt || "").trim();
    if (!trimmedName) return { success: false, error: "Action name is required" };
    if (!trimmedPrompt) return { success: false, error: "Action prompt is required" };
    const rows = this.actionsStore.all();
    const sortOrder = rows.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0) + 1;
    const now = sqliteNow();
    const row = {
      id: this._nextLocalId(this.actionsStore),
      name: trimmedName,
      description: (description || "").trim(),
      prompt: trimmedPrompt,
      icon: icon || "sparkles",
      is_builtin: 0,
      sort_order: sortOrder,
      created_at: now,
      updated_at: now,
      translation_key: null,
    };
    rows.push(row);
    this.actionsStore.commit();
    return { success: true, action: { ...row } };
  }

  updateAction(id, updates) {
    const row = this.actionsStore.all().find((r) => this._eqId(r.id, id));
    if (!row) return { success: false };
    const allowed = ["name", "description", "prompt", "icon", "sort_order"];
    let changed = false;
    for (const [k, v] of Object.entries(updates)) {
      if (allowed.includes(k) && v !== undefined) {
        row[k] = v;
        changed = true;
      }
    }
    if (!changed) return { success: false };
    row.updated_at = sqliteNow();
    this.actionsStore.commit();
    return { success: true, action: { ...row } };
  }

  deleteAction(id) {
    const rows = this.actionsStore.all();
    const row = rows.find((r) => this._eqId(r.id, id));
    if (!row) return { success: false, error: "Action not found" };
    if (row.is_builtin) return { success: false, error: "Cannot delete built-in actions" };
    this.actionsStore.replaceAll(rows.filter((r) => !this._eqId(r.id, id)));
    return { success: true, id };
  }

  // ══ Google tokens / calendars (local) ═══════════════════════════════════════
  saveGoogleTokens(tokens) {
    const rows = this.googleTokensStore.all();
    const existing = rows.find((r) => r.google_email === tokens.google_email);
    const now = sqliteNow();
    if (existing) {
      existing.access_token = tokens.access_token;
      existing.refresh_token = tokens.refresh_token;
      existing.expires_at = tokens.expires_at;
      existing.scope = tokens.scope;
      existing.updated_at = now;
    } else {
      rows.push({
        id: this._nextLocalId(this.googleTokensStore),
        google_email: tokens.google_email,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
        scope: tokens.scope,
        created_at: now,
        updated_at: now,
      });
    }
    this.googleTokensStore.commit();
    return { success: true };
  }

  getGoogleTokens() {
    const rows = this.googleTokensStore.all();
    return rows.length ? { ...rows[0] } : null;
  }

  getGoogleTokensByEmail(email) {
    const row = this.googleTokensStore.all().find((r) => r.google_email === email);
    return row ? { ...row } : null;
  }

  getAllGoogleTokens() {
    return this.googleTokensStore.all().map((r) => ({ ...r }));
  }

  getGoogleAccounts() {
    return this._byCreatedAsc(this.googleTokensStore.all()).map((r) => ({ email: r.google_email }));
  }

  removeGoogleAccount(email) {
    const calIds = new Set(
      this.googleCalendarsStore.all().filter((c) => c.account_email === email).map((c) => c.id)
    );
    if (calIds.size) {
      this.calendarEventsStore.replaceAll(
        this.calendarEventsStore.all().filter((e) => !(e.provider === "google" && calIds.has(e.calendar_id)))
      );
    }
    this.googleCalendarsStore.replaceAll(
      this.googleCalendarsStore.all().filter((c) => c.account_email !== email)
    );
    this.googleTokensStore.replaceAll(
      this.googleTokensStore.all().filter((t) => t.google_email !== email)
    );
    return { success: true };
  }

  deleteGoogleTokens() {
    this.googleTokensStore.replaceAll([]);
    return { success: true };
  }

  // ══ Gmail tokens (local, for meeting detection) ═════════════════════════════
  // Single-account: Gmail detection connects one mailbox. Kept in its own store
  // so a Gmail (gmail.readonly) grant never disturbs the calendar OAuth grant.
  saveGmailTokens(tokens) {
    const now = sqliteNow();
    const existing = this.gmailTokensStore.all().find((r) => r.gmail_email === tokens.gmail_email);
    if (existing) {
      Object.assign(existing, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || existing.refresh_token,
        expires_at: tokens.expires_at,
        scope: tokens.scope,
        updated_at: now,
      });
      this.gmailTokensStore.commit();
    } else {
      this.gmailTokensStore.replaceAll([
        {
          id: 1,
          gmail_email: tokens.gmail_email,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: tokens.expires_at,
          scope: tokens.scope,
          created_at: now,
          updated_at: now,
        },
      ]);
    }
    return { success: true };
  }

  getGmailTokens() {
    const rows = this.gmailTokensStore.all();
    return rows.length ? { ...rows[0] } : null;
  }

  getGmailAccount() {
    const rows = this.gmailTokensStore.all();
    return rows.length ? { email: rows[0].gmail_email } : null;
  }

  clearGmailData() {
    this.gmailTokensStore.replaceAll([]);
    this.clearProviderCalendarEvents("gmail");
    return { success: true };
  }

  // Drop every calendar_events row for a signal provider ("gmail" | "slack").
  // Used on disconnect / disable — mirrors clearGoogleCalendarData.
  clearProviderCalendarEvents(provider) {
    this.calendarEventsStore.replaceAll(
      this.calendarEventsStore.all().filter((e) => e.provider !== provider)
    );
    return { success: true };
  }

  saveGoogleCalendars(calendars, accountEmail = null) {
    const rows = this.googleCalendarsStore.all();
    const now = sqliteNow();
    for (const cal of calendars) {
      const existing = rows.find((r) => r.id === cal.id);
      if (existing) {
        existing.summary = cal.summary;
        existing.description = cal.description || null;
        existing.background_color = cal.background_color || null;
        existing.account_email = accountEmail;
        existing.is_primary = cal.is_primary ? 1 : 0;
      } else {
        rows.push({
          id: cal.id,
          summary: cal.summary,
          description: cal.description || null,
          background_color: cal.background_color || null,
          is_selected: 1,
          sync_token: null,
          account_email: accountEmail,
          created_at: now,
          is_primary: cal.is_primary ? 1 : 0,
        });
      }
    }
    this.googleCalendarsStore.commit();
    return { success: true };
  }

  applyPrimaryOnlyToSelection(primaryOnly) {
    for (const r of this.googleCalendarsStore.all()) {
      r.is_selected = primaryOnly ? (r.is_primary ? 1 : 0) : 1;
    }
    this.googleCalendarsStore.commit();
    return { success: true };
  }

  getGoogleCalendars(accountEmail = null) {
    const rows = this.googleCalendarsStore.all();
    return (accountEmail ? rows.filter((r) => r.account_email === accountEmail) : rows).map((r) => ({ ...r }));
  }

  updateCalendarSelection(calendarId, isSelected) {
    const row = this.googleCalendarsStore.all().find((r) => r.id === calendarId);
    if (row) {
      row.is_selected = isSelected ? 1 : 0;
      this.googleCalendarsStore.commit();
    }
    return { success: true };
  }

  getSelectedCalendars(accountEmail = null) {
    return this.googleCalendarsStore
      .all()
      .filter((r) => r.is_selected === 1 && (!accountEmail || r.account_email === accountEmail))
      .map((r) => ({ ...r }));
  }

  updateCalendarSyncToken(calendarId, syncToken) {
    const row = this.googleCalendarsStore.all().find((r) => r.id === calendarId);
    if (row) {
      row.sync_token = syncToken;
      this.googleCalendarsStore.commit();
    }
    return { success: true };
  }

  clearGoogleCalendarData() {
    this.calendarEventsStore.replaceAll(this.calendarEventsStore.all().filter((e) => e.provider !== "google"));
    this.googleCalendarsStore.replaceAll([]);
    this.googleTokensStore.replaceAll([]);
    return { success: true };
  }

  // ══ Microsoft tokens / calendars (local) ════════════════════════════════════
  saveMicrosoftTokens(tokens) {
    const rows = this.microsoftTokensStore.all();
    const existing = rows.find((r) => r.microsoft_email === tokens.microsoft_email);
    const now = sqliteNow();
    if (existing) {
      existing.access_token = tokens.access_token;
      existing.refresh_token = tokens.refresh_token;
      existing.expires_at = tokens.expires_at;
      existing.scope = tokens.scope;
      existing.updated_at = now;
    } else {
      rows.push({
        id: this._nextLocalId(this.microsoftTokensStore),
        microsoft_email: tokens.microsoft_email,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
        scope: tokens.scope,
        created_at: now,
        updated_at: now,
      });
    }
    this.microsoftTokensStore.commit();
    return { success: true };
  }

  getMicrosoftTokensByEmail(email) {
    const row = this.microsoftTokensStore.all().find((r) => r.microsoft_email === email);
    return row ? { ...row } : null;
  }

  getMicrosoftAccounts() {
    return this._byCreatedAsc(this.microsoftTokensStore.all()).map((r) => ({ email: r.microsoft_email }));
  }

  removeMicrosoftAccount(email) {
    const calIds = new Set(
      this.microsoftCalendarsStore.all().filter((c) => c.account_email === email).map((c) => c.id)
    );
    if (calIds.size) {
      this.calendarEventsStore.replaceAll(
        this.calendarEventsStore.all().filter((e) => !(e.provider === "microsoft" && calIds.has(e.calendar_id)))
      );
    }
    this.microsoftCalendarsStore.replaceAll(
      this.microsoftCalendarsStore.all().filter((c) => c.account_email !== email)
    );
    this.microsoftTokensStore.replaceAll(
      this.microsoftTokensStore.all().filter((t) => t.microsoft_email !== email)
    );
    return { success: true };
  }

  saveMicrosoftCalendars(calendars, accountEmail) {
    const rows = this.microsoftCalendarsStore.all();
    const now = sqliteNow();
    for (const cal of calendars) {
      const existing = rows.find((r) => r.id === cal.id);
      if (existing) {
        existing.summary = cal.summary;
        existing.background_color = cal.background_color || null;
        existing.account_email = accountEmail;
        existing.is_primary = cal.is_primary ? 1 : 0;
      } else {
        rows.push({
          id: cal.id,
          summary: cal.summary,
          background_color: cal.background_color || null,
          is_selected: 1,
          is_primary: cal.is_primary ? 1 : 0,
          sync_token: null,
          sync_token_expires_at: null,
          account_email: accountEmail,
          created_at: now,
        });
      }
    }
    this.microsoftCalendarsStore.commit();
    return { success: true };
  }

  applyMicrosoftPrimaryOnlyToSelection(primaryOnly) {
    for (const r of this.microsoftCalendarsStore.all()) {
      r.is_selected = primaryOnly ? (r.is_primary ? 1 : 0) : 1;
    }
    this.microsoftCalendarsStore.commit();
    return { success: true };
  }

  getSelectedMicrosoftCalendars() {
    return this.microsoftCalendarsStore.all().filter((r) => r.is_selected === 1).map((r) => ({ ...r }));
  }

  updateMicrosoftCalendarSyncToken(calendarId, syncToken, expiresAt) {
    const row = this.microsoftCalendarsStore.all().find((r) => r.id === calendarId);
    if (row) {
      row.sync_token = syncToken;
      row.sync_token_expires_at = expiresAt;
      this.microsoftCalendarsStore.commit();
    }
    return { success: true };
  }

  clearMicrosoftCalendarData() {
    this.calendarEventsStore.replaceAll(this.calendarEventsStore.all().filter((e) => e.provider !== "microsoft"));
    this.microsoftCalendarsStore.replaceAll([]);
    this.microsoftTokensStore.replaceAll([]);
    return { success: true };
  }

  // ══ Apple calendars (local) ═════════════════════════════════════════════════
  saveAppleCalendars(calendars) {
    const list = Array.isArray(calendars) ? calendars : [];
    if (list.length === 0) {
      this.appleCalendarsStore.replaceAll([]);
      return { success: true };
    }
    const incomingIds = new Set(list.map((c) => c.id));
    const rows = this.appleCalendarsStore.all().filter((r) => incomingIds.has(r.id));
    const now = sqliteNow();
    for (const cal of list) {
      const existing = rows.find((r) => r.id === cal.id);
      if (existing) {
        existing.title = cal.title;
        existing.color = cal.color || null;
        existing.source_name = cal.source_name || null;
      } else {
        rows.push({
          id: cal.id,
          title: cal.title,
          color: cal.color || null,
          source_name: cal.source_name || null,
          created_at: now,
        });
      }
    }
    this.appleCalendarsStore.replaceAll(rows);
    return { success: true };
  }

  getAppleCalendars() {
    return this.appleCalendarsStore.all().map((r) => ({ ...r }));
  }

  replaceAppleCalendarEvents(events) {
    const referenced = this._referencedCalendarEventIds();
    this.calendarEventsStore.replaceAll(
      this.calendarEventsStore.all().filter((e) => !(e.provider === "apple" && !referenced.has(e.id)))
    );
    if (Array.isArray(events) && events.length > 0) this.upsertCalendarEvents(events);
    return { success: true };
  }

  clearAppleCalendarData() {
    this.calendarEventsStore.replaceAll(this.calendarEventsStore.all().filter((e) => e.provider !== "apple"));
    this.appleCalendarsStore.replaceAll([]);
    return { success: true };
  }

  // ══ Calendar events (local) ═════════════════════════════════════════════════
  upsertCalendarEvents(events) {
    const rows = this.calendarEventsStore.all();
    const byId = new Map(rows.map((r) => [r.id, r]));
    const now = sqliteNow();
    for (const e of Array.isArray(events) ? events : []) {
      const row = {
        id: e.id,
        calendar_id: e.calendar_id,
        summary: e.summary || null,
        start_time: e.start_time,
        end_time: e.end_time,
        is_all_day: e.is_all_day ? 1 : 0,
        status: e.status || "confirmed",
        hangout_link: e.hangout_link || null,
        conference_data: e.conference_data || null,
        organizer_email: e.organizer_email || null,
        attendees_count: e.attendees_count || 0,
        synced_at: now,
        provider: e.provider || "google",
        attendees: e.attendees || null,
      };
      const existing = byId.get(e.id);
      if (existing) {
        Object.assign(existing, row);
      } else {
        rows.push(row);
        byId.set(e.id, row);
      }
    }
    this.calendarEventsStore.commit();
    return { success: true };
  }

  getActiveEvents() {
    const now = Date.now();
    const cands = this.calendarEventsStore.all().filter(
      (e) =>
        e.is_all_day === 0 &&
        (e.status === "confirmed" || e.status === "tentative") &&
        this._le(this._toMs(e.start_time), now) &&
        this._gt(this._toMs(e.end_time), now)
    );
    return this._dedupEvents(cands);
  }

  getUpcomingEvents(windowMinutes = 1440) {
    const now = Date.now();
    const limit = now + windowMinutes * 60000;
    const cands = this.calendarEventsStore.all().filter((e) => {
      if (e.is_all_day !== 0) return false;
      if (e.status !== "confirmed" && e.status !== "tentative") return false;
      const s = this._toMs(e.start_time);
      const en = this._toMs(e.end_time);
      const starting = this._gt(s, now) && this._le(s, limit);
      const underway = this._le(s, now) && this._gt(en, now);
      return starting || underway;
    });
    return this._dedupEvents(cands);
  }

  getCalendarEventById(eventId) {
    const row = this.calendarEventsStore.all().find((e) => e.id === eventId);
    return row ? { ...row } : null;
  }

  removeCalendarEvents(eventIds) {
    const drop = new Set(eventIds || []);
    this.calendarEventsStore.replaceAll(this.calendarEventsStore.all().filter((e) => !drop.has(e.id)));
    return { success: true };
  }

  removeStaleCalendarEvents(provider, calendarId, freshEventIds) {
    const fresh = new Set(freshEventIds || []);
    const referenced = this._referencedCalendarEventIds();
    this.calendarEventsStore.replaceAll(
      this.calendarEventsStore
        .all()
        .filter(
          (e) =>
            !(e.provider === provider && e.calendar_id === calendarId && !fresh.has(e.id) && !referenced.has(e.id))
        )
    );
    return { success: true };
  }

  removeEventsFromDeselectedCalendars(provider) {
    const store =
      provider === "google" ? this.googleCalendarsStore : provider === "microsoft" ? this.microsoftCalendarsStore : null;
    if (!store) throw new Error(`Unknown calendar provider: ${provider}`);
    const selected = new Set(store.all().filter((c) => c.is_selected === 1).map((c) => c.id));
    this.calendarEventsStore.replaceAll(
      this.calendarEventsStore.all().filter((e) => !(e.provider === provider && !selected.has(e.calendar_id)))
    );
    return { success: true };
  }

  // ══ Contacts (local) ════════════════════════════════════════════════════════
  upsertContacts(contacts) {
    const rows = this.contactsStore.all();
    const now = sqliteNow();
    for (const c of Array.isArray(contacts) ? contacts : []) {
      if (!c.email) continue;
      const email = c.email.toLowerCase().trim();
      const dn = c.displayName || null;
      const existing = rows.find((r) => r.email === email);
      if (existing) {
        if (dn != null) existing.display_name = dn; // COALESCE(new, existing)
        existing.updated_at = now;
      } else {
        rows.push({ email, display_name: dn, created_at: now, updated_at: now });
      }
    }
    this.contactsStore.commit();
    return { success: true };
  }

  searchContacts(query) {
    const q = (query || "").toLowerCase();
    return this.contactsStore
      .all()
      .filter((r) => (r.email || "").toLowerCase().includes(q) || (r.display_name || "").toLowerCase().includes(q))
      .sort((a, b) => {
        const c = this._cmp(a.display_name, b.display_name);
        return c !== 0 ? c : this._cmp(a.email, b.email);
      })
      .slice(0, 20)
      .map((r) => ({ ...r }));
  }

  // ══ Speaker profiles / mappings / embeddings (local) ════════════════════════
  upsertSpeakerProfile(name, email, embeddingBuffer, profileId = null) {
    const rows = this.speakerProfilesStore.all();
    const normalizedEmail = this._normalizeEmail(email);
    let existing = profileId ? rows.find((p) => this._eqId(p.id, profileId)) : null;
    if (!existing && normalizedEmail) existing = this._findProfileByEmail(normalizedEmail);
    if (!existing) existing = rows.find((p) => p.display_name === name) || null;

    if (existing) {
      const stored = this._f32(existing.embedding);
      const incoming = this._f32(embeddingBuffer);
      const updated = new Float32Array(stored.length);
      for (let i = 0; i < stored.length; i++) updated[i] = 0.3 * incoming[i] + 0.7 * stored[i];
      existing.display_name = name;
      existing.email = normalizedEmail || existing.email || null;
      existing.embedding = Buffer.from(updated.buffer);
      existing.sample_count = (existing.sample_count || 0) + 1;
      existing.updated_at = sqliteNow();
      this.speakerProfilesStore.commit();
      if (normalizedEmail) {
        const collision = rows.find((p) => !this._eqId(p.id, existing.id) && (p.email || "").toLowerCase() === normalizedEmail);
        if (collision) return this.mergeSpeakerProfiles({ ...existing }, { ...collision });
      }
      return { ...existing };
    }

    const row = {
      id: this._nextLocalId(this.speakerProfilesStore),
      display_name: name,
      email: normalizedEmail,
      embedding: embeddingBuffer,
      sample_count: 1,
      created_at: sqliteNow(),
      updated_at: sqliteNow(),
    };
    rows.push(row);
    this.speakerProfilesStore.commit();
    return { ...row };
  }

  attachEmailToProfile(profileId, email) {
    const rows = this.speakerProfilesStore.all();
    const normalizedEmail = this._normalizeEmail(email);
    const profile = rows.find((p) => this._eqId(p.id, profileId));
    if (!profile) throw new Error(`Speaker profile ${profileId} not found`);
    if (!normalizedEmail) {
      profile.email = null;
      profile.updated_at = sqliteNow();
      this.speakerProfilesStore.commit();
      return { ...profile };
    }
    const collision = this._findProfileByEmail(normalizedEmail);
    if (collision && !this._eqId(collision.id, profileId)) {
      return this.mergeSpeakerProfiles({ ...collision }, { ...profile });
    }
    profile.email = normalizedEmail;
    profile.updated_at = sqliteNow();
    this.speakerProfilesStore.commit();
    return { ...profile };
  }

  mergeSpeakerProfiles(a, b) {
    const winner = (a.sample_count || 0) >= (b.sample_count || 0) ? a : b;
    const loser = winner === a ? b : a;
    const winnerEmb = this._f32(winner.embedding);
    const loserEmb = this._f32(loser.embedding);
    const wS = winner.sample_count || 1;
    const lS = loser.sample_count || 1;
    const total = wS + lS;
    const blended = new Float32Array(winnerEmb.length);
    for (let i = 0; i < winnerEmb.length; i++) blended[i] = (winnerEmb[i] * wS + loserEmb[i] * lS) / total;
    const finalEmail = winner.email || loser.email || null;
    const finalName = winner.display_name || loser.display_name;

    const rows = this.speakerProfilesStore.all();
    const winnerRow = rows.find((p) => this._eqId(p.id, winner.id));
    if (winnerRow) {
      winnerRow.display_name = finalName;
      winnerRow.email = finalEmail;
      winnerRow.embedding = Buffer.from(blended.buffer);
      winnerRow.sample_count = total;
      winnerRow.updated_at = sqliteNow();
    }
    let mappingsChanged = false;
    for (const m of this.speakerMappingsStore.all()) {
      if (this._eqId(m.profile_id, loser.id)) {
        m.profile_id = winnerRow ? winnerRow.id : winner.id;
        m.display_name = finalName;
        mappingsChanged = true;
      }
    }
    if (mappingsChanged) this.speakerMappingsStore.commit();
    this.speakerProfilesStore.replaceAll(rows.filter((p) => !this._eqId(p.id, loser.id)));
    return winnerRow ? { ...winnerRow } : null;
  }

  getSpeakerProfiles(includeEmbedding = false) {
    return this.speakerProfilesStore.all().map((p) => {
      if (includeEmbedding) return { ...p };
      return {
        id: p.id,
        display_name: p.display_name,
        email: p.email,
        sample_count: p.sample_count,
        created_at: p.created_at,
        updated_at: p.updated_at,
      };
    });
  }

  setSpeakerMapping(noteId, speakerId, profileId, displayName) {
    const rows = this.speakerMappingsStore.all();
    const existing = rows.find((r) => this._eqId(r.note_id, noteId) && r.speaker_id === speakerId);
    if (existing) {
      existing.profile_id = profileId;
      existing.display_name = displayName;
    } else {
      rows.push({ note_id: noteId, speaker_id: speakerId, profile_id: profileId, display_name: displayName });
    }
    this.speakerMappingsStore.commit();
    return { success: true };
  }

  getSpeakerMappings(noteId) {
    return this.speakerMappingsStore.all().filter((r) => this._eqId(r.note_id, noteId)).map((r) => ({ ...r }));
  }

  saveNoteSpeakerEmbeddings(noteId, embeddings) {
    const rows = this.noteEmbeddingsStore.all();
    for (const [speakerId, buffer] of Object.entries(embeddings || {})) {
      const existing = rows.find((r) => this._eqId(r.note_id, noteId) && r.speaker_id === speakerId);
      if (existing) {
        existing.embedding = buffer;
      } else {
        rows.push({ note_id: noteId, speaker_id: speakerId, embedding: buffer });
      }
    }
    this.noteEmbeddingsStore.commit();
    return { success: true };
  }

  getNoteSpeakerEmbeddings(noteId) {
    return this.noteEmbeddingsStore.all().filter((r) => this._eqId(r.note_id, noteId)).map((r) => ({ ...r }));
  }

  getNotesWithUnmappedSpeakers() {
    const mapped = new Set(this.speakerMappingsStore.all().map((m) => `${m.note_id}::${m.speaker_id}`));
    const seen = new Set();
    const out = [];
    for (const e of this.noteEmbeddingsStore.all()) {
      if (mapped.has(`${e.note_id}::${e.speaker_id}`)) continue;
      if (seen.has(e.note_id)) continue;
      seen.add(e.note_id);
      out.push(e.note_id);
    }
    return out;
  }

  removeSpeakerMapping(noteId, speakerId) {
    this.speakerMappingsStore.replaceAll(
      this.speakerMappingsStore.all().filter((r) => !(this._eqId(r.note_id, noteId) && r.speaker_id === speakerId))
    );
    return { success: true };
  }

  // ══ Pending vector purges (local) ═══════════════════════════════════════════
  addPendingVectorPurge(spaceId) {
    const rows = this.vectorPurgesStore.all();
    if (!rows.some((r) => this._eqId(r.space_id, spaceId))) {
      rows.push({ space_id: spaceId });
      this.vectorPurgesStore.commit();
    }
    return { success: true };
  }

  getPendingVectorPurges() {
    return this.vectorPurgesStore.all().map((r) => ({ space_id: r.space_id }));
  }

  clearPendingVectorPurge(spaceId) {
    this.vectorPurgesStore.replaceAll(this.vectorPurgesStore.all().filter((r) => !this._eqId(r.space_id, spaceId)));
    return { success: true };
  }

  // ══ Lifecycle ═══════════════════════════════════════════════════════════════
  // The SQLite version closes + deletes the on-disk DB (account reset). There is
  // no DB file here; clear every local table and in-memory cache best-effort.
  cleanup() {
    try {
      for (const store of [
        this.actionsStore, this.googleTokensStore, this.googleCalendarsStore,
        this.microsoftTokensStore, this.microsoftCalendarsStore, this.calendarEventsStore,
        this.appleCalendarsStore, this.contactsStore, this.speakerProfilesStore,
        this.speakerMappingsStore, this.noteEmbeddingsStore, this.vectorPurgesStore,
      ]) {
        store.replaceAll([]);
      }
      this.notesStore.notes.clear();
      this.foldersStore.folders.clear();
      this.foldersStore.folderDeleteJournal.clear();
      this.conversationsStore.conversations.clear();
      this.conversationsStore.messages.clear();
      this.transcriptionsStore.transcriptions.clear();
      this.dictionaryStore.words.clear();
      this.snippetsStore.snippets.clear();
      this.spacesStore.spaces.clear();
      this._folderChildJournal.clear();
      // Re-seed the invariants the constructor established.
      this.spacesStore._ensurePrivateSpace();
      this.foldersStore.privateSpaceId = this.spacesStore.getPrivateSpaceId();
      this._seedActions();
    } catch {
      // best-effort; cleanup never throws
    }
  }

  // ══ Internals ═══════════════════════════════════════════════════════════════

  _seedActions() {
    const rows = this.actionsStore.all();
    if (rows.length > 0) return;
    const now = sqliteNow();
    rows.push({
      id: 1,
      name: "Generate Notes",
      description: "Clean up, structure, and enhance your notes",
      prompt: GENERATE_NOTES_PROMPT,
      icon: "sparkles",
      is_builtin: 1,
      sort_order: 0,
      created_at: now,
      updated_at: now,
      translation_key: "notes.actions.builtin.generateNotes",
    });
    this.actionsStore.commit();
  }

  // Normalize an id to the numeric form the store Maps key by (tolerating a
  // numeric-string id from IPC), leaving non-numeric ids untouched.
  _num(id) {
    if (id == null) return id;
    const n = Number(id);
    return Number.isNaN(n) ? id : n;
  }

  // Loose numeric id equality (SQLite coerces int/text; NULL never matches).
  _eqId(a, b) {
    if (a == null || b == null) return false;
    return Number(a) === Number(b);
  }

  // Map lookup tolerating a numeric-string id.
  _mapGet(map, id) {
    if (map.has(id)) return map.get(id);
    const n = this._num(id);
    if (map.has(n)) return map.get(n);
    return null;
  }

  _noteRow(id) { return this._mapGet(this.notesStore.notes, id); }
  _anyFolderRow(id) { return this._mapGet(this.foldersStore.folders, id); }
  _liveFolderRow(id) {
    const f = this._anyFolderRow(id);
    return f && !f.deleted_at ? f : null;
  }
  _anySpaceRow(id) { return this._mapGet(this.spacesStore.spaces, id); }

  _cloneFolder(row) { return { ...row }; }

  // Fork a note into the private space (dirty-note preservation). Mirrors the
  // relocateRevokedFolder / purgeSpace UPDATE column set exactly.
  _forkNoteToPrivate(note, privateSpaceId, folderId, now) {
    note.space_id = privateSpaceId;
    note.folder_id = folderId;
    note.client_note_id = randomUUID();
    note.cloud_id = null;
    note.cloud_updated_at = null;
    note.owner_user_id = null;
    note.updated_by_user_id = null;
    note.sync_status = "pending";
    note.left_team = 0;
    note.is_shared = 0;
    note.share_token = null;
    note.updated_at = now;
  }

  // A note's chats follow the forked note out of a team container.
  _detachNoteConversations(noteId) {
    for (const c of this.conversationsStore.conversations.values()) {
      if (this._eqId(c.note_id, noteId)) {
        c.space_id = null;
        c.folder_id = null;
      }
    }
  }

  _liveFolderNameTaken(name, spaceId, excludeId) {
    for (const f of this.foldersStore.folders.values()) {
      if (f.id === excludeId) continue;
      if (f.name === name && f.space_id === spaceId && !f.deleted_at) return true;
    }
    return false;
  }

  // Journal + tombstone (folder_delete_pending) the live conversations hidden by
  // an optimistic folder delete: folder-scoped OR scoped to one of the folder's
  // live child notes. Returns their pre-delete states.
  _journalAndTombstoneFolderConversations(folderId, noteIds) {
    const noteSet = new Set(noteIds.map((n) => this._num(n)));
    const now = sqliteNow();
    const states = [];
    for (const c of this.conversationsStore.conversations.values()) {
      if (c.deleted_at != null) continue;
      const match = this._eqId(c.folder_id, folderId) || (c.note_id != null && noteSet.has(this._num(c.note_id)));
      if (!match) continue;
      states.push({
        id: c.id,
        sync_status: c.sync_status ?? "pending",
        deleted_at: c.deleted_at ?? null,
        updated_at: c.updated_at ?? null,
      });
      c.deleted_at = now;
      c.sync_status = "folder_delete_pending";
      c.updated_at = now;
    }
    return states;
  }

  // Reproduce database.js _retireConversationsWhere over a predicate:
  //   - delete messages of matched convs (scrub? all : only never-synced),
  //   - hard-delete matched never-synced convs,
  //   - tombstone matched synced convs (default status 'pending').
  _retireConversations(predicate, { scrubSyncedMessages = false, syncedTombstoneStatus = "pending" } = {}) {
    const convs = this.conversationsStore.conversations;
    const msgs = this.conversationsStore.messages;
    const matched = [];
    for (const c of convs.values()) if (predicate(c)) matched.push(c);
    const scrubIds = new Set(
      matched.filter((c) => scrubSyncedMessages || c.cloud_id == null).map((c) => this._num(c.id))
    );
    for (const [mk, m] of msgs) {
      if (scrubIds.has(this._num(m.conversation_id))) msgs.delete(mk);
    }
    const now = sqliteNow();
    for (const c of matched) {
      if (c.cloud_id == null) {
        convs.delete(c.id);
      } else if (c.deleted_at == null) {
        c.deleted_at = now;
        c.sync_status = syncedTombstoneStatus;
        c.updated_at = now;
      }
    }
  }

  // Account-boundary cleanup: hard-delete matched convs + their messages.
  _hardDeleteConversations(predicate) {
    const convs = this.conversationsStore.conversations;
    const msgs = this.conversationsStore.messages;
    const matchedIds = new Set();
    for (const c of convs.values()) if (predicate(c)) matchedIds.add(this._num(c.id));
    for (const [mk, m] of msgs) {
      if (matchedIds.has(this._num(m.conversation_id))) msgs.delete(mk);
    }
    for (const c of [...convs.values()]) {
      if (matchedIds.has(this._num(c.id))) convs.delete(c.id);
    }
  }

  // Speaker rows cascade off a note delete (SQLite ON DELETE CASCADE); reproduce
  // the explicit cleanup callers relied on.
  _deleteSpeakerRowsForNoteIds(noteIds) {
    if (!noteIds || noteIds.length === 0) return;
    const set = new Set(noteIds.map((n) => this._num(n)));
    const sm = this.speakerMappingsStore.all();
    const keptSm = sm.filter((r) => !set.has(this._num(r.note_id)));
    if (keptSm.length !== sm.length) this.speakerMappingsStore.replaceAll(keptSm);
    const nse = this.noteEmbeddingsStore.all();
    const keptNse = nse.filter((r) => !set.has(this._num(r.note_id)));
    if (keptNse.length !== nse.length) this.noteEmbeddingsStore.replaceAll(keptNse);
  }

  // calendar_event_ids referenced by live meeting notes (retention guard).
  _referencedCalendarEventIds() {
    const s = new Set();
    for (const n of this.notesStore.notes.values()) {
      if (n.deleted_at == null && n.calendar_event_id != null) s.add(n.calendar_event_id);
    }
    return s;
  }

  _normalizeEmail(email) {
    const t = (email || "").trim().toLowerCase();
    return t || null;
  }

  _findProfileByEmail(email) {
    const n = this._normalizeEmail(email);
    if (!n) return null;
    return this.speakerProfilesStore.all().find((p) => (p.email || "").toLowerCase() === n) || null;
  }

  // Float32Array view over a Buffer (embeddings are stored as BLOB/Buffer).
  _f32(buf) {
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  }

  // Suppress the Apple copy of a meeting when a REST (Google/Microsoft) row
  // occupies the same time slot + title, then order by start ASC. Reproduces
  // dedupedEventsQuery + stripDedupeColumn from database.js.
  _dedupEvents(candidates) {
    const partitions = new Map();
    for (const e of candidates) {
      const key = `${this._sqlDatetime(e.start_time)}|${this._sqlDatetime(e.end_time)}|${e.summary ?? ""}`;
      let arr = partitions.get(key);
      if (!arr) { arr = []; partitions.set(key, arr); }
      arr.push(e);
    }
    const out = [];
    for (const arr of partitions.values()) {
      const hasSynced = arr.some((e) => e.provider !== "apple");
      for (const e of arr) if (e.provider !== "apple" || !hasSynced) out.push(e);
    }
    out.sort((a, b) => (this._toMs(a.start_time) ?? 0) - (this._toMs(b.start_time) ?? 0));
    return out.map((e) => ({ ...e }));
  }

  // datetime() normalization to UTC "YYYY-MM-DD HH:MM:SS" for dedup partition keys.
  _sqlDatetime(ts) {
    const ms = this._toMs(ts);
    if (ms == null) return String(ts);
    return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
  }

  _toMs(ts) {
    const ms = Date.parse(ts);
    return Number.isNaN(ms) ? null : ms;
  }

  _le(a, b) { return a != null && a <= b; }
  _gt(a, b) { return a != null && a > b; }

  // Stable ascending sort by created_at (ties by insertion/id order).
  _byCreatedAsc(rows) {
    return rows
      .map((r, i) => [r, i])
      .sort((x, y) => {
        const c = this._cmp(x[0].created_at, y[0].created_at);
        return c !== 0 ? c : x[1] - y[1];
      })
      .map(([r]) => r);
  }

  // SQLite default BINARY collation (code-unit order); null sorts as "".
  _cmp(a, b) {
    const as = a == null ? "" : String(a);
    const bs = b == null ? "" : String(b);
    if (as < bs) return -1;
    if (as > bs) return 1;
    return 0;
  }

  // Next AUTOINCREMENT-style id for a local table (max existing + 1).
  _nextLocalId(store) {
    let max = 0;
    for (const r of store.all()) {
      if (typeof r.id === "number" && r.id > max) max = r.id;
    }
    return max + 1;
  }
}

module.exports = ConvexDatabaseManager;
