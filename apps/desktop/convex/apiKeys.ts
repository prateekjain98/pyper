import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireSubject } from "./lib/identity";

// Personal API keys (Settings > API Keys; the /api/v1/keys/* surface). The full
// secret is returned exactly ONCE at creation and only its sha256 is stored, so
// it can never be recovered. The public REST v1 API that consumes these keys is
// a separate (pending) piece.
const nowIso = () => new Date().toISOString();
const PREFIX = "pyk_live_";

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Shape returned to the client — never includes key_hash or the secret.
function toPublicKey(doc: Doc<"apiKeys">) {
  return {
    id: doc._id,
    name: doc.name,
    prefix: doc.prefix,
    last4: doc.last4,
    scopes: doc.scopes,
    created_at: doc.created_at,
    last_used_at: doc.last_used_at ?? null,
    revoked_at: doc.revoked_at,
  };
}

export const create = mutation({
  args: { name: v.optional(v.string()), scopes: v.optional(v.array(v.string())) },
  handler: async (ctx, { name, scopes }) => {
    const ownerSubject = await requireSubject(ctx);
    const secretBody = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
    const secret = PREFIX + secretBody;
    const id = await ctx.db.insert("apiKeys", {
      ownerSubject,
      name: name ?? "API key",
      prefix: PREFIX,
      key_hash: await sha256Hex(secret),
      last4: secretBody.slice(-4),
      scopes: scopes ?? ["notes:read", "notes:write"],
      revoked_at: null,
      last_used_at: null,
      created_at: nowIso(),
    });
    return { key: toPublicKey((await ctx.db.get(id))!), secret };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const ownerSubject = await requireSubject(ctx);
    const rows = await ctx.db
      .query("apiKeys")
      .withIndex("by_owner", (q) => q.eq("ownerSubject", ownerSubject))
      .collect();
    return rows.filter((r) => !r.revoked_at).map(toPublicKey);
  },
});

export const revoke = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const ownerSubject = await requireSubject(ctx);
    const kid = ctx.db.normalizeId("apiKeys", id);
    const doc = kid ? await ctx.db.get(kid) : null;
    if (!doc || doc.ownerSubject !== ownerSubject) return { status: "not_found" as const };
    await ctx.db.patch(doc._id, { revoked_at: nowIso() });
    return { status: "ok" as const };
  },
});

// For the public REST v1 API: resolve a presented key's sha256 to its owner +
// scopes. The HTTP action hashes the Bearer secret (crypto lives in the action),
// so this query is a pure by-hash lookup.
export const resolveKeyHash = internalQuery({
  args: { key_hash: v.string() },
  handler: async (ctx, { key_hash }) => {
    const doc = await ctx.db
      .query("apiKeys")
      .withIndex("by_hash", (q) => q.eq("key_hash", key_hash))
      .unique()
      .catch(() => null);
    if (!doc || doc.revoked_at) return null;
    return { ownerSubject: doc.ownerSubject, scopes: doc.scopes };
  },
});
