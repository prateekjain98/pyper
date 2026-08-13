import { ConvexError } from "convex/values";

/**
 * The authenticated caller's better-auth user id (JWT `sub`). For PUBLIC
 * query/mutation functions called directly by the desktop client via
 * ConvexReactClient — throws (surfaces to the client) when unauthenticated.
 *
 * (HTTP actions in ./http.ts do their own 401 handling for the future public
 * REST v1 API, which authenticates with API keys rather than JWTs.)
 */
export async function requireSubject(ctx: {
  auth: { getUserIdentity(): Promise<{ subject: string } | null> };
}): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({ code: "unauthenticated", message: "Sign in required" });
  }
  return identity.subject;
}
