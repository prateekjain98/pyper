#!/usr/bin/env node
/**
 * Assertion-based tests for the Convex backend, run against a live deployment
 * with MOCKED auth (server falls back to DEV_SUBJECT). Exercises notes + folders
 * happy paths and edge cases: idempotent upsert, optimistic-concurrency conflict,
 * not-found, owner scoping, and soft-delete visibility.
 *
 *   CONVEX_URL="https://<dev>.convex.cloud" node apps/desktop/scripts/convex-test.mjs
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const url = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
if (!url) {
  console.error("Set CONVEX_URL (see apps/desktop/.env.local).");
  process.exit(1);
}
const c = new ConvexHttpClient(url);
const RUN = `test-${Date.now()}`;
const cid = (s) => `${RUN}-${s}`;
let pass = 0;
const lines = [];

async function t(name, fn) {
  try {
    await fn();
    pass++;
    lines.push(`  ✅ ${name}`);
  } catch (e) {
    lines.push(`  ❌ ${name}\n       → ${e.message}`);
  }
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function ok(cond, msg) {
  if (!cond) throw new Error(msg);
}

const createNote = (input) => c.mutation(api.notes.create, { input });
const listNotes = (args = {}) => c.query(api.notes.list, args);
const updateNote = (id, input) => c.mutation(api.notes.update, { id, input });
const removeNote = (id) => c.mutation(api.notes.remove, { id });

let total = 0;
const test = (name, fn) => {
  total++;
  return t(name, fn);
};

// ── Notes ──────────────────────────────────────────────────────────────────
await test("notes.create returns a well-formed note with defaults", async () => {
  const n = await createNote({ client_note_id: cid("n1"), content: "hello", title: "T1" });
  ok(typeof n.id === "string" && n.id.length > 0, "id missing");
  eq(n.client_note_id, cid("n1"), "client_note_id");
  eq(n.content, "hello", "content");
  eq(n.title, "T1", "title");
  eq(n.note_type, "personal", "note_type default");
  eq(n.user_id, "dev-user", "owner scoping (user_id)");
  eq(n.deleted_at, null, "deleted_at should be null on create");
  ok(typeof n.created_at === "string" && typeof n.updated_at === "string", "timestamps are strings");
});

await test("notes.create is idempotent by client_note_id (no duplicate row)", async () => {
  const a = await createNote({ client_note_id: cid("idem"), content: "a" });
  const b = await createNote({ client_note_id: cid("idem"), content: "b" });
  eq(b.id, a.id, "same row adopted on re-create");
  eq(b.content, "b", "content updated on re-create");
  const matches = (await listNotes({ limit: 500 })).filter((n) => n.client_note_id === cid("idem"));
  eq(matches.length, 1, "exactly one row for the client id");
});

await test("notes.update advances with correct base_updated_at", async () => {
  const n = await createNote({ client_note_id: cid("upd"), content: "v1" });
  const r = await updateNote(n.id, { content: "v2", base_updated_at: n.updated_at });
  eq(r.status, "ok", "status");
  eq(r.note.content, "v2", "content updated");
  ok(r.note.updated_at >= n.updated_at, "updated_at advanced");
});

await test("notes.update with stale base_updated_at → conflict (optimistic concurrency)", async () => {
  const n = await createNote({ client_note_id: cid("conf"), content: "v1" });
  const first = await updateNote(n.id, { content: "v2", base_updated_at: n.updated_at });
  eq(first.status, "ok", "first update ok");
  const stale = await updateNote(n.id, { content: "v3", base_updated_at: n.updated_at });
  eq(stale.status, "conflict", "stale base must conflict");
  ok(stale.note && stale.note.content === "v2", "conflict returns current server note");
});

await test("notes.update nonexistent id → not_found", async () => {
  eq((await updateNote("nonexistent-id", { content: "z" })).status, "not_found", "status");
});

await test("notes.list EXCLUDES soft-deleted notes (online-only)", async () => {
  const n = await createNote({ client_note_id: cid("del"), content: "delete me" });
  eq((await removeNote(n.id)).status, "ok", "remove status");
  const found = (await listNotes({ limit: 500 })).find((x) => x.id === n.id);
  ok(!found, "soft-deleted note must NOT appear in the default list");
});

await test("notes.list returns live notes with latest content", async () => {
  const n = await createNote({ client_note_id: cid("live"), content: "orig" });
  await updateNote(n.id, { content: "latest", base_updated_at: n.updated_at });
  const found = (await listNotes({ limit: 500 })).find((x) => x.id === n.id);
  ok(found, "live note present");
  eq(found.content, "latest", "latest content reflected");
});

await test("notes.remove nonexistent id → not_found", async () => {
  eq((await removeNote("nonexistent-id")).status, "not_found", "status");
});

await test("all listed notes are owner-scoped to dev-user", async () => {
  ok((await listNotes({ limit: 500 })).every((n) => n.user_id === "dev-user"), "every note owned by dev-user");
});

await test("notes.search finds by content and excludes deleted", async () => {
  const term = `zzq${Date.now()}`;
  const n = await createNote({ client_note_id: cid("search"), content: `budget review ${term} notes` });
  const hit = await c.query(api.notes.search, { query: term });
  ok(hit.find((r) => r.id === n.id), "note found by full-text search");
  await removeNote(n.id);
  const afterDelete = await c.query(api.notes.search, { query: term });
  ok(!afterDelete.find((r) => r.id === n.id), "deleted note excluded from search");
});

// ── Folders ────────────────────────────────────────────────────────────────
const createFolder = (input) => c.mutation(api.folders.create, { input });
const listFolders = (args = {}) => c.query(api.folders.list, args);
const updateFolder = (id, input) => c.mutation(api.folders.update, { id, input });
const removeFolder = (id) => c.mutation(api.folders.remove, { id });

await test("folders.create returns a well-formed folder with defaults", async () => {
  const f = await createFolder({ client_folder_id: cid("f1"), name: "Folder A" });
  ok(typeof f.id === "string", "id");
  eq(f.name, "Folder A", "name");
  eq(f.is_default, false, "is_default default");
  eq(f.sort_order, 0, "sort_order default");
  eq(f.deleted_at, null, "deleted_at null");
});

await test("folders.create is idempotent by client_folder_id", async () => {
  const a = await createFolder({ client_folder_id: cid("fidem"), name: "X" });
  const b = await createFolder({ client_folder_id: cid("fidem"), name: "Y" });
  eq(b.id, a.id, "same row");
  eq(b.name, "Y", "name updated");
});

await test("folders.update changes name and sort_order", async () => {
  const f = await createFolder({ client_folder_id: cid("fupd"), name: "Before" });
  const r = await updateFolder(f.id, { name: "After", sort_order: 5 });
  eq(r.status, "ok", "status");
  eq(r.folder.name, "After", "name");
  eq(r.folder.sort_order, 5, "sort_order");
});

await test("folders.list EXCLUDES soft-deleted folders", async () => {
  const f = await createFolder({ client_folder_id: cid("fdel"), name: "Temp" });
  eq((await removeFolder(f.id)).status, "ok", "remove status");
  ok(!(await listFolders({})).find((x) => x.id === f.id), "deleted folder must not appear");
});

// ── Transcriptions ───────────────────────────────────────────────────────────
const createTx = (input) => c.mutation(api.transcriptions.create, { input });
const listTx = (args = {}) => c.query(api.transcriptions.list, args);
const removeTx = (id) => c.mutation(api.transcriptions.remove, { id });

await test("transcriptions.create returns a well-formed row", async () => {
  const x = await createTx({ client_transcription_id: cid("tx1"), text: "hello world", provider: "whisper", status: "done" });
  ok(typeof x.id === "string", "id");
  eq(x.text, "hello world", "text");
  eq(x.provider, "whisper", "provider");
  eq(x.user_id, "dev-user", "owner scoping");
  eq(x.deleted_at, null, "deleted_at null");
});

await test("transcriptions.list excludes soft-deleted", async () => {
  const x = await createTx({ client_transcription_id: cid("txdel"), text: "temp" });
  eq((await removeTx(x.id)).status, "ok", "remove status");
  ok(!(await listTx({ limit: 500 })).find((r) => r.id === x.id), "deleted transcription hidden");
});

// ── Dictionary ───────────────────────────────────────────────────────────────
const createDict = (input) => c.mutation(api.dictionary.create, { input });
const listDict = () => c.query(api.dictionary.list, {});
const updateDict = (id, input) => c.mutation(api.dictionary.update, { id, input });
const removeDict = (id) => c.mutation(api.dictionary.remove, { id });

await test("dictionary.create defaults source to manual", async () => {
  const d = await createDict({ client_dict_id: cid("d1"), word: "Pyper" });
  eq(d.word, "Pyper", "word");
  eq(d.source, "manual", "source default");
  eq(d.user_id, "dev-user", "owner scoping");
});

await test("dictionary.update changes the word", async () => {
  const d = await createDict({ client_dict_id: cid("dupd"), word: "before" });
  const r = await updateDict(d.id, { word: "after" });
  eq(r.status, "ok", "status");
  eq(r.item.word, "after", "word updated");
});

await test("dictionary.list excludes soft-deleted", async () => {
  const d = await createDict({ client_dict_id: cid("ddel"), word: "temp" });
  eq((await removeDict(d.id)).status, "ok", "remove status");
  ok(!(await listDict()).find((r) => r.id === d.id), "deleted dictionary item hidden");
});

// ── Snippets ─────────────────────────────────────────────────────────────────
const createSnip = (input) => c.mutation(api.snippets.create, { input });
const listSnip = () => c.query(api.snippets.list, {});
const updateSnip = (id, input) => c.mutation(api.snippets.update, { id, input });
const removeSnip = (id) => c.mutation(api.snippets.remove, { id });

await test("snippets.create caps trigger at 100 chars", async () => {
  const s = await createSnip({ client_snippet_id: cid("s1"), trigger: "x".repeat(150), replacement: "expanded" });
  eq(s.trigger.length, 100, "trigger capped to 100");
  eq(s.replacement, "expanded", "replacement");
});

await test("snippets.update changes the replacement", async () => {
  const s = await createSnip({ client_snippet_id: cid("supd"), trigger: "brb", replacement: "be right back" });
  const r = await updateSnip(s.id, { replacement: "back soon" });
  eq(r.status, "ok", "status");
  eq(r.snippet.replacement, "back soon", "replacement updated");
});

await test("snippets.list excludes soft-deleted", async () => {
  const s = await createSnip({ client_snippet_id: cid("sdel"), trigger: "tmp", replacement: "temp" });
  eq((await removeSnip(s.id)).status, "ok", "remove status");
  ok(!(await listSnip()).find((r) => r.id === s.id), "deleted snippet hidden");
});

// ── Conversations (+ messages) ───────────────────────────────────────────────
const createConv = (input) => c.mutation(api.conversations.create, { input });
const listConv = () => c.query(api.conversations.list, {});
const updateConv = (id, input) => c.mutation(api.conversations.update, { id, input });
const removeConv = (id) => c.mutation(api.conversations.remove, { id });
const addMsg = (conversation_id, message) => c.mutation(api.conversations.addMessage, { conversation_id, message });
const listMsgs = (conversation_id) => c.query(api.conversations.listMessages, { conversation_id });

await test("conversations.create seeds its messages", async () => {
  const conv = await createConv({
    client_conversation_id: cid("c1"),
    title: "Chat A",
    messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }],
  });
  ok(typeof conv.id === "string", "id");
  eq(conv.title, "Chat A", "title");
  eq(conv.user_id, "dev-user", "owner scoping");
  const msgs = await listMsgs(conv.id);
  eq(msgs.length, 2, "two seeded messages");
  eq(msgs.map((m) => m.content), ["hi", "hello"], "messages in order");
});

await test("conversations.create is idempotent by client_conversation_id", async () => {
  const a = await createConv({ client_conversation_id: cid("cidem"), title: "One" });
  const b = await createConv({ client_conversation_id: cid("cidem"), title: "Two" });
  eq(b.id, a.id, "same row adopted");
});

await test("conversations.addMessage appends to the thread", async () => {
  const conv = await createConv({ client_conversation_id: cid("cmsg"), title: "Thread" });
  const r = await addMsg(conv.id, { role: "user", content: "first" });
  eq(r.status, "ok", "status");
  eq(r.message.content, "first", "message content");
  const msgs = await listMsgs(conv.id);
  ok(msgs.some((m) => m.content === "first"), "appended message present");
});

await test("conversations.update changes title and archives", async () => {
  const conv = await createConv({ client_conversation_id: cid("cupd"), title: "Old" });
  const r = await updateConv(conv.id, { title: "New", archived_at: "2026-01-01T00:00:00.000Z" });
  eq(r.status, "ok", "status");
  eq(r.conversation.title, "New", "title updated");
  eq(r.conversation.archived_at, "2026-01-01T00:00:00.000Z", "archived_at set");
});

await test("conversations.list excludes soft-deleted", async () => {
  const conv = await createConv({ client_conversation_id: cid("cdel"), title: "Temp" });
  eq((await removeConv(conv.id)).status, "ok", "remove status");
  ok(!(await listConv()).find((x) => x.id === conv.id), "deleted conversation hidden");
});

// ── Spaces (teams) ───────────────────────────────────────────────────────────
const createSpace = (input) => c.mutation(api.spaces.create, { input });
const listSpaces = () => c.query(api.spaces.list, {});
const updateSpace = (id, input) => c.mutation(api.spaces.update, { id, input });
const removeSpace = (id) => c.mutation(api.spaces.remove, { id });
const addSpaceMember = (space_id, subject, role) => c.mutation(api.spaces.addMember, { space_id, subject, role });
const spaceMembers = (space_id) => c.query(api.spaces.members, { space_id });

await test("spaces.create makes the creator an owner and appears in list", async () => {
  const s = await createSpace({ name: `Team ${RUN}` });
  ok(typeof s.id === "string", "id");
  eq(s.my_role, "owner", "creator is owner");
  const found = (await listSpaces()).find((x) => x.id === s.id);
  ok(found && found.my_role === "owner", "space listed with owner role");
});

await test("spaces.addMember adds a member visible in the roster", async () => {
  const s = await createSpace({ name: `RosterTeam ${RUN}` });
  eq((await addSpaceMember(s.id, "teammate-x", "member")).status, "ok", "add status");
  const roster = await spaceMembers(s.id);
  ok(roster.some((m) => m.subject === "dev-user" && m.role === "owner"), "owner in roster");
  ok(roster.some((m) => m.subject === "teammate-x" && m.role === "member"), "member added");
});

await test("spaces.update renames as owner", async () => {
  const s = await createSpace({ name: "Before" });
  const r = await updateSpace(s.id, { name: "After", emoji: "🚀" });
  eq(r.status, "ok", "status");
  eq(r.space.name, "After", "name updated");
});

await test("spaces.remove excludes the space from list", async () => {
  const s = await createSpace({ name: "TempSpace" });
  eq((await removeSpace(s.id)).status, "ok", "remove status");
  ok(!(await listSpaces()).find((x) => x.id === s.id), "removed space hidden");
});

await test("notes.listInSpace returns space notes for a member", async () => {
  const s = await createSpace({ name: `SpaceNotes ${RUN}` });
  const n = await createNote({ client_note_id: cid("spacenote"), content: "shared note", space_id: s.id });
  const inSpace = await c.query(api.notes.listInSpace, { space_id: s.id });
  ok(inSpace.find((x) => x.id === n.id), "space note visible to member");
});

await test("folders.listInSpace returns space folders for a member", async () => {
  const s = await createSpace({ name: `SpaceFolders ${RUN}` });
  const f = await createFolder({ client_folder_id: cid("spacefolder"), name: "Shared", space_id: s.id });
  const inSpace = await c.query(api.folders.listInSpace, { space_id: s.id });
  ok(inSpace.find((x) => x.id === f.id), "space folder visible to member");
});

await test("notes.moveToSpace files a note into a space and back to personal", async () => {
  const s = await createSpace({ name: `MoveNote ${RUN}` });
  const n = await createNote({ client_note_id: cid("moven"), content: "movable" });
  ok(!(await c.query(api.notes.listInSpace, { space_id: s.id })).find((x) => x.id === n.id), "not in space initially");
  eq((await c.mutation(api.notes.moveToSpace, { id: n.id, space_id: s.id })).status, "ok", "move status");
  ok((await c.query(api.notes.listInSpace, { space_id: s.id })).find((x) => x.id === n.id), "in space after move");
  eq((await c.mutation(api.notes.moveToSpace, { id: n.id, space_id: null })).status, "ok", "move-back status");
  ok(!(await c.query(api.notes.listInSpace, { space_id: s.id })).find((x) => x.id === n.id), "gone from space after move back");
});

await test("folders.moveToSpace files a folder into a space", async () => {
  const s = await createSpace({ name: `MoveFolder ${RUN}` });
  const f = await createFolder({ client_folder_id: cid("movef"), name: "Movable" });
  eq((await c.mutation(api.folders.moveToSpace, { id: f.id, space_id: s.id })).status, "ok", "move status");
  ok((await c.query(api.folders.listInSpace, { space_id: s.id })).find((x) => x.id === f.id), "in space after move");
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log("\n" + lines.join("\n"));
const failed = total - pass;
console.log(`\n${failed === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass}/${total} passed (run ${RUN})`);
process.exit(failed === 0 ? 0 : 1);
