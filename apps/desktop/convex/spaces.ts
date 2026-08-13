import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireSubject } from "./lib/identity";

// Team spaces + membership (foundation). A space is a shared container; members
// have a role (owner | admin | member). NOTE: cross-member visibility of the
// notes/folders inside a space is the NEXT step — those queries are still
// owner-scoped. Enterprise workspaces / invitations / SSO remain pending too.
const nowIso = () => new Date().toISOString();

function toCloudSpace(doc: Doc<"spaces">, myRole: string | null) {
  return {
    id: doc._id,
    workspace_id: doc.workspace_id,
    name: doc.name,
    slug: doc.slug,
    description: doc.description,
    emoji: doc.emoji,
    my_role: myRole,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

async function membership(ctx: any, spaceId: Id<"spaces">, subject: string) {
  return await ctx.db
    .query("spaceMembers")
    .withIndex("by_space", (q: any) => q.eq("space_id", spaceId))
    .filter((q: any) => q.eq(q.field("subject"), subject))
    .unique()
    .catch(() => null);
}

const isAdmin = (role: string | undefined) => role === "owner" || role === "admin";

export const create = mutation({
  args: { input: v.any() },
  handler: async (ctx, { input }) => {
    const subject = await requireSubject(ctx);
    const ts = nowIso();
    const id = await ctx.db.insert("spaces", {
      // Simplified: personal "workspace" == the creator's subject until the real
      // workspace/enterprise model lands.
      workspace_id: input.workspace_id ?? subject,
      created_by: subject,
      name: input.name ?? "Untitled space",
      slug: input.slug ?? null,
      description: input.description ?? null,
      emoji: input.emoji ?? null,
      deleted_at: null,
      created_at: ts,
      updated_at: ts,
    });
    await ctx.db.insert("spaceMembers", { space_id: id, subject, role: "owner" });
    return toCloudSpace((await ctx.db.get(id))!, "owner");
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const subject = await requireSubject(ctx);
    const memberships = await ctx.db
      .query("spaceMembers")
      .withIndex("by_subject", (q) => q.eq("subject", subject))
      .collect();
    const out = [];
    for (const m of memberships) {
      const space = await ctx.db.get(m.space_id);
      if (space && !space.deleted_at) out.push(toCloudSpace(space, m.role));
    }
    return out;
  },
});

export const update = mutation({
  args: { id: v.string(), input: v.any() },
  handler: async (ctx, { id, input }) => {
    const subject = await requireSubject(ctx);
    const sid = ctx.db.normalizeId("spaces", id);
    const space = sid ? await ctx.db.get(sid) : null;
    if (!space || space.deleted_at) return { status: "not_found" as const };
    const mem = await membership(ctx, space._id, subject);
    if (!isAdmin(mem?.role)) return { status: "forbidden" as const };
    const patch: Record<string, unknown> = { updated_at: nowIso() };
    for (const k of ["name", "slug", "description", "emoji"] as const) {
      if (input[k] !== undefined) patch[k] = input[k];
    }
    await ctx.db.patch(space._id, patch);
    return { status: "ok" as const, space: toCloudSpace((await ctx.db.get(space._id))!, mem!.role) };
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const subject = await requireSubject(ctx);
    const sid = ctx.db.normalizeId("spaces", id);
    const space = sid ? await ctx.db.get(sid) : null;
    if (!space || space.deleted_at) return { status: "not_found" as const };
    const mem = await membership(ctx, space._id, subject);
    if (mem?.role !== "owner") return { status: "forbidden" as const };
    const ts = nowIso();
    await ctx.db.patch(space._id, { deleted_at: ts, updated_at: ts });
    return { status: "ok" as const };
  },
});

export const addMember = mutation({
  args: { space_id: v.string(), subject: v.string(), role: v.optional(v.string()) },
  handler: async (ctx, { space_id, subject: newSubject, role }) => {
    const subject = await requireSubject(ctx);
    const sid = ctx.db.normalizeId("spaces", space_id);
    const space = sid ? await ctx.db.get(sid) : null;
    if (!space || space.deleted_at) return { status: "not_found" as const };
    const mem = await membership(ctx, space._id, subject);
    if (!isAdmin(mem?.role)) return { status: "forbidden" as const };
    const existing = await membership(ctx, space._id, newSubject);
    if (existing) {
      await ctx.db.patch(existing._id, { role: role ?? existing.role });
    } else {
      await ctx.db.insert("spaceMembers", { space_id: space._id, subject: newSubject, role: role ?? "member" });
    }
    return { status: "ok" as const };
  },
});

export const members = query({
  args: { space_id: v.string() },
  handler: async (ctx, { space_id }) => {
    const subject = await requireSubject(ctx);
    const sid = ctx.db.normalizeId("spaces", space_id);
    if (!sid) return [];
    const mem = await membership(ctx, sid, subject);
    if (!mem) return []; // non-members can't see the roster
    const rows = await ctx.db
      .query("spaceMembers")
      .withIndex("by_space", (q) => q.eq("space_id", sid))
      .collect();
    return rows.map((r) => ({ subject: r.subject, role: r.role }));
  },
});

export const removeMember = mutation({
  args: { space_id: v.string(), subject: v.string() },
  handler: async (ctx, { space_id, subject: target }) => {
    const subject = await requireSubject(ctx);
    const sid = ctx.db.normalizeId("spaces", space_id);
    const space = sid ? await ctx.db.get(sid) : null;
    if (!space) return { status: "not_found" as const };
    const mem = await membership(ctx, space._id, subject);
    if (!isAdmin(mem?.role)) return { status: "forbidden" as const };
    const targetMem = await membership(ctx, space._id, target);
    if (targetMem) await ctx.db.delete(targetMem._id);
    return { status: "ok" as const };
  },
});

// ─── Invitations ─────────────────────────────────────────────────────────────

export const invite = mutation({
  args: { space_id: v.string(), email: v.optional(v.string()), role: v.optional(v.string()) },
  handler: async (ctx, { space_id, email, role }) => {
    const subject = await requireSubject(ctx);
    const sid = ctx.db.normalizeId("spaces", space_id);
    const space = sid ? await ctx.db.get(sid) : null;
    if (!space || space.deleted_at) return { status: "not_found" as const };
    const mem = await membership(ctx, space._id, subject);
    if (!isAdmin(mem?.role)) return { status: "forbidden" as const };
    const token = crypto.randomUUID();
    const id = await ctx.db.insert("spaceInvitations", {
      space_id: space._id,
      email: email ?? null,
      token,
      role: role ?? "member",
      invited_by: subject,
      status: "pending",
      accepted_by: null,
      created_at: nowIso(),
    });
    return { status: "ok" as const, id, token };
  },
});

export const invitations = query({
  args: { space_id: v.string() },
  handler: async (ctx, { space_id }) => {
    const subject = await requireSubject(ctx);
    const sid = ctx.db.normalizeId("spaces", space_id);
    if (!sid) return [];
    const mem = await membership(ctx, sid, subject);
    if (!isAdmin(mem?.role)) return []; // only admins see the invite list
    const rows = await ctx.db
      .query("spaceInvitations")
      .withIndex("by_space", (q) => q.eq("space_id", sid))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();
    return rows.map((r) => ({
      id: r._id,
      email: r.email,
      role: r.role,
      status: r.status,
      created_at: r.created_at,
    }));
  },
});

export const acceptInvitation = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const subject = await requireSubject(ctx);
    const inv = await ctx.db
      .query("spaceInvitations")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique()
      .catch(() => null);
    if (!inv || inv.status !== "pending") return { status: "invalid" as const };
    const existing = await membership(ctx, inv.space_id, subject);
    if (!existing) {
      await ctx.db.insert("spaceMembers", { space_id: inv.space_id, subject, role: inv.role });
    }
    await ctx.db.patch(inv._id, { status: "accepted", accepted_by: subject });
    return { status: "ok" as const, space_id: inv.space_id };
  },
});

export const revokeInvitation = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const subject = await requireSubject(ctx);
    const iid = ctx.db.normalizeId("spaceInvitations", id);
    const inv = iid ? await ctx.db.get(iid) : null;
    if (!inv || inv.status !== "pending") return { status: "not_found" as const };
    const mem = await membership(ctx, inv.space_id, subject);
    if (!isAdmin(mem?.role)) return { status: "forbidden" as const };
    await ctx.db.patch(inv._id, { status: "revoked" });
    return { status: "ok" as const };
  },
});
