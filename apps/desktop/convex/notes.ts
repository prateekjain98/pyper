import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

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
