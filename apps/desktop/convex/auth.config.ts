// Auth config for the @convex-dev/better-auth component: Better Auth runs INSIDE
// Convex (decision 2026-08-13). This SUPERSEDES the earlier external customJwt /
// JWKS bridge against a self-hosted auth.pyper.work — no BETTER_AUTH_ISSUER, no
// external JWKS. The component's provider is resolved by getAuthConfigProvider().
import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig } from "convex/server";

export default {
  providers: [getAuthConfigProvider()],
} satisfies AuthConfig;
