#!/usr/bin/env node
/**
 * Demo client for the Convex backend. Auth is MOCKED (the server falls back to
 * DEV_SUBJECT while AUTH_MODE != "real"), so no token is needed — this is the
 * harness for building/exercising the backend before real auth lands.
 *
 * Run after `npx convex dev` has deployed the functions:
 *   CONVEX_URL="https://<your-dev>.convex.cloud" node apps/desktop/scripts/convex-demo.mjs
 * (CONVEX_URL defaults to VITE_CONVEX_URL from apps/desktop/.env.local.)
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const url = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
if (!url) {
  console.error("Set CONVEX_URL to your Convex deployment URL (see apps/desktop/.env.local).");
  process.exit(1);
}

const c = new ConvexHttpClient(url);
const show = (label, value) => console.log(`\n▶ ${label}\n`, JSON.stringify(value, null, 2));

async function main() {
  // Notes
  const note = await c.mutation(api.notes.create, {
    input: { client_note_id: "demo-note-1", title: "Demo note", content: "Hello from the demo client" },
  });
  show("notes.create", { id: note.id, title: note.title, content: note.content });

  const upd = await c.mutation(api.notes.update, {
    id: note.id,
    input: { content: "Edited by the demo client", base_updated_at: note.updated_at },
  });
  show("notes.update", upd.status === "ok" ? { content: upd.note.content } : upd);

  const notes = await c.query(api.notes.list, { limit: 10 });
  show("notes.list", notes.map((n) => ({ id: n.id, title: n.title, content: n.content, deleted: !!n.deleted_at })));

  // Folders
  const folder = await c.mutation(api.folders.create, {
    input: { client_folder_id: "demo-folder-1", name: "Demo folder", is_default: false, sort_order: 0 },
  });
  show("folders.create", { id: folder.id, name: folder.name });

  const folders = await c.query(api.folders.list, {});
  show("folders.list", folders.map((f) => ({ id: f.id, name: f.name })));

  console.log("\n✅ Demo client run complete — Convex backend is serving notes + folders (mock auth).");
}

main().catch((err) => {
  console.error("\n❌ Demo failed:", err.message);
  process.exit(1);
});
