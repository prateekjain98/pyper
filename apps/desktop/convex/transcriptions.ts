import { internalMutation, query, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireSubject } from "./lib/identity";

// Transcription history is append-mostly (no update endpoint in the contract):
// create / list / soft-delete. Online-only list excludes tombstones.
const nowIso = () => new Date().toISOString();

export function toCloudTranscription(doc: Doc<"transcriptions">) {
  return {
    id: doc._id,
    client_transcription_id: doc.client_transcription_id,
    text: doc.text,
    raw_text: doc.raw_text,
    provider: doc.provider,
    model: doc.model,
    language: doc.language,
    audio_duration_ms: doc.audio_duration_ms,
    status: doc.status,
    word_count: doc.word_count ?? null,
    source: doc.source ?? null,
    deleted_at: doc.deleted_at,
    created_at: doc.created_at,
    updated_at: doc.updated_at ?? doc.created_at,
    user_id: doc.ownerSubject,
  };
}

const MUTABLE = ["text", "raw_text", "provider", "model", "language", "audio_duration_ms", "status", "word_count", "source"] as const;
function pick(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of MUTABLE) if (input[k] !== undefined) out[k] = input[k];
  return out;
}

export const upsert = internalMutation({
  args: { ownerSubject: v.string(), input: v.any() },
  handler: async (ctx, { ownerSubject, input }) => {
    const clientId = String(input.client_transcription_id ?? "");
    const existing = clientId
      ? await ctx.db
          .query("transcriptions")
          .withIndex("by_owner_client", (q) =>
            q.eq("ownerSubject", ownerSubject).eq("client_transcription_id", clientId)
          )
          .unique()
          .catch(() => null)
      : null;
    const ts = nowIso();
    if (existing) {
      await ctx.db.patch(existing._id, { ...pick(input), updated_at: ts, deleted_at: null });
      return toCloudTranscription((await ctx.db.get(existing._id))!);
    }
    const id = await ctx.db.insert("transcriptions", {
      ownerSubject,
      client_transcription_id: clientId,
      text: input.text ?? "",
      raw_text: input.raw_text ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      language: input.language ?? null,
      audio_duration_ms: input.audio_duration_ms ?? null,
      status: input.status ?? null,
      word_count: input.word_count ?? null,
      source: input.source ?? null,
      deleted_at: null,
      created_at: input.created_at ?? ts,
      updated_at: input.updated_at ?? ts,
    });
    return toCloudTranscription((await ctx.db.get(id))!);
  },
});

export const softDelete = internalMutation({
  args: { ownerSubject: v.string(), id: v.string() },
  handler: async (ctx, { ownerSubject, id }) => {
    const nid = ctx.db.normalizeId("transcriptions", id);
    const doc = nid ? await ctx.db.get(nid) : null;
    if (!doc || doc.ownerSubject !== ownerSubject) return { status: "not_found" as const };
    const ts = nowIso();
    await ctx.db.patch(doc._id, { deleted_at: ts, updated_at: ts });
    return { status: "ok" as const };
  },
});

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const ownerSubject = await requireSubject(ctx);
    const take = Math.min(Math.max(limit ?? 100, 1), 500);
    const rows = await ctx.db
      .query("transcriptions")
      .withIndex("by_owner_created", (q) => q.eq("ownerSubject", ownerSubject))
      .order("desc")
      .filter((q) => q.eq(q.field("deleted_at"), null))
      .take(take);
    return rows.map(toCloudTranscription);
  },
});

export const create = mutation({
  args: { input: v.any() },
  handler: async (ctx, { input }) => {
    const ownerSubject = await requireSubject(ctx);
    return ctx.runMutation(internal.transcriptions.upsert, { ownerSubject, input });
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const ownerSubject = await requireSubject(ctx);
    return ctx.runMutation(internal.transcriptions.softDelete, { ownerSubject, id });
  },
});
