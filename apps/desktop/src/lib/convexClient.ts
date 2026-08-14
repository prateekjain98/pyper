import { ConvexReactClient } from "convex/react";

// Shared Convex client for the desktop renderer — the provider foundation the
// real app will mount. `VITE_CONVEX_URL` is written to apps/desktop/.env.local
// by `npx convex dev`; the fallback is the current dev deployment so browser
// harnesses (../../convextest) work without env wiring.
//
// Auth is MOCKED server-side (Convex functions fall back to DEV_SUBJECT via
// convex/lib/identity.ts) until @convex-dev/better-auth is activated, so no
// token / setAuth is needed for reads or writes yet. When real auth lands, mint
// a Better Auth token and call `convexClient.setAuth(...)` here.
const CONVEX_URL =
  (import.meta.env.VITE_CONVEX_URL as string | undefined) ??
  "https://chatty-penguin-848.eu-west-1.convex.cloud";

export const convexClient = new ConvexReactClient(CONVEX_URL);

export { ConvexProvider, useQuery, useMutation } from "convex/react";
