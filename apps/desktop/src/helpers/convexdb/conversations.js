// Agent-conversations + agent-messages domain, migrated off SQLite onto
// Convex. INERT: this file reproduces the DatabaseManager surface but is not yet
// wired into anything.
//
// The Electron main process calls these methods SYNCHRONOUSLY and expects the
// exact return shapes SQLite produced. We satisfy that by keeping an
// in-memory cache of the `agent_conversations` and `agent_messages` rows: reads
// are served synchronously from memory, writes mutate memory synchronously (so a
// read-after-write is consistent) and additionally fire a best-effort async
// Convex mutation that is never awaited and never allowed to throw.
//
// ── Parity target (apps/desktop/src/helpers/database.js) ──────────────────────
//   createAgentConversation, getConversationsForNote, getConversationsForContainer,
//   getAgentConversations, getAgentConversation, deleteAgentConversation,
//   updateAgentConversationTitle, addAgentMessage, getAgentMessages,
//   getAgentConversationsWithPreview, searchAgentConversations,
//   archiveAgentConversation, unarchiveAgentConversation,
//   updateAgentConversationCloudId, getPendingConversations,
//   getPendingConversationDeletes, getConversationByClientId,
//   upsertConversationFromCloud, markConversationSynced, hardDeleteConversation.
//
// Row layouts reproduced verbatim (SELECT * column order is significant — callers
// receive plain objects whose key order matches the table):
//   agent_conversations: id, title, created_at, updated_at, archived_at, cloud_id,
//                        note_id, space_id, folder_id, client_conversation_id,
//                        sync_status, deleted_at
//   agent_messages:      id, conversation_id, role, content, created_at, metadata
// `id` columns are client-side numeric (SQLite AUTOINCREMENT); `cloud_id` is the
// Convex `_id` string; `client_conversation_id` is a UUID; message `metadata` is a
// JSON *string* (or null) exactly as SQLite stored it — never a parsed object.
//
// ── Convex mapping (convex/conversations.ts + convex/schema.ts) ───────────────
//   Convex models a conversation (client_conversation_id, title, archived_at,
//   deleted_at, created_at, updated_at) and its messages in a SEPARATE table
//   (conversationMessages), read back per-conversation via `listMessages`.
//     load()                         -> conversations.list  (+ listMessages each)
//     createAgentConversation        -> conversations.create   {input}
//     updateAgentConversationTitle   -> conversations.update   {id, input:{title}}
//     archive/unarchiveAgentConversation -> conversations.update {id, input:{archived_at}}
//     deleteAgentConversation        -> conversations.remove   {id}     (soft delete)
//     addAgentMessage                -> conversations.addMessage {conversation_id, message}
//   Cloud writes fire only for PUSHABLE rows (space_id == null && folder_id == null,
//   mirroring getPendingConversations) and, for update/remove/addMessage, only once
//   the row owns a cloud_id.
//
// ── Memory-only methods (no Convex write-through, by design) ──────────────────
//   updateAgentConversationCloudId / markConversationSynced (local sync bookkeeping),
//   hardDeleteConversation (cache eviction after server ack / account reset),
//   upsertConversationFromCloud (inbound mirror — writing back would be circular),
//   and every reader.
//
// ── GAPs (documented divergences from the SQLite version) ─────────────────────
//   1. createAgentConversation's cross-entity validation (that the referenced
//      note/space/folder exists, is not deleted, and is mutually consistent) is
//      NOT reproduced — this store owns only conversations/messages, not the
//      notes/spaces/folders tables. Ids are accepted as given; it never returns
//      null for a missing referenced entity. Global chats (all three null) behave
//      identically to SQLite.
//   2. The `optimistic_folder_delete_rows` table is not modeled, so
//      getConversationByClientId.folder_delete_pending is always 0 and
//      getPendingConversationDeletes applies no NOT-EXISTS suppression.
//   3. note_id/space_id/folder_id are local-only scoping columns; the Convex
//      conversations contract does not carry them (toCloudConversation omits
//      them), so container/note scope never round-trips through the cloud.
//   4. upsertConversationFromCloud ignores cloudConv.archived_at — faithful to the
//      SQLite upsert, whose INSERT/UPDATE column set excludes archived_at.
//   5. `ORDER BY updated_at DESC` (and message `created_at ASC`) ties are broken by
//      id (DESC / ASC respectively); SQLite leaves tie order unspecified, so this
//      is a deterministic approximation.
//   6. Locally generated timestamps use SQLite's datetime('now') format
//      ("YYYY-MM-DD HH:MM:SS", UTC); cloud-seeded rows keep their ISO-8601 strings
//      — exactly the mix the real merged SQLite table would hold.

const { randomUUID } = require("crypto");
const { anyApi } = require("convex/server");

class ConversationsStore {
  /**
   * @param {import("convex/browser").ConvexHttpClient | null} client Shared
   *   Convex HTTP client (created in ./client.js). May be null — then the store
   *   operates purely in-memory and never touches Convex.
   */
  constructor(client) {
    this.client = client || null;
    // local numeric id -> row object
    this.conversations = new Map();
    this.messages = new Map();
    this._nextConvId = 1;
    this._nextMsgId = 1;
    // Bumped by resetCache() on an account switch; fences in-flight load()s.
    this._epoch = 0;
  }

  // ─── Identity reset ────────────────────────────────────────────────────────

  // Drop every cached conversation AND its messages so nothing belonging to the
  // PREVIOUS signed-in user can be served to the next one. The `_epoch` bump
  // fences a load() that is already in flight: it captured the epoch before its
  // await, so on resume it discards the old user's rows instead of merging them
  // into the fresh cache.
  resetCache() {
    this._epoch += 1;
    this.conversations.clear();
    this.messages.clear();
    this._nextConvId = 1;
    this._nextMsgId = 1;
  }

  // ─── Cache load ────────────────────────────────────────────────────────────

  // Populate the cache from Convex. Safe to call more than once: conversations
  // are matched by client_conversation_id (falling back to cloud_id), so repeats
  // update in place instead of forking. Best-effort; never throws.
  async load() {
    if (!this.client) return;
    const epoch = this._epoch;
    let cloudConvs;
    try {
      cloudConvs = await this.client.query(anyApi.conversations.list, {});
    } catch (err) {
      console.warn(
        "[ConversationsStore] load: conversations.list query failed:",
        err?.message || err
      );
      return;
    }
    // The account switched while this query was in flight — these rows belong to
    // the previous user and must never land in the new user's cache.
    if (epoch !== this._epoch) return;
    if (!Array.isArray(cloudConvs)) return;
    for (const cloud of cloudConvs) {
      let messages = [];
      try {
        messages = await this.client.query(anyApi.conversations.listMessages, {
          conversation_id: cloud.id,
        });
      } catch (err) {
        console.warn(
          "[ConversationsStore] load: listMessages query failed:",
          err?.message || err
        );
        messages = [];
      }
      // Re-checked every iteration: this loop awaits once per conversation, so a
      // switch can land mid-loop. Stop rather than keep filling the new user's
      // cache with the previous user's threads.
      if (epoch !== this._epoch) return;
      if (!Array.isArray(messages)) messages = [];
      // Reuse the inbound-mirror path so load() and a later sync pull agree.
      this.upsertConversationFromCloud(cloud, messages);
    }
  }

  // ─── Conversations: create / read ──────────────────────────────────────────

  createAgentConversation(title = "Untitled", noteId = null, spaceId = null, folderId = null) {
    // GAP #1: cross-entity note/space/folder validation is not reproduced.
    const now = this._sqliteNow();
    const clientConversationId = randomUUID();
    const row = this._convRow({
      id: this._allocConvId(),
      title,
      created_at: now,
      updated_at: now,
      archived_at: null,
      cloud_id: null,
      note_id: noteId,
      space_id: spaceId,
      folder_id: folderId,
      client_conversation_id: clientConversationId,
      sync_status: "pending",
      deleted_at: null,
    });
    this.conversations.set(row.id, row);

    // Write-through only for the pushable set (global- or note-scoped chats).
    if (this._isPushable(row)) {
      this._fireMutation(
        anyApi.conversations.create,
        {
          input: {
            client_conversation_id: row.client_conversation_id,
            title: row.title,
            created_at: row.created_at,
            updated_at: row.updated_at,
          },
        },
        "createAgentConversation"
      );
    }
    return this._cloneConv(row);
  }

  getConversationsForNote(noteId, limit = 20) {
    if (noteId == null) return [];
    const rows = [...this.conversations.values()].filter(
      (c) => !c.deleted_at && this._eqId(c.note_id, noteId)
    );
    rows.sort((a, b) => this._byUpdatedDesc(a, b));
    return rows.slice(0, limit).map((c) => this._previewCountRow(c));
  }

  // Space-root scope (folderId null) intentionally excludes folder-scoped
  // conversations — each container surfaces only its own chats.
  getConversationsForContainer(spaceId, folderId = null, limit = 20) {
    const rows = [...this.conversations.values()].filter((c) => {
      if (c.deleted_at) return false;
      if (folderId != null) return this._eqId(c.folder_id, folderId);
      return this._eqId(c.space_id, spaceId) && c.folder_id == null;
    });
    rows.sort((a, b) => this._byUpdatedDesc(a, b));
    return rows.slice(0, limit).map((c) => this._previewCountRow(c));
  }

  getAgentConversations(limit = 50) {
    const rows = [...this.conversations.values()].filter(
      (c) => !c.deleted_at && c.space_id == null && c.folder_id == null
    );
    rows.sort((a, b) => this._byUpdatedDesc(a, b));
    return rows.slice(0, limit).map((c) => this._cloneConv(c));
  }

  getAgentConversation(id) {
    const conv = this._getConv(id);
    if (!conv || conv.deleted_at) return null;
    const messages = this._messagesFor(conv.id).map((m) => this._cloneMsg(m));
    return { ...this._cloneConv(conv), messages };
  }

  getAgentConversationsWithPreview(limit = 50, offset = 0, includeArchived = false) {
    const rows = [...this.conversations.values()].filter((c) => {
      if (c.deleted_at || c.space_id != null || c.folder_id != null) return false;
      return includeArchived ? c.archived_at != null : c.archived_at == null;
    });
    rows.sort((a, b) => this._byUpdatedDesc(a, b));
    return rows.slice(offset, offset + limit).map((c) => this._previewRow(c));
  }

  searchAgentConversations(query, limit = 20) {
    const needle = String(query ?? "").toLowerCase();
    const rows = [...this.conversations.values()].filter((c) => {
      if (c.deleted_at || c.archived_at != null) return false;
      if (c.space_id != null || c.folder_id != null) return false;
      const titleHit = String(c.title ?? "").toLowerCase().includes(needle);
      return titleHit || this._hasMessageMatching(c.id, needle);
    });
    rows.sort((a, b) => this._byUpdatedDesc(a, b));
    return rows.slice(0, limit).map((c) => this._previewRow(c));
  }

  // ─── Conversations: mutate ─────────────────────────────────────────────────

  deleteAgentConversation(id) {
    const conv = this._getConv(id);
    if (!conv) return { success: false };
    const now = this._sqliteNow();
    conv.deleted_at = now;
    conv.sync_status = "pending";
    conv.updated_at = now;
    if (conv.cloud_id) {
      this._fireMutation(
        anyApi.conversations.remove,
        { id: conv.cloud_id },
        "deleteAgentConversation"
      );
    }
    return { success: true };
  }

  updateAgentConversationTitle(id, title) {
    const conv = this._getConv(id);
    if (!conv || conv.deleted_at) return { success: false };
    conv.title = title;
    conv.updated_at = this._sqliteNow();
    if (conv.cloud_id) {
      this._fireMutation(
        anyApi.conversations.update,
        { id: conv.cloud_id, input: { title } },
        "updateAgentConversationTitle"
      );
    }
    return { success: true };
  }

  archiveAgentConversation(id) {
    const conv = this._getConv(id);
    if (!conv || conv.deleted_at) return { success: false };
    const now = this._sqliteNow();
    conv.archived_at = now;
    if (conv.cloud_id) {
      this._fireMutation(
        anyApi.conversations.update,
        { id: conv.cloud_id, input: { archived_at: now } },
        "archiveAgentConversation"
      );
    }
    return { success: true };
  }

  unarchiveAgentConversation(id) {
    const conv = this._getConv(id);
    if (!conv || conv.deleted_at) return { success: false };
    conv.archived_at = null;
    if (conv.cloud_id) {
      this._fireMutation(
        anyApi.conversations.update,
        { id: conv.cloud_id, input: { archived_at: null } },
        "unarchiveAgentConversation"
      );
    }
    return { success: true };
  }

  // Local sync bookkeeping (assign the cloud id after a create was accepted) —
  // memory-only, exactly like the SQLite UPDATE. No write-through.
  updateAgentConversationCloudId(id, cloudId) {
    const conv = this._getConv(id);
    if (!conv || conv.deleted_at) return { success: false };
    conv.cloud_id = cloudId;
    return { success: true };
  }

  // ─── Messages ──────────────────────────────────────────────────────────────

  addAgentMessage(conversationId, role, content, metadata) {
    const conv = this._getConv(conversationId);
    if (!conv || conv.deleted_at) return null;
    const now = this._sqliteNow();
    const metadataStr = metadata ? JSON.stringify(metadata) : null;
    const row = this._msgRow({
      id: this._allocMsgId(),
      conversation_id: conv.id,
      role,
      content,
      created_at: now,
      metadata: metadataStr,
    });
    this.messages.set(row.id, row);
    conv.updated_at = now; // bump the conversation

    if (conv.cloud_id) {
      this._fireMutation(
        anyApi.conversations.addMessage,
        {
          conversation_id: conv.cloud_id,
          // Convex stores metadata as an object (v.any()); send the original.
          message: { role, content, metadata: metadata ?? null, created_at: now },
        },
        "addAgentMessage"
      );
    }
    return this._cloneMsg(row);
  }

  getAgentMessages(conversationId) {
    return this._messagesFor(conversationId).map((m) => this._cloneMsg(m));
  }

  // ─── Sync surface ──────────────────────────────────────────────────────────

  getPendingConversations() {
    // Container chats (space_id/folder_id set) are kept local — the cloud
    // contract has no space/folder scope, so another device must not pull them
    // as global chats.
    const rows = [...this.conversations.values()].filter(
      (c) => c.sync_status === "pending" && !c.deleted_at && c.space_id == null && c.folder_id == null
    );
    return rows.map((c) => this._cloneConv(c));
  }

  getPendingConversationDeletes() {
    // GAP #2: no optimistic_folder_delete_rows suppression.
    const rows = [...this.conversations.values()].filter(
      (c) => c.deleted_at != null && c.cloud_id != null && c.sync_status === "pending"
    );
    return rows.map((c) => this._cloneConv(c));
  }

  getConversationByClientId(clientId) {
    const conv = this._findByClientId(clientId);
    if (!conv) return null;
    // GAP #2: folder_delete_pending always 0 (table not modeled).
    return { ...this._cloneConv(conv), folder_delete_pending: 0 };
  }

  // Inbound mirror: cloud conversation (+ its messages) -> local cache. The data
  // already lives in Convex (called from load() and from a sync pull), so this is
  // memory-only — writing it back would be circular.
  upsertConversationFromCloud(cloudConv, messages) {
    // A local tombstone represents an unacknowledged delete: a newer live cloud
    // revision must not cancel that intent or restore message bodies. Match by
    // client_conversation_id, falling back to cloud id for legacy rows.
    let existing = null;
    if (cloudConv.client_conversation_id != null) {
      existing = this._findByClientId(cloudConv.client_conversation_id);
    }
    if (!existing && cloudConv.id != null) {
      existing = this._findByCloudId(cloudConv.id);
    }
    if (existing?.deleted_at) return this._cloneConv(existing);

    let conv;
    if (existing) {
      // ON CONFLICT DO UPDATE: only cloud_id/title/note_id/sync_status/updated_at
      // (created_at, archived_at, scope and deleted_at are left untouched).
      existing.cloud_id = cloudConv.id ?? null;
      existing.title = cloudConv.title ?? "Untitled";
      existing.note_id = cloudConv.note_id ?? null;
      existing.sync_status = "synced";
      existing.updated_at = cloudConv.updated_at ?? new Date().toISOString();
      conv = existing;
    } else {
      conv = this._convRow({
        id: this._allocConvId(),
        title: cloudConv.title ?? "Untitled",
        created_at: cloudConv.created_at ?? new Date().toISOString(),
        updated_at: cloudConv.updated_at ?? new Date().toISOString(),
        archived_at: null, // GAP #4: cloudConv.archived_at intentionally ignored.
        cloud_id: cloudConv.id ?? null,
        note_id: cloudConv.note_id ?? null,
        space_id: null,
        folder_id: null,
        client_conversation_id: cloudConv.client_conversation_id ?? null,
        sync_status: "synced",
        deleted_at: null,
      });
      this.conversations.set(conv.id, conv);
    }

    // Replace this conversation's messages wholesale (mirror the DELETE + INSERT).
    this._deleteMessagesFor(conv.id);
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        const row = this._msgRow({
          id: this._allocMsgId(),
          conversation_id: conv.id,
          role: msg.role ?? "user",
          content: msg.content ?? "",
          created_at: msg.created_at ?? new Date().toISOString(),
          metadata: msg.metadata ? JSON.stringify(msg.metadata) : null,
        });
        this.messages.set(row.id, row);
      }
    }
    return this._cloneConv(conv);
  }

  markConversationSynced(id, cloudId) {
    const conv = this._getConv(id);
    if (!conv) return { success: false };
    // COALESCE(cloud_id, ?) — keep an existing cloud id, otherwise adopt the arg.
    if (conv.cloud_id == null) conv.cloud_id = cloudId;
    conv.sync_status = conv.deleted_at == null ? "synced" : "pending";
    return { success: true };
  }

  hardDeleteConversation(id) {
    const conv = this._getConv(id);
    this._deleteMessagesFor(conv ? conv.id : id);
    const existed = conv != null;
    if (conv) this.conversations.delete(conv.id);
    return { success: existed };
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  _allocConvId() {
    const id = this._nextConvId;
    this._nextConvId = id + 1;
    return id;
  }

  _allocMsgId() {
    const id = this._nextMsgId;
    this._nextMsgId = id + 1;
    return id;
  }

  // Look up by numeric id, tolerating a numeric-string id from IPC callers.
  _getConv(id) {
    if (this.conversations.has(id)) return this.conversations.get(id);
    const n = Number(id);
    if (!Number.isNaN(n) && this.conversations.has(n)) return this.conversations.get(n);
    return null;
  }

  _findByClientId(clientId) {
    if (clientId == null) return null;
    for (const c of this.conversations.values()) {
      if (c.client_conversation_id === clientId) return c;
    }
    return null;
  }

  _findByCloudId(cloudId) {
    if (cloudId == null) return null;
    for (const c of this.conversations.values()) {
      if (c.cloud_id === cloudId) return c;
    }
    return null;
  }

  // A conversation syncs to the cloud only when it has neither space nor folder
  // scope — the cloud contract models global (and note-tagged) chats only.
  _isPushable(conv) {
    return conv.space_id == null && conv.folder_id == null;
  }

  // Messages of a conversation, ordered created_at ASC (id ASC tiebreak).
  _messagesFor(conversationId) {
    const conv = this._getConv(conversationId);
    const cid = conv ? conv.id : conversationId;
    const rows = [];
    for (const m of this.messages.values()) {
      if (this._eqId(m.conversation_id, cid)) rows.push(m);
    }
    rows.sort((a, b) => {
      const c = this._compareBinary(a.created_at, b.created_at);
      return c !== 0 ? c : a.id - b.id;
    });
    return rows;
  }

  _messageCount(conversationId) {
    let n = 0;
    const conv = this._getConv(conversationId);
    const cid = conv ? conv.id : conversationId;
    for (const m of this.messages.values()) {
      if (this._eqId(m.conversation_id, cid)) n += 1;
    }
    return n;
  }

  _hasMessageMatching(conversationId, lowerNeedle) {
    for (const m of this.messages.values()) {
      if (
        this._eqId(m.conversation_id, conversationId) &&
        String(m.content ?? "").toLowerCase().includes(lowerNeedle)
      ) {
        return true;
      }
    }
    return false;
  }

  _deleteMessagesFor(conversationId) {
    for (const [key, m] of this.messages) {
      if (this._eqId(m.conversation_id, conversationId)) this.messages.delete(key);
    }
  }

  // { id, title, created_at, updated_at, message_count } — matches the
  // getConversationsForNote / getConversationsForContainer projection.
  _previewCountRow(conv) {
    return {
      id: conv.id,
      title: conv.title,
      created_at: conv.created_at,
      updated_at: conv.updated_at,
      message_count: this._messageCount(conv.id),
    };
  }

  // { id, title, created_at, updated_at, archived_at, cloud_id, message_count,
  //   last_message, last_message_role } — matches the with-preview / search shape.
  _previewRow(conv) {
    const msgs = this._messagesFor(conv.id);
    const last = msgs.length ? msgs[msgs.length - 1] : null;
    return {
      id: conv.id,
      title: conv.title,
      created_at: conv.created_at,
      updated_at: conv.updated_at,
      archived_at: conv.archived_at,
      cloud_id: conv.cloud_id,
      message_count: msgs.length,
      last_message: last ? last.content : null,
      last_message_role: last ? last.role : null,
    };
  }

  // Build a full agent_conversations row with the exact SELECT * key order.
  _convRow(f) {
    return {
      id: f.id,
      title: f.title,
      created_at: f.created_at,
      updated_at: f.updated_at,
      archived_at: f.archived_at ?? null,
      cloud_id: f.cloud_id ?? null,
      note_id: f.note_id ?? null,
      space_id: f.space_id ?? null,
      folder_id: f.folder_id ?? null,
      client_conversation_id: f.client_conversation_id ?? null,
      sync_status: f.sync_status ?? "pending",
      deleted_at: f.deleted_at ?? null,
    };
  }

  // Build a full agent_messages row with the exact SELECT * key order.
  _msgRow(f) {
    return {
      id: f.id,
      conversation_id: f.conversation_id,
      role: f.role,
      content: f.content,
      created_at: f.created_at,
      metadata: f.metadata ?? null,
    };
  }

  // Defensive copies so callers can't mutate the cache (all fields are primitives
  // or null, so a shallow spread is a full clone; key order is preserved).
  _cloneConv(row) {
    return { ...row };
  }

  _cloneMsg(row) {
    return { ...row };
  }

  // datetime('now') / CURRENT_TIMESTAMP format: "YYYY-MM-DD HH:MM:SS" in UTC.
  _sqliteNow() {
    return new Date().toISOString().slice(0, 19).replace("T", " ");
  }

  // Loose numeric id equality (SQLite coerces `col = ?` across int/text). A null
  // on either side never matches (mirrors SQL `col = NULL`).
  _eqId(a, b) {
    if (a == null || b == null) return false;
    return Number(a) === Number(b);
  }

  // ORDER BY updated_at DESC, id DESC (GAP #5 tiebreak). Binary (code-unit)
  // string comparison to match SQLite's default collation.
  _byUpdatedDesc(a, b) {
    const c = this._compareBinary(a.updated_at, b.updated_at);
    if (c !== 0) return -c;
    return b.id - a.id;
  }

  _compareBinary(a, b) {
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
          console.warn(`[ConversationsStore] ${label} write-through failed:`, err?.message || err)
        );
      }
    } catch (err) {
      console.warn(`[ConversationsStore] ${label} write-through threw:`, err?.message || err);
    }
  }
}

module.exports = { ConversationsStore };
