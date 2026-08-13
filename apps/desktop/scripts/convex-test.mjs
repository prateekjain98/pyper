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

// ── Summary ──────────────────────────────────────────────────────────────────
console.log("\n" + lines.join("\n"));
const failed = total - pass;
console.log(`\n${failed === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass}/${total} passed (run ${RUN})`);
process.exit(failed === 0 ? 0 : 1);
