import { ConvexError } from "convex/values";

/**
 * The authenticated caller's user id. Every public query/mutation funnels
 * through here, so this is the ONE seam to swap when real auth lands.
 *
 * ⚠️ AUTH IS MOCKED FOR NOW. Until the better-auth JWT bridge is wired up, an
 * unauthenticated call resolves to a fixed dev user so the rest of the backend
 * and client can be built and exercised. To flip to real auth (require a valid
 * better-auth JWT, see ./auth.config.ts), set the Convex deployment env var:
 *
 *   npx convex env set AUTH_MODE real
 *
 * …then delete the mock fallback below.
 */
export const DEV_SUBJECT = "dev-user";

export async function requireSubject(ctx: {
  auth: { getUserIdentity(): Promise<{ subject: string } | null> };
}): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) return identity.subject;

  // --- MOCK fallback (remove when AUTH_MODE=real) ---
  if (process.env.AUTH_MODE !== "real") return DEV_SUBJECT;

  throw new ConvexError({ code: "unauthenticated", message: "Sign in required" });
}
