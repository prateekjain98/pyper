import { internalMutation, query, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireSubject } from "./lib/identity";

const nowIso = () => new Date().toISOString();
const MAX_TRIGGER = 100; // mirrors server MAX_SNIPPET_TRIGGER_LENGTH (database.js)

export function toCloudSnippet(doc: Doc<"snippets">) {
  return {
    id: doc._id,
    client_snippet_id: doc.client_snippet_id,
    trigger: doc.trigger,
    replacement: doc.replacement,
    deleted_at: doc.deleted_at,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    user_id: doc.ownerSubject,
  };
}

const MUTABLE = ["trigger", "replacement"] as const;
function pick(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of MUTABLE) {
    if (input[k] === undefined) continue;
    out[k] = k === "trigger" ? String(input[k]).slice(0, MAX_TRIGGER) : input[k];
  }
  return out;
}

export const upsert = internalMutation({
  args: { ownerSubject: v.string(), input: v.any() },
  handler: async (ctx, { ownerSubject, input }) => {
    const clientId = String(input.client_snippet_id ?? "");
    const existing = clientId
      ? await ctx.db
          .query("snippets")
          .withIndex("by_owner_client", (q) =>
            q.eq("ownerSubject", ownerSubject).eq("client_snippet_id", clientId)
          )
          .unique()
          .catch(() => null)
      : null;
    const ts = nowIso();
    if (existing) {
      await ctx.db.patch(existing._id, { ...pick(input), updated_at: ts, deleted_at: null });
      return toCloudSnippet((await ctx.db.get(existing._id))!);
    }
    const id = await ctx.db.insert("snippets", {
      ownerSubject,
      client_snippet_id: clientId,
      trigger: String(input.trigger ?? "").slice(0, MAX_TRIGGER),
      replacement: input.replacement ?? "",
      deleted_at: null,
      created_at: input.created_at ?? ts,
      updated_at: input.updated_at ?? ts,
    });
    return toCloudSnippet((await ctx.db.get(id))!);
  },
});

export const applyUpdate = internalMutation({
  args: { ownerSubject: v.string(), id: v.string(), input: v.any() },
  handler: async (ctx, { ownerSubject, id, input }) => {
    const nid = ctx.db.normalizeId("snippets", id);
    const doc = nid ? await ctx.db.get(nid) : null;
    if (!doc || doc.ownerSubject !== ownerSubject) return { status: "not_found" as const };
    await ctx.db.patch(doc._id, { ...pick(input), updated_at: nowIso() });
    return { status: "ok" as const, snippet: toCloudSnippet((await ctx.db.get(doc._id))!) };
  },
});

export const softDelete = internalMutation({
  args: { ownerSubject: v.string(), id: v.string() },
  handler: async (ctx, { ownerSubject, id }) => {
    const nid = ctx.db.normalizeId("snippets", id);
    const doc = nid ? await ctx.db.get(nid) : null;
    if (!doc || doc.ownerSubject !== ownerSubject) return { status: "not_found" as const };
    const ts = nowIso();
    await ctx.db.patch(doc._id, { deleted_at: ts, updated_at: ts });
    return { status: "ok" as const };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const ownerSubject = await requireSubject(ctx);
    const rows = await ctx.db
      .query("snippets")
      .withIndex("by_owner_updated", (q) => q.eq("ownerSubject", ownerSubject))
      .order("desc")
      .filter((q) => q.eq(q.field("deleted_at"), null))
      .collect();
    return rows.map(toCloudSnippet);
  },
});

export const create = mutation({
  args: { input: v.any() },
  handler: async (ctx, { input }) => {
    const ownerSubject = await requireSubject(ctx);
    return ctx.runMutation(internal.snippets.upsert, { ownerSubject, input });
  },
});

export const update = mutation({
  args: { id: v.string(), input: v.any() },
  handler: async (ctx, { id, input }) => {
    const ownerSubject = await requireSubject(ctx);
    return ctx.runMutation(internal.snippets.applyUpdate, { ownerSubject, id, input });
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const ownerSubject = await requireSubject(ctx);
    return ctx.runMutation(internal.snippets.softDelete, { ownerSubject, id });
  },
});
