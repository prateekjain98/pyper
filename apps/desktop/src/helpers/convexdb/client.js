// Shared Convex HTTP client for the Electron MAIN process convexdb adapters.
//
// The main process cannot use `ConvexReactClient` (that's the renderer's client,
// see src/lib/convexClient.ts). It uses `ConvexHttpClient` from "convex/browser",
// which runs fine under Node/Electron main and exposes `.query()` / `.mutation()`.
//
// The convexdb stores (./spaces.js, ./transcriptions.js, …) take a client in
// their constructor and may receive `null` — in which case they operate purely
// in-memory and never touch Convex. So this factory is allowed to return null
// (no URL, or the convex package/URL is unusable) without breaking any store.
//
// Auth is MOCKED server-side (requireSubject -> DEV_SUBJECT via
// convex/lib/identity.ts) until @convex-dev/better-auth is activated, so no
// setAuth token is needed yet. When real auth lands, mint a Better Auth token and
// call `client.setAuth(...)` on the instance this returns.
//
// URL resolution mirrors src/lib/convexClient.ts: prefer the env var, fall back
// to the current dev deployment so the adapters work without env wiring.

const DEFAULT_CONVEX_URL = "https://chatty-penguin-848.eu-west-1.convex.cloud";

// undefined = not built yet; ConvexHttpClient instance or null once resolved.
let cached;

function resolveConvexUrl() {
  return (
    process.env.CONVEX_URL ||
    process.env.VITE_CONVEX_URL ||
    DEFAULT_CONVEX_URL ||
    null
  );
}

function createConvexClient() {
  const url = resolveConvexUrl();
  if (!url) return null;
  let ConvexHttpClient;
  try {
    ({ ConvexHttpClient } = require("convex/browser"));
  } catch (err) {
    console.warn("[convexdb/client] convex/browser unavailable:", err?.message || err);
    return null;
  }
  try {
    return new ConvexHttpClient(url);
  } catch (err) {
    console.warn("[convexdb/client] failed to construct ConvexHttpClient:", err?.message || err);
    return null;
  }
}

// Lazily build and memoize a single shared client for all stores.
function getConvexClient() {
  if (cached === undefined) cached = createConvexClient();
  return cached;
}

// Test/reset seam — drop the memoized client so the next getConvexClient()
// rebuilds (e.g. after env changes in a test).
function resetConvexClient() {
  cached = undefined;
}

module.exports = {
  getConvexClient,
  resetConvexClient,
  resolveConvexUrl,
  DEFAULT_CONVEX_URL,
};
