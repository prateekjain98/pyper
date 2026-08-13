import { internalMutation, internalQuery, query, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireSubject } from "./lib/identity";

const nowIso = () => new Date().toISOString();

export function toCloudFolder(doc: Doc<"folders">) {
  return {
    id: doc._id,
    client_folder_id: doc.client_folder_id,
    name: doc.name,
    is_default: doc.is_default,
    sort_order: doc.sort_order,
    workspace_id: doc.workspace_id,
    space_id: doc.space_id,
    previous_space_id: doc.previous_space_id ?? null,
    deleted_at: doc.deleted_at,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

const MUTABLE = ["name", "sort_order", "workspace_id", "space_id"] as const;
function pickMutable(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of MUTABLE) if (input[k] !== undefined) out[k] = input[k];
  return out;
}

// ─── Internal core (shared by public API below + future REST v1) ─────────────

export const upsert = internalMutation({
  args: { ownerSubject: v.string(), input: v.any() },
  handler: async (ctx, { ownerSubject, input }) => {
    const clientId = String(input.client_folder_id ?? "");
    const existing = clientId
      ? await ctx.db
          .query("folders")
          .withIndex("by_owner_client", (q) =>
            q.eq("ownerSubject", ownerSubject).eq("client_folder_id", clientId)
          )
          .unique()
          .catch(() => null)
      : null;
    const ts = nowIso();
    if (existing) {
      await ctx.db.patch(existing._id, { ...pickMutable(input), updated_at: ts, deleted_at: null });
      return toCloudFolder((await ctx.db.get(existing._id))!);
    }
    const id = await ctx.db.insert("folders", {
      ownerSubject,
      client_folder_id: clientId,
      name: input.name ?? "Untitled",
      is_default: input.is_default ?? false,
      sort_order: input.sort_order ?? 0,
      workspace_id: input.workspace_id ?? null,
      space_id: input.space_id ?? null,
      previous_space_id: null,
      deleted_at: null,
      created_at: input.created_at ?? ts,
      updated_at: input.updated_at ?? ts,
    });
    return toCloudFolder((await ctx.db.get(id))!);
  },
});

export const applyUpdate = internalMutation({
  args: { ownerSubject: v.string(), id: v.string(), input: v.any() },
  handler: async (ctx, { ownerSubject, id, input }) => {
    const nid = ctx.db.normalizeId("folders", id);
    const doc = nid ? await ctx.db.get(nid) : null;
    if (!doc || doc.ownerSubject !== ownerSubject) return { status: "not_found" as const };
    await ctx.db.patch(doc._id, { ...pickMutable(input), updated_at: nowIso() });
    return { status: "ok" as const, folder: toCloudFolder((await ctx.db.get(doc._id))!) };
  },
});

export const softDelete = internalMutation({
  args: { ownerSubject: v.string(), id: v.string() },
  handler: async (ctx, { ownerSubject, id }) => {
    const nid = ctx.db.normalizeId("folders", id);
    const doc = nid ? await ctx.db.get(nid) : null;
    if (!doc || doc.ownerSubject !== ownerSubject) return { status: "not_found" as const };
    const ts = nowIso();
    await ctx.db.patch(doc._id, { deleted_at: ts, updated_at: ts });
    return { status: "ok" as const };
  },
});

export const listDelta = internalQuery({
  args: { ownerSubject: v.string(), since: v.optional(v.string()) },
  handler: async (ctx, { ownerSubject, since }) => {
    const rows =
      since !== undefined
        ? await ctx.db
            .query("folders")
            .withIndex("by_owner_updated", (q) =>
              q.eq("ownerSubject", ownerSubject).gt("updated_at", since)
            )
            .order("asc")
            .collect()
        : await ctx.db
            .query("folders")
            .withIndex("by_owner_updated", (q) => q.eq("ownerSubject", ownerSubject))
            .collect();
    return rows.map(toCloudFolder);
  },
});

// ─── Public API (desktop client, online-only) ───────────────────────────────

// Online-only list for the desktop UI: live (non-deleted) folders, ordered by
// sort_order then created_at. (listDelta above keeps tombstones for REST v1.)
export const list = query({
  args: {},
  handler: async (ctx) => {
    const ownerSubject = await requireSubject(ctx);
    const rows = await ctx.db
      .query("folders")
      .withIndex("by_owner_updated", (q) => q.eq("ownerSubject", ownerSubject))
      .filter((q) => q.eq(q.field("deleted_at"), null))
      .collect();
    rows.sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
    return rows.map(toCloudFolder);
  },
});

export const create = mutation({
  args: { input: v.any() },
  handler: async (ctx, { input }) => {
    const ownerSubject = await requireSubject(ctx);
    return ctx.runMutation(internal.folders.upsert, { ownerSubject, input });
  },
});

export const update = mutation({
  args: { id: v.string(), input: v.any() },
  handler: async (ctx, { id, input }) => {
    const ownerSubject = await requireSubject(ctx);
    return ctx.runMutation(internal.folders.applyUpdate, { ownerSubject, id, input });
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const ownerSubject = await requireSubject(ctx);
    return ctx.runMutation(internal.folders.softDelete, { ownerSubject, id });
  },
});
