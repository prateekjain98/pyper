import { ConvexReactClient } from "convex/react";
import { authClient } from "./auth";
import { readBetterAuthSessionToken } from "./convexSessionBridge";

// Shared Convex client for the desktop renderer (the provider foundation used by
// ConvexProvider + the useConvex* hooks, currently exercised by ConvexDevView).
// `VITE_CONVEX_URL` is written to apps/desktop/.env.local by `npx convex dev`; the
// fallback is the current dev deployment so browser harnesses (../../convextest)
// work without env wiring.
const CONVEX_URL =
  (import.meta.env.VITE_CONVEX_URL as string | undefined) ??
  "https://chatty-penguin-848.eu-west-1.convex.cloud";

export const convexClient = new ConvexReactClient(CONVEX_URL);

// Authenticate every renderer Convex request as the signed-in user. The fetcher
// mints a short-lived, Convex-verifiable JWT from the Better Auth session via the
// convex client plugin (GET /api/auth/convex/token). Signed out — or on any mint
// failure — it returns null, so the client sends no auth and the server fails
// closed (requireSubject throws "Sign in required") instead of the renderer
// reading the shared DEV_SUBJECT bucket. `authClient.convex.token` is provided by
// the convex Better Auth client plugin (see src/lib/auth.ts); it is resolved
// dynamically by the Better Auth client, so it is cast here for the type checker.
async function fetchConvexToken(
  { forceRefreshToken }: { forceRefreshToken: boolean } = { forceRefreshToken: false }
): Promise<string | null> {
  void forceRefreshToken;
  // No local session → skip the network to avoid a 401 mint round-trip on every
  // signed-out renderer at startup.
  if (!readBetterAuthSessionToken(null)) return null;
  try {
    const convexPlugin = (
      authClient as unknown as {
        convex: {
          token: (opts?: {
            fetchOptions?: { throw?: boolean };
          }) => Promise<{ data?: { token?: string } | null }>;
        };
      }
    ).convex;
    const { data } = await convexPlugin.token({ fetchOptions: { throw: false } });
    return data?.token ?? null;
  } catch {
    return null;
  }
}

convexClient.setAuth(fetchConvexToken);

// Re-arm the fetcher whenever the Better Auth session changes so a fresh sign-in
// re-authenticates the client immediately and sign-out clears it (calling setAuth
// again forces a token refetch; the fetcher returns null once signed out). Guarded
// because it reaches into the Better Auth client's nanostore internals, which can
// change across versions — the base fetcher + Convex's own periodic refresh still
// apply if this is unavailable.
try {
  const sessionAtom = (
    authClient as unknown as {
      $store?: { atoms?: { session?: { subscribe?: (listener: () => void) => void } } };
    }
  ).$store?.atoms?.session;
  sessionAtom?.subscribe?.(() => {
    convexClient.setAuth(fetchConvexToken);
  });
} catch {
  // Non-fatal — see comment above.
}

export { ConvexProvider, useQuery, useMutation } from "convex/react";
