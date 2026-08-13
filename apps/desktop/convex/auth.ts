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
    // Hackathon default: email + password.
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    // Google OAuth — enabled only when creds are present so the deploy never
    // breaks before they're set. Create an OAuth client in Google Cloud Console
    // (type: Web application) and set them on Convex:
    //   npx convex env set GOOGLE_CLIENT_ID <id>
    //   npx convex env set GOOGLE_CLIENT_SECRET <secret>
    // The Authorized redirect URI in the Google console MUST be:
    //   https://chatty-penguin-848.eu-west-1.convex.site/api/auth/callback/google
    socialProviders:
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {},
    // NOTE: @better-auth/infra's dash() plugin is intentionally NOT here — it's a
    // Node package (crypto/proof-of-work/outbound calls) that cannot bundle or run
    // inside Convex's isolate runtime (the Better Auth *component*). To use the
    // dash.better-auth.com dashboard, Better Auth must run on Node (e.g. Next.js
    // API routes in apps/web on Vercel), with Convex verifying its JWTs via JWKS.
    plugins: [convex({ authConfig })],
  });

// Convenience query the desktop client can call to read the signed-in user.
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => authComponent.getAuthUser(ctx),
});
