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
// The client returned here is AUTHENTICATED as the signed-in user: every
// `.query()` / `.mutation()` first ensures the shared client carries that user's
// Convex JWT (minted from the bridged Better Auth session — see ./convexAuth.js),
// so server-side `requireSubject(ctx)` resolves to their real subject instead of
// the shared DEV_SUBJECT fallback. When there's no session (signed out) or a
// token can't be minted, the call goes out unauthenticated exactly as before.
//
// URL resolution mirrors src/lib/convexClient.ts: prefer the env var, fall back
// to the current dev deployment so the adapters work without env wiring.

const { ensureClientAuth, resetConvexAuthState } = require("./convexAuth");

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

// Wrap the raw ConvexHttpClient so every read/write authenticates first. The
// stores only ever call `.query()` / `.mutation()`; those await ensureClientAuth
// (which sets/refreshes/clears the token on the REAL client) before delegating.
// Every other member — setAuth, clearAuth, consistentQuery — passes through bound
// to the real client. Returns null unchanged so in-memory stores still work.
function wrapWithAuth(realClient) {
  if (!realClient) return realClient;
  return new Proxy(realClient, {
    get(target, prop, receiver) {
      if (prop === "query" || prop === "mutation") {
        return async (...args) => {
          await ensureClientAuth(target);
          return target[prop](...args);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

// Lazily build and memoize a single shared client for all stores.
function getConvexClient() {
  if (cached === undefined) cached = wrapWithAuth(createConvexClient());
  return cached;
}

// Test/reset seam — drop the memoized client so the next getConvexClient()
// rebuilds (e.g. after env changes in a test), and reset the cached auth token
// so the fresh client starts unauthenticated.
function resetConvexClient() {
  cached = undefined;
  resetConvexAuthState();
}

module.exports = {
  getConvexClient,
  resetConvexClient,
  resolveConvexUrl,
  DEFAULT_CONVEX_URL,
};
