import { internalMutation, internalQuery, query, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireSubject } from "./lib/identity";

const nowIso = () => new Date().toISOString();

export function toCloudConversation(doc: Doc<"conversations">) {
  return {
    id: doc._id,
    client_conversation_id: doc.client_conversation_id,
    title: doc.title,
    archived_at: doc.archived_at,
    deleted_at: doc.deleted_at,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    user_id: doc.ownerSubject,
  };
}

export function toCloudMessage(doc: Doc<"conversationMessages">) {
  return {
    id: doc._id,
    conversation_id: doc.conversation_id,
    role: doc.role,
    content: doc.content,
    metadata: doc.metadata ?? null,
    created_at: doc.created_at,
  };
}

async function findConversation(ctx: any, ownerSubject: string, id: string) {
  const nid = ctx.db.normalizeId("conversations", id) as Id<"conversations"> | null;
  const doc = nid ? await ctx.db.get(nid) : null;
  return doc && doc.ownerSubject === ownerSubject ? doc : null;
}

// ─── Internal core ───────────────────────────────────────────────────────────

// Idempotent create by client_conversation_id. On a fresh create, seeds any
// messages carried in the payload; re-create (adopt) leaves messages untouched.
export const upsert = internalMutation({
  args: { ownerSubject: v.string(), input: v.any() },
  handler: async (ctx, { ownerSubject, input }) => {
    const clientId = String(input.client_conversation_id ?? "");
    const existing = clientId
      ? await ctx.db
          .query("conversations")
          .withIndex("by_owner_client", (q) =>
            q.eq("ownerSubject", ownerSubject).eq("client_conversation_id", clientId)
          )
          .unique()
          .catch(() => null)
      : null;
    const ts = nowIso();
    if (existing) {
      await ctx.db.patch(existing._id, {
        title: input.title ?? existing.title,
        updated_at: ts,
        deleted_at: null,
      });
      return toCloudConversation((await ctx.db.get(existing._id))!);
    }
    const id = await ctx.db.insert("conversations", {
      ownerSubject,
      client_conversation_id: clientId,
      title: input.title ?? null,
      archived_at: null,
      deleted_at: null,
      created_at: input.created_at ?? ts,
      updated_at: input.updated_at ?? ts,
    });
    if (Array.isArray(input.messages)) {
      for (const m of input.messages) {
        await ctx.db.insert("conversationMessages", {
          ownerSubject,
          conversation_id: id,
          role: String(m.role ?? "user"),
          content: String(m.content ?? ""),
          metadata: m.metadata,
          created_at: m.created_at ?? nowIso(),
        });
      }
    }
    return toCloudConversation((await ctx.db.get(id))!);
  },
});

export const applyUpdate = internalMutation({
  args: { ownerSubject: v.string(), id: v.string(), input: v.any() },
  handler: async (ctx, { ownerSubject, id, input }) => {
    const doc = await findConversation(ctx, ownerSubject, id);
    if (!doc) return { status: "not_found" as const };
    const patch: Record<string, unknown> = { updated_at: nowIso() };
    if (input.title !== undefined) patch.title = input.title;
    if (input.archived_at !== undefined) patch.archived_at = input.archived_at;
    await ctx.db.patch(doc._id, patch);
    return { status: "ok" as const, conversation: toCloudConversation((await ctx.db.get(doc._id))!) };
  },
});

export const softDelete = internalMutation({
  args: { ownerSubject: v.string(), id: v.string() },
  handler: async (ctx, { ownerSubject, id }) => {
    const doc = await findConversation(ctx, ownerSubject, id);
    if (!doc) return { status: "not_found" as const };
    const ts = nowIso();
    await ctx.db.patch(doc._id, { deleted_at: ts, updated_at: ts });
    return { status: "ok" as const };
  },
});

export const appendMessageInternal = internalMutation({
  args: { ownerSubject: v.string(), conversation_id: v.string(), message: v.any() },
  handler: async (ctx, { ownerSubject, conversation_id, message }) => {
    const conv = await findConversation(ctx, ownerSubject, conversation_id);
    if (!conv) return { status: "not_found" as const };
    const ts = nowIso();
    const mid = await ctx.db.insert("conversationMessages", {
      ownerSubject,
      conversation_id: conv._id,
      role: String(message.role ?? "user"),
      content: String(message.content ?? ""),
      metadata: message.metadata,
      created_at: message.created_at ?? ts,
    });
    await ctx.db.patch(conv._id, { updated_at: ts }); // bump the conversation
    return { status: "ok" as const, message: toCloudMessage((await ctx.db.get(mid))!) };
  },
});

export const listMessagesInternal = internalQuery({
  args: { ownerSubject: v.string(), conversation_id: v.string() },
  handler: async (ctx, { ownerSubject, conversation_id }) => {
    const conv = await findConversation(ctx, ownerSubject, conversation_id);
    if (!conv) return [];
    const rows = await ctx.db
      .query("conversationMessages")
      .withIndex("by_conversation", (q) => q.eq("conversation_id", conv._id))
      .order("asc")
      .collect();
    return rows.map(toCloudMessage);
  },
});

// ─── Public API (desktop client, online-only) ───────────────────────────────

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const ownerSubject = await requireSubject(ctx);
    const take = Math.min(Math.max(limit ?? 100, 1), 500);
    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_owner_updated", (q) => q.eq("ownerSubject", ownerSubject))
      .order("desc")
      .filter((q) => q.eq(q.field("deleted_at"), null))
      .take(take);
    return rows.map(toCloudConversation);
  },
});

export const create = mutation({
  args: { input: v.any() },
  handler: async (ctx, { input }) => {
    const ownerSubject = await requireSubject(ctx);
    return ctx.runMutation(internal.conversations.upsert, { ownerSubject, input });
  },
});

export const update = mutation({
  args: { id: v.string(), input: v.any() },
  handler: async (ctx, { id, input }) => {
    const ownerSubject = await requireSubject(ctx);
    return ctx.runMutation(internal.conversations.applyUpdate, { ownerSubject, id, input });
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const ownerSubject = await requireSubject(ctx);
    return ctx.runMutation(internal.conversations.softDelete, { ownerSubject, id });
  },
});

export const addMessage = mutation({
  args: { conversation_id: v.string(), message: v.any() },
  handler: async (ctx, { conversation_id, message }) => {
    const ownerSubject = await requireSubject(ctx);
    return ctx.runMutation(internal.conversations.appendMessageInternal, {
      ownerSubject,
      conversation_id,
      message,
    });
  },
});

export const listMessages = query({
  args: { conversation_id: v.string() },
  handler: async (ctx, { conversation_id }) => {
    const ownerSubject = await requireSubject(ctx);
    return ctx.runQuery(internal.conversations.listMessagesInternal, { ownerSubject, conversation_id });
  },
});
