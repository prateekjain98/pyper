// Authenticates the MAIN-process Convex client as the signed-in user.
//
// THE BUG THIS FIXES: the convexdb stores share one `ConvexHttpClient` that was
// created with no auth token (see ./client.js). Server-side, every public
// query/mutation funnels through `requireSubject(ctx)` (convex/lib/identity.ts),
// which — with no JWT — falls back to a single fixed `DEV_SUBJECT` ("dev-user").
// So EVERY user read and wrote the same `ownerSubject` bucket and the notes /
// chat / folder lists showed everyone's data. Sending the real user's identity
// makes `requireSubject` resolve to their own subject, so each row's
// `ownerSubject` scoping (and the space-membership checks) finally apply.
//
// HOW: the renderer signs in with Better Auth (src/lib/auth.ts) and bridges its
// session bearer into the main process (helpers/tokenStore.js, used already by
// the cloud proxy). Better Auth's Convex plugin exposes a session-gated endpoint
// that mints a Convex-verifiable JWT from that session:
//
//     GET  ${SITE_URL}/api/auth/convex/token
//     Authorization: Bearer <session token>
//     ->   200 { token: "<convex jwt>" }
//
// This is exactly what the renderer's ConvexBetterAuthProvider does via
// `authClient.convex.token()` (node_modules/@convex-dev/better-auth/dist/react).
// The main process has no authClient, so it calls the endpoint directly with the
// bridged session bearer.
//
// NO-REGRESSION CONTRACT: `getConvexToken()` NEVER throws and NEVER returns a
// token it isn't sure about. With no session (signed out) or on ANY mint failure
// it returns null, and `ensureClientAuth()` then CLEARS the client's auth. That
// preserves today's behavior (an unauthenticated call → the server's dev-user
// fallback while AUTH_MODE is still mocked; a hard 401 once AUTH_MODE=real is
// deployed, which fails closed rather than leaking). A bad token is never applied.

const EXPIRY_SKEW_MS = 60_000; // refresh a minute before the JWT actually expires
const DEFAULT_TTL_MS = 5 * 60_000; // assumed lifetime when `exp` can't be decoded

// Module-level state — there is exactly one shared client in the main process.
const cache = {
  jwt: null, // last successfully minted Convex JWT
  sessionToken: null, // the session bearer that minted `jwt`
  expMs: null, // `jwt` expiry (ms epoch)
  inFlight: null, // dedupe concurrent mints
  inFlightSession: null,
};
// Which token is currently applied to WHICH client via setAuth(), so
// ensureClientAuth only touches a client when its value actually changes.
//
// Keyed PER CLIENT, not module-global: an account switch drops the memoized
// client and builds a fresh one (see ./client.js resetConvexClient). With a
// single module-global "applied" value, an ensureClientAuth still in flight on
// the OLD client could record the NEW user's token as applied, and the freshly
// built client would then skip its own setAuth() and go out unauthenticated —
// leaving the new user staring at an empty app. A WeakMap gives each client its
// own answer and lets a discarded client be collected.
let appliedTokens = new WeakMap();

let defaultTokenStore = null;
function getDefaultTokenStore() {
  if (!defaultTokenStore) defaultTokenStore = require("../tokenStore");
  return defaultTokenStore;
}

// The Better Auth origin (Convex `.site` domain) where `/api/auth/*` is served.
// Mirrors src/lib/auth.ts AUTH_URL resolution, but for the main process where
// VITE_* vars aren't inlined: prefer an explicit site URL, else derive it from
// the Convex `.cloud` deployment URL, else the public dev-deployment fallback.
function resolveSiteUrl() {
  const explicit = process.env.CONVEX_SITE_URL || process.env.VITE_CONVEX_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const cloud = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
  if (cloud && cloud.includes(".convex.cloud")) {
    return cloud.replace(/\/+$/, "").replace(".convex.cloud", ".convex.site");
  }
  return "https://chatty-penguin-848.eu-west-1.convex.site";
}

// Read `exp` (seconds) out of a JWT payload and return it as ms epoch, or null
// if the token is malformed. No signature check — this only paces refresh; the
// server is the authority on validity.
function decodeJwtExpMs(jwt) {
  try {
    const parts = String(jwt).split(".");
    if (parts.length < 2) return null;
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = payload.length % 4;
    if (pad) payload += "=".repeat(4 - pad);
    const json = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

function clearTokenCache() {
  cache.jwt = null;
  cache.sessionToken = null;
  cache.expMs = null;
}

// Resolve the Convex JWT for the current signed-in user, or null when there is
// no session / the mint fails. Never throws.
async function getConvexToken(opts = {}) {
  const tokenStore = opts.tokenStore || getDefaultTokenStore();
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const now = opts.now || Date.now;
  const siteUrl = opts.siteUrl || resolveSiteUrl();

  let sessionToken = null;
  try {
    sessionToken = tokenStore.get();
  } catch {
    sessionToken = null;
  }
  // Signed out (no bridged session) — drop any stale JWT and send no auth.
  if (!sessionToken) {
    clearTokenCache();
    return null;
  }

  // Fast path: a still-valid JWT minted from THIS session token.
  if (
    cache.jwt &&
    cache.sessionToken === sessionToken &&
    typeof cache.expMs === "number" &&
    cache.expMs - now() > EXPIRY_SKEW_MS
  ) {
    return cache.jwt;
  }

  // The session rotated (sign-out/in, refresh) — never reuse the old user's JWT.
  if (cache.sessionToken !== sessionToken) clearTokenCache();

  // Coalesce concurrent mints for the same session token.
  if (cache.inFlight && cache.inFlightSession === sessionToken) return cache.inFlight;

  cache.inFlightSession = sessionToken;
  cache.inFlight = (async () => {
    try {
      if (typeof fetchImpl !== "function") return null;
      const res = await fetchImpl(`${siteUrl}/api/auth/convex/token`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          Accept: "application/json",
        },
      });
      if (!res || !res.ok) return null;
      const body = await res.json().catch(() => null);
      const token = body && typeof body.token === "string" ? body.token : null;
      if (!token) return null;
      cache.jwt = token;
      cache.sessionToken = sessionToken;
      cache.expMs = decodeJwtExpMs(token) ?? now() + DEFAULT_TTL_MS;
      return token;
    } catch {
      // Network error, bad JSON, endpoint unavailable — fall back to no auth.
      return null;
    } finally {
      cache.inFlight = null;
      cache.inFlightSession = null;
    }
  })();
  return cache.inFlight;
}

// Ensure `realClient` carries the current user's Convex identity before a
// request. Applies the token only when it changes and clears it when the user is
// signed out or a token can't be minted. Never throws — a failure here must not
// break a database call, so the worst case is an unauthenticated request.
async function ensureClientAuth(realClient, opts = {}) {
  if (!realClient) return;
  let desired = null;
  try {
    desired = await getConvexToken(opts);
  } catch {
    desired = null;
  }
  const applied = appliedTokens.get(realClient) ?? null;
  try {
    if (desired) {
      if (applied !== desired) {
        realClient.setAuth(desired);
        appliedTokens.set(realClient, desired);
      }
    } else if (applied !== null) {
      realClient.clearAuth();
      appliedTokens.delete(realClient);
    }
  } catch {
    // If applying auth throws, make sure we don't leave a half-applied token.
    try {
      realClient.clearAuth();
    } catch {
      // best effort
    }
    appliedTokens.delete(realClient);
  }
}

// Test/reset seam — drop cached tokens and applied state so the next call starts
// clean (used by ./client.js resetConvexClient and unit tests).
function resetConvexAuthState() {
  clearTokenCache();
  cache.inFlight = null;
  cache.inFlightSession = null;
  appliedTokens = new WeakMap();
}

// Read `sub` out of a JWT payload — the identity the Convex server resolves via
// `ctx.auth.getUserIdentity().subject`, i.e. the exact value every row's
// `ownerSubject` is scoped by (convex/lib/identity.ts). No signature check: this
// is only used to notice that the signed-in ACCOUNT changed, never to authorize.
//
// Some auth providers pack the subject as "<userId>|<sessionId>"; we keep only
// the part before the pipe so a plain session refresh for the SAME user is not
// mistaken for a different account. A plain user-id subject is unaffected.
function decodeJwtSubject(jwt) {
  try {
    const parts = String(jwt).split(".");
    if (parts.length < 2) return null;
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = payload.length % 4;
    if (pad) payload += "=".repeat(4 - pad);
    const json = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    const sub = typeof json.sub === "string" ? json.sub : null;
    if (!sub) return null;
    const stable = sub.split("|")[0];
    return stable || null;
  } catch {
    return null;
  }
}

// The subject of the CURRENT signed-in user, or null when signed out / the token
// can't be minted. Never throws — callers use it to decide whether locally-held,
// account-owned data belongs to somebody else.
async function getConvexSubject(opts = {}) {
  let jwt = null;
  try {
    jwt = await getConvexToken(opts);
  } catch {
    return null;
  }
  return jwt ? decodeJwtSubject(jwt) : null;
}

module.exports = {
  getConvexToken,
  ensureClientAuth,
  resolveSiteUrl,
  decodeJwtExpMs,
  decodeJwtSubject,
  getConvexSubject,
  resetConvexAuthState,
};
