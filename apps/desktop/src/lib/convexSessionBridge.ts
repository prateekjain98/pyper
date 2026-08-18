// Bridges the renderer's Better Auth session bearer into the MAIN-process token
// store (helpers/tokenStore.js) so the main-process Convex client can mint this
// user's Convex JWT.
//
// WHY THIS EXISTS — the bug it closes:
// The desktop's real data path (notes / folders / transcriptions / snippets /
// conversations) is renderer → IPC (`db-*`) → main-process ConvexDatabaseManager
// → convexdb stores → the shared ConvexHttpClient. That client authenticates via
// helpers/convexdb/convexAuth.js `getConvexToken()`, which reads a Better Auth
// *session token* from tokenStore and POSTs it to `GET /api/auth/convex/token`
// (the convex Better Auth plugin's mint endpoint) to obtain a Convex-verifiable
// JWT. But NOTHING ever put a real session token into tokenStore:
//   * The Convex Better Auth client (src/lib/auth.ts) uses the crossDomain plugin,
//     which keeps the session token in localStorage — never in the main process.
//   * useAuth() only calls setRendererAuthSession(userId, userId): that feeds the
//     renderer-only generation context (authRequestContext.ts) with the USER ID as
//     a marker; it never reaches the main process.
//   * The one code path that would bridge a real token — handleAuthRequestSuccess()
//     reading the `set-auth-token` header → authSetToken() — is never wired into
//     any fetch lifecycle (dead code).
// So tokenStore stayed empty, getConvexToken() returned null, and every
// main-process Convex call went out unauthenticated. With the deployment now on
// AUTH_MODE=real the server's requireSubject() rejects those calls ("Sign in
// required"); before that it silently bucketed everyone under DEV_SUBJECT
// ("dev-user"), which is the cross-user leak this repo is fixing.
//
// This module supplies the missing bridge: on sign-in it copies the signed Better
// Auth session token into tokenStore (generation-fenced + idempotent), and on
// sign-out it clears it so a signed-out app can never keep authenticating.

interface AuthTokenStateLike {
  token: string | null;
  generation: number;
}

interface AuthMutationResultLike {
  success: boolean;
  code?: string;
  token?: string | null;
  generation?: number;
}

export interface AuthBridgeApi {
  authGetTokenState?: () => Promise<AuthTokenStateLike | undefined>;
  authSetToken?: (
    token: string,
    expectedGeneration: number
  ) => Promise<AuthMutationResultLike | undefined>;
  authClearSession?: () => Promise<{ success: boolean } | undefined>;
}

interface SessionLike {
  session?: { token?: unknown } | null;
}

// The crossDomain Better Auth client persists its cookies as a JSON blob under
// this localStorage key (default "better-auth" storagePrefix + "_cookie"). The
// signed session-token value lives under the entry whose key contains
// "session_token".
const CROSS_DOMAIN_COOKIE_KEY = "better-auth_cookie";

function defaultApi(): AuthBridgeApi | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { electronAPI?: AuthBridgeApi }).electronAPI ?? null;
}

function defaultStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Pull the signed session-token value out of the crossDomain plugin's stored
// cookie blob. This is exactly the value the Better Auth bearer hook accepts as
// `Authorization: Bearer <token>` (and the same value the `set-auth-token` header
// would carry), so the main-process mint call authenticates with it.
function readStoredSessionToken(storage: Storage | null): string | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(CROSS_DOMAIN_COOKIE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
    // Match "…session_token" but never "…session_data".
    if (!key.includes("session_token")) continue;
    const value = (entry as { value?: unknown } | null)?.value;
    if (typeof value === "string" && value) return value;
  }
  return null;
}

// Resolve the Better Auth session bearer to bridge. Prefers the canonical signed
// token the crossDomain plugin persisted (identical to what the mint endpoint
// expects); falls back to the raw token off the live session record. The Better
// Auth bearer hook signs an unsigned token with the server secret, so either form
// authenticates the mint endpoint.
export function readBetterAuthSessionToken(
  session?: SessionLike | null,
  storage: Storage | null = defaultStorage()
): string | null {
  const stored = readStoredSessionToken(storage);
  if (stored) return stored;
  const raw = session?.session?.token;
  return typeof raw === "string" && raw ? raw : null;
}

// Copy `token` into the main-process token store, but only if it isn't already
// there (idempotent — repeated useAuth() effect runs must not churn). The store's
// generation gate rejects a write that races another; we retry once with the
// fresh generation the store reports back. Never throws; a failure just leaves
// the store as-is (the worst case is an unauthenticated request, which fails
// closed on the server rather than leaking).
export async function bridgeConvexSessionToken(
  token: string | null | undefined,
  api: AuthBridgeApi | null = defaultApi()
): Promise<boolean> {
  if (!api?.authGetTokenState || !api?.authSetToken) return false;
  if (!token) return false; // sign-out is handled by clearConvexSessionBridge()

  let state: AuthTokenStateLike | undefined;
  try {
    state = await api.authGetTokenState();
  } catch {
    return false;
  }
  if (!state || typeof state.generation !== "number") return false;
  if (state.token === token) return true; // already bridged

  let expectedGeneration = state.generation;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let result: AuthMutationResultLike | undefined;
    try {
      result = await api.authSetToken(token, expectedGeneration);
    } catch {
      return false;
    }
    if (result?.success) return true;
    if (result?.token === token) return true; // a concurrent write already set it
    // Lost the generation race — retry once with the store's current generation.
    if (typeof result?.generation === "number" && result.generation !== expectedGeneration) {
      expectedGeneration = result.generation;
      continue;
    }
    return false;
  }
  return false;
}

// Drop any bridged bearer on sign-out. Reads first so it no-ops (and doesn't bump
// the store generation / re-broadcast) when the store is already empty.
export async function clearConvexSessionBridge(
  api: AuthBridgeApi | null = defaultApi()
): Promise<void> {
  if (!api?.authGetTokenState || !api?.authClearSession) return;
  let state: AuthTokenStateLike | undefined;
  try {
    state = await api.authGetTokenState();
  } catch {
    return;
  }
  if (!state?.token) return;
  try {
    await api.authClearSession();
  } catch {
    // Best-effort: sign-out must not throw here.
  }
}
