import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { json, apiError, unauthorized, notImplemented } from "./lib/http";

// Convex validates the `Authorization: Bearer <jwt>` header against
// auth.config.ts and exposes the caller here. `subject` = better-auth user id.
async function subjectOf(ctx: { auth: { getUserIdentity(): Promise<{ subject: string } | null> } }) {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.subject ?? null;
}

const http = httpRouter();

// ─── Notes (reference entity — fully ported) ────────────────────────────────
// Mirrors apps/desktop/src/services/NotesService.ts 1:1 so the desktop's
// SyncService transport works unchanged once pointed at CONVEX_SITE_URL.

// POST /api/notes/create → CloudNote
http.route({
  path: "/api/notes/create",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const sub = await subjectOf(ctx);
    if (!sub) return unauthorized();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return apiError("Invalid body", 400);
    const note = await ctx.runMutation(internal.notes.upsert, { ownerSubject: sub, input: body });
    return json(note);
  }),
});

// POST /api/notes/batch-create → { created: [{ client_note_id, id, updated_at }] }
http.route({
  path: "/api/notes/batch-create",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const sub = await subjectOf(ctx);
    if (!sub) return unauthorized();
    const body = await req.json().catch(() => null);
    const notes = Array.isArray(body?.notes) ? body.notes : null;
    if (!notes) return apiError("Expected { notes: [] }", 400);
    const created: { client_note_id: string; id: string; updated_at?: string }[] = [];
    for (const input of notes) {
      const note = await ctx.runMutation(internal.notes.upsert, { ownerSubject: sub, input });
      created.push({ client_note_id: note.client_note_id, id: note.id, updated_at: note.updated_at });
    }
    return json({ created });
  }),
});

// PATCH /api/notes/update → CloudNote | 409 note_version_conflict { data: { note } }
http.route({
  path: "/api/notes/update",
  method: "PATCH",
  handler: httpAction(async (ctx, req) => {
    const sub = await subjectOf(ctx);
    if (!sub) return unauthorized();
    const body = await req.json().catch(() => null);
    const id = body?.id;
    if (!id || typeof id !== "string") return apiError("Missing note id", 400);
    const result = await ctx.runMutation(internal.notes.applyUpdate, {
      ownerSubject: sub,
      id,
      input: body,
    });
    if (result.status === "not_found") return apiError("Note not found", 404, "note_not_found");
    if (result.status === "conflict") {
      return apiError("Note version conflict", 409, "note_version_conflict", { note: result.note });
    }
    return json(result.note);
  }),
});

// DELETE /api/notes/delete → {}
http.route({
  path: "/api/notes/delete",
  method: "DELETE",
  handler: httpAction(async (ctx, req) => {
    const sub = await subjectOf(ctx);
    if (!sub) return unauthorized();
    const body = await req.json().catch(() => null);
    const id = body?.id;
    if (!id || typeof id !== "string") return apiError("Missing note id", 400);
    const result = await ctx.runMutation(internal.notes.softDelete, { ownerSubject: sub, id });
    // 404 is treated as already-gone by the desktop and hard-deleted locally.
    if (result.status === "not_found") return apiError("Note not found", 404, "note_not_found");
    return json({});
  }),
});

// DELETE /api/notes/delete-all → { deleted }
http.route({
  path: "/api/notes/delete-all",
  method: "DELETE",
  handler: httpAction(async (ctx) => {
    const sub = await subjectOf(ctx);
    if (!sub) return unauthorized();
    const { deleted } = await ctx.runMutation(internal.notes.softDeleteAll, { ownerSubject: sub });
    return json({ deleted });
  }),
});

// GET /api/notes/list?since|before|since_id|before_id|limit|scope → { notes }
http.route({
  path: "/api/notes/list",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const sub = await subjectOf(ctx);
    if (!sub) return unauthorized();
    const url = new URL(req.url);
    const limit = url.searchParams.get("limit");
    const notes = await ctx.runQuery(internal.notes.listDelta, {
      ownerSubject: sub,
      since: url.searchParams.get("since") ?? undefined,
      before: url.searchParams.get("before") ?? undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return json({ notes });
  }),
});

// POST /api/notes/search → { notes: SearchResult[] }
// TODO(search): needs FTS/semantic ranking. Returning 501 makes the desktop
// fall through its search chain (cloud → local semantic → FTS5) without error UX.
http.route({
  path: "/api/notes/search",
  method: "POST",
  handler: httpAction(async (ctx) => {
    const sub = await subjectOf(ctx);
    if (!sub) return unauthorized();
    return notImplemented("/api/notes/search");
  }),
});

// ─── Not-yet-ported sync entities ───────────────────────────────────────────
// Each returns 501 until ported by replicating the notes pattern above.
// (Folders next, then transcriptions, dictionary, snippets, conversations,
//  then the teams/spaces phase.) See ./README.md entity checklist.
const TODO_ROUTES: { path: string; method: "GET" | "POST" | "PATCH" | "DELETE" }[] = [
  { path: "/api/folders/create", method: "POST" },
  { path: "/api/folders/batch-create", method: "POST" },
  { path: "/api/folders/update", method: "PATCH" },
  { path: "/api/folders/delete", method: "DELETE" },
  { path: "/api/folders/list", method: "GET" },
  { path: "/api/transcriptions/create", method: "POST" },
  { path: "/api/transcriptions/batch-create", method: "POST" },
  { path: "/api/transcriptions/list", method: "GET" },
  { path: "/api/transcriptions/delete", method: "DELETE" },
  { path: "/api/transcriptions/batch-delete", method: "POST" },
  { path: "/api/dictionary/batch-create", method: "POST" },
  { path: "/api/dictionary/update", method: "PATCH" },
  { path: "/api/dictionary/delete", method: "DELETE" },
  { path: "/api/dictionary/list", method: "GET" },
  { path: "/api/snippets/batch-create", method: "POST" },
  { path: "/api/snippets/update", method: "PATCH" },
  { path: "/api/snippets/delete", method: "DELETE" },
  { path: "/api/snippets/list", method: "GET" },
  { path: "/api/conversations/create", method: "POST" },
  { path: "/api/conversations/update", method: "PATCH" },
  { path: "/api/conversations/delete", method: "DELETE" },
  { path: "/api/conversations/list", method: "GET" },
  { path: "/api/conversations/search", method: "POST" },
];
for (const { path, method } of TODO_ROUTES) {
  http.route({ path, method, handler: httpAction(async () => notImplemented(path)) });
}

// GET /api/me/spaces → { spaces: [] } (personal-scope migration returns an empty
// team roster; real team sync is the second phase — see README).
http.route({
  path: "/api/me/spaces",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const sub = await subjectOf(ctx);
    if (!sub) return unauthorized();
    return json({ spaces: [] });
  }),
});

export default http;
