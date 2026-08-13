// Better Auth instance, running INSIDE Convex via the @convex-dev/better-auth
// component (decision 2026-08-13 — zero self-hosting). Docs:
// https://labs.convex.dev/better-auth
//
// ⚠️ `components.betterAuth` and the `_generated/dataModel` types below are
// produced by Convex codegen. Run `npx convex dev` ONCE (interactive; your Convex
// login) to register the component and regenerate `convex/_generated/` — until
// then this file will not typecheck. First set the deployment env vars:
//   npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
//   npx convex env set SITE_URL "https://<your-deployment>.convex.site"
import { betterAuth } from "better-auth/minimal";
import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import authConfig from "./auth.config";
import { components } from "./_generated/api";
import { query } from "./_generated/server";
import type { DataModel } from "./_generated/dataModel";

// SITE_URL is the origin Better Auth is served from — here the Convex site URL
// (`https://<deployment>.convex.site`), because registerRoutes (see http.ts)
// mounts `/api/auth/*` on the Convex HTTP router.
const siteUrl = process.env.SITE_URL!;

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    // Hackathon default: email + password. Add social/SSO plugins here later.
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    plugins: [convex({ authConfig })],
  });

// Convenience query the desktop client can call to read the signed-in user.
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => authComponent.getAuthUser(ctx),
});
