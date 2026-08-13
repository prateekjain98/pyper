import { internalMutation, internalQuery, query, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireSubject } from "./lib/identity";

// Server-authoritative timestamp. Convex fixes Date.now() per transaction, and
// ISO millisecond precision makes the (updated_at, id) tie-breaker the desktop
// needs for second-precision SQLite rows effectively unnecessary here.
const nowIso = () => new Date().toISOString();

// Shape a stored row as the CloudNote the desktop's NotesService expects
// (apps/desktop/src/services/NotesService.ts). `id` = Convex _id; `user_id` =
// owner (creator).
export function toCloudNote(doc: Doc<"notes">) {
  return {
    id: doc._id,
    client_note_id: doc.client_note_id,
    title: doc.title,
    content: doc.content,
    enhanced_content: doc.enhanced_content,
    note_type: doc.note_type,
    enhancement_prompt: doc.enhancement_prompt,
    source_file: doc.source_file,
    audio_duration_seconds: doc.audio_duration_seconds,
    folder_id: doc.folder_id,
    transcript: doc.transcript,
    enhanced_at_content_hash: doc.enhanced_at_content_hash,
    participants: doc.participants,
    calendar_event_id: doc.calendar_event_id,
    diarization_enabled: doc.diarization_enabled,
    expected_speaker_count: doc.expected_speaker_count,
    workspace_id: doc.workspace_id,
    space_id: doc.space_id,
    user_id: doc.ownerSubject,
    updated_by_user_id: doc.updated_by_user_id,
    previous_space_id: doc.previous_space_id ?? null,
    deleted_at: doc.deleted_at,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

// Mutable columns carried by create/update payloads.
const MUTABLE = [
  "title", "content", "enhanced_content", "enhancement_prompt", "enhanced_at_content_hash",
  "note_type", "source_file", "audio_duration_seconds", "participants", "calendar_event_id",
  "diarization_enabled", "expected_speaker_count", "transcript", "folder_id", "workspace_id",
  "space_id",
] as const;

function pickMutable(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of MUTABLE) if (input[k] !== undefined) out[k] = input[k];
  return out;
}

async function findByClientId(ctx: any, ownerSubject: string, clientId: string) {
  if (!clientId) return null;
  return await ctx.db
    .query("notes")
    .withIndex("by_owner_client", (q: any) =>
      q.eq("ownerSubject", ownerSubject).eq("client_note_id", clientId)
    )
    .unique()
    .catch(() => null); // tolerate legacy duplicate client ids
}

// Idempotent create used by POST /api/notes/create and /batch-create. Keyed by
// client_note_id so a retried push adopts the existing row instead of forking.
export const upsert = internalMutation({
  args: { ownerSubject: v.string(), input: v.any() },
  handler: async (ctx, { ownerSubject, input }) => {
    const clientId = String(input.client_note_id ?? "");
    const existing = await findByClientId(ctx, ownerSubject, clientId);
    const ts = nowIso();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...pickMutable(input),
        updated_by_user_id: ownerSubject,
        updated_at: ts,
        deleted_at: null,
      });
      return toCloudNote((await ctx.db.get(existing._id))!);
    }
    const id = await ctx.db.insert("notes", {
      ownerSubject,
      client_note_id: clientId,
      title: input.title ?? null,
      content: input.content ?? "",
      enhanced_content: input.enhanced_content ?? null,
      enhancement_prompt: input.enhancement_prompt ?? null,
      enhanced_at_content_hash: input.enhanced_at_content_hash ?? null,
      note_type: input.note_type ?? "personal",
      source_file: input.source_file ?? null,
      audio_duration_seconds: input.audio_duration_seconds ?? null,
      participants: input.participants ?? null,
      calendar_event_id: input.calendar_event_id ?? null,
      diarization_enabled: input.diarization_enabled ?? null,
      expected_speaker_count: input.expected_speaker_count ?? null,
      transcript: input.transcript ?? null,
      folder_id: input.folder_id ?? null,
      workspace_id: input.workspace_id ?? null,
      space_id: input.space_id ?? null,
      updated_by_user_id: ownerSubject,
      previous_space_id: null,
      deleted_at: null,
      created_at: input.created_at ?? ts,
      updated_at: input.updated_at ?? ts,
    });
    return toCloudNote((await ctx.db.get(id))!);
  },
});

// PATCH /api/notes/update with optimistic concurrency. base_updated_at is the
// server revision the device last acked; a newer one → 409 note_version_conflict.
export const applyUpdate = internalMutation({
  args: { ownerSubject: v.string(), id: v.string(), input: v.any() },
  handler: async (ctx, { ownerSubject, id, input }) => {
    const nid = ctx.db.normalizeId("notes", id);
    const doc = nid ? await ctx.db.get(nid) : null;
    if (!doc || doc.ownerSubject !== ownerSubject) return { status: "not_found" as const };
    const base = input.base_updated_at;
    if (base !== undefined && base !== null && base !== doc.updated_at) {
      return { status: "conflict" as const, note: toCloudNote(doc) };
    }
    await ctx.db.patch(doc._id, {
      ...pickMutable(input),
      updated_by_user_id: ownerSubject,
      updated_at: nowIso(),
    });
    return { status: "ok" as const, note: toCloudNote((await ctx.db.get(doc._id))!) };
  },
});

// Soft delete → tombstone. The desktop hard-deletes locally once it sees the
// tombstone (or the row missing) on the next pull.
export const softDelete = internalMutation({
  args: { ownerSubject: v.string(), id: v.string() },
  handler: async (ctx, { ownerSubject, id }) => {
    const nid = ctx.db.normalizeId("notes", id);
    const doc = nid ? await ctx.db.get(nid) : null;
    if (!doc || doc.ownerSubject !== ownerSubject) return { status: "not_found" as const };
    const ts = nowIso();
    await ctx.db.patch(doc._id, { deleted_at: ts, updated_at: ts });
    return { status: "ok" as const };
  },
});

export const softDeleteAll = internalMutation({
  args: { ownerSubject: v.string() },
  handler: async (ctx, { ownerSubject }) => {
    const rows = await ctx.db
      .query("notes")
      .withIndex("by_owner_updated", (q) => q.eq("ownerSubject", ownerSubject))
      .collect();
    const ts = nowIso();
    let deleted = 0;
    for (const r of rows) {
      if (r.deleted_at) continue;
      await ctx.db.patch(r._id, { deleted_at: ts, updated_at: ts });
      deleted += 1;
    }
    return { deleted };
  },
});

// Delta pull. `since` (updated_at, ascending) drives incremental sync and
// INCLUDES tombstones so deletes propagate; `before` (created_at, descending)
// drives the first-time snapshot. See SyncService.pullNotes.
export const listDelta = internalQuery({
  args: {
    ownerSubject: v.string(),
    since: v.optional(v.string()),
    before: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { ownerSubject, since, before, limit }) => {
    const take = Math.min(Math.max(limit ?? 50, 1), 500);
    let rows: Doc<"notes">[];
    if (since !== undefined) {
      rows = await ctx.db
        .query("notes")
        .withIndex("by_owner_updated", (q) =>
          q.eq("ownerSubject", ownerSubject).gt("updated_at", since)
        )
        .order("asc")
        .take(take);
    } else if (before !== undefined) {
      rows = await ctx.db
        .query("notes")
        .withIndex("by_owner_created", (q) =>
          q.eq("ownerSubject", ownerSubject).lt("created_at", before)
        )
        .order("desc")
        .take(take);
    } else {
      rows = await ctx.db
        .query("notes")
        .withIndex("by_owner_created", (q) => q.eq("ownerSubject", ownerSubject))
        .order("desc")
        .take(take);
    }
    return rows.map(toCloudNote);
  },
});

// ─── Public API (desktop client, online-only) ───────────────────────────────
// Called directly via ConvexReactClient with a better-auth JWT. These replace
// the local-SQLite + SyncService path for notes. The internal fns above stay as
// the shared core (also reused by the future REST v1 API in ./http.ts).

// Online-only list for the desktop UI: live (non-deleted) notes, newest first.
// (The internal listDelta above keeps tombstones for the future REST v1 / sync.)
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const ownerSubject = await requireSubject(ctx);
    const take = Math.min(Math.max(limit ?? 100, 1), 500);
    const rows = await ctx.db
      .query("notes")
      .withIndex("by_owner_created", (q) => q.eq("ownerSubject", ownerSubject))
      .order("desc")
      .filter((q) => q.eq(q.field("deleted_at"), null))
      .take(take);
    return rows.map(toCloudNote);
  },
});

export const create = mutation({
  args: { input: v.any() },
  handler: async (ctx, { input }) => {
    const ownerSubject = await requireSubject(ctx);
    return ctx.runMutation(internal.notes.upsert, { ownerSubject, input });
  },
});

export const update = mutation({
  args: { id: v.string(), input: v.any() },
  handler: async (ctx, { id, input }) => {
    const ownerSubject = await requireSubject(ctx);
    return ctx.runMutation(internal.notes.applyUpdate, { ownerSubject, id, input });
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const ownerSubject = await requireSubject(ctx);
    return ctx.runMutation(internal.notes.softDelete, { ownerSubject, id });
  },
});

// Full-text search over live notes (replaces the local FTS5 keyword path).
// Convex text search is transactional, so a just-written note is immediately
// searchable. Semantic/vector search (replacing Qdrant embeddings) is a later
// step that needs server-side embeddings.
export const search = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { query, limit }) => {
    const ownerSubject = await requireSubject(ctx);
    if (!query.trim()) return [];
    const take = Math.min(Math.max(limit ?? 20, 1), 50);
    const rows = await ctx.db
      .query("notes")
      .withSearchIndex("search_content", (q) =>
        q.search("content", query).eq("ownerSubject", ownerSubject).eq("deleted_at", null)
      )
      .take(take);
    return rows.map(toCloudNote);
  },
});

// Notes shared in a space, visible to any MEMBER of that space (cross-member
// visibility). Non-members get an empty list.
export const listInSpace = query({
  args: { space_id: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { space_id, limit }) => {
    const subject = await requireSubject(ctx);
    const sid = ctx.db.normalizeId("spaces", space_id);
    if (!sid) return [];
    const mem = await ctx.db
      .query("spaceMembers")
      .withIndex("by_space", (q) => q.eq("space_id", sid))
      .filter((q) => q.eq(q.field("subject"), subject))
      .unique()
      .catch(() => null);
    if (!mem) return [];
    const take = Math.min(Math.max(limit ?? 100, 1), 500);
    const rows = await ctx.db
      .query("notes")
      .withIndex("by_space_updated", (q) => q.eq("space_id", space_id))
      .order("desc")
      .filter((q) => q.eq(q.field("deleted_at"), null))
      .take(take);
    return rows.map(toCloudNote);
  },
});

// Move a note into a space (caller must be a member) or back to personal (null).
export const moveToSpace = mutation({
  args: { id: v.string(), space_id: v.union(v.string(), v.null()) },
  handler: async (ctx, { id, space_id }) => {
    const subject = await requireSubject(ctx);
    const nid = ctx.db.normalizeId("notes", id);
    const doc = nid ? await ctx.db.get(nid) : null;
    if (!doc || doc.ownerSubject !== subject) return { status: "not_found" as const };
    if (space_id !== null) {
      const sid = ctx.db.normalizeId("spaces", space_id);
      if (!sid) return { status: "not_found" as const };
      const mem = await ctx.db
        .query("spaceMembers")
        .withIndex("by_space", (q) => q.eq("space_id", sid))
        .filter((q) => q.eq(q.field("subject"), subject))
        .unique()
        .catch(() => null);
      if (!mem) return { status: "forbidden" as const };
    }
    await ctx.db.patch(doc._id, { space_id, updated_at: nowIso() });
    return { status: "ok" as const, note: toCloudNote((await ctx.db.get(doc._id))!) };
  },
});

// Live (non-deleted) notes for a given owner — used by the public REST v1 API,
// which authenticates by API key (not ctx.auth), so the owner is passed in.
export const listLiveForOwner = internalQuery({
  args: { ownerSubject: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { ownerSubject, limit }) => {
    const take = Math.min(Math.max(limit ?? 50, 1), 100);
    const rows = await ctx.db
      .query("notes")
      .withIndex("by_owner_created", (q) => q.eq("ownerSubject", ownerSubject))
      .order("desc")
      .filter((q) => q.eq(q.field("deleted_at"), null))
      .take(take);
    return rows.map(toCloudNote);
  },
});

// Single live note by id, scoped to an owner (v1 GET /notes/{id}).
export const getForOwner = internalQuery({
  args: { ownerSubject: v.string(), id: v.string() },
  handler: async (ctx, { ownerSubject, id }) => {
    const nid = ctx.db.normalizeId("notes", id);
    const doc = nid ? await ctx.db.get(nid) : null;
    if (!doc || doc.ownerSubject !== ownerSubject || doc.deleted_at) return null;
    return toCloudNote(doc);
  },
});

// Full-text search scoped to an owner (v1 POST /notes/search).
export const searchForOwner = internalQuery({
  args: { ownerSubject: v.string(), query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { ownerSubject, query, limit }) => {
    if (!query.trim()) return [];
    const take = Math.min(Math.max(limit ?? 20, 1), 50);
    const rows = await ctx.db
      .query("notes")
      .withSearchIndex("search_content", (q) =>
        q.search("content", query).eq("ownerSubject", ownerSubject).eq("deleted_at", null)
      )
      .take(take);
    return rows.map(toCloudNote);
  },
});
