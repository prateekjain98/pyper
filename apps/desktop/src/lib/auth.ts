import { createAuthClient } from "better-auth/react";
import { convexClient, crossDomainClient } from "@convex-dev/better-auth/client/plugins";
import { PYPER_API_URL } from "../config/constants";
import { BRAND } from "../config/brand";
import { clearRendererAuthSession } from "./authRequestContext";

// Better Auth client — Convex-hosted (decision 2026-08-13, "zero self-hosting").
// The Better Auth routes are mounted on the Convex HTTP-actions domain
// (`https://<deployment>.convex.site/api/auth/*`, see convex/http.ts), so the
// client's baseURL is VITE_CONVEX_SITE_URL. crossDomainClient keeps the session
// token in localStorage because the renderer (file:// in prod, a localhost vite
// server in dev) is a cross-origin context where convex.site cookies won't stick.
// Verified working end-to-end (email/password + Google) in the desktop renderer.
// Convex HTTP-actions origin where Better Auth is served (`/api/auth/*`). The
// hardcoded fallback is a public, non-secret deployment URL — it keeps auth
// working even when the (gitignored) env file is missing, which the fallback in
// src/lib/convexClient.ts already relies on for VITE_CONVEX_URL.
export const AUTH_URL =
  (import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) ||
  "https://chatty-penguin-848.eu-west-1.convex.site";

export const authClient = createAuthClient({
  baseURL: AUTH_URL,
  plugins: [convexClient(), crossDomainClient()],
});

// Complete the Convex cross-domain OAuth handoff. Social sign-in redirects back
// to the app with `?ott=<one-time-token>` (cookies can't cross the convex.site
// boundary), so exchange it for a session — the crossDomain plugin then persists
// the token to localStorage and useSession() picks it up — and strip it from the
// URL so a reload is clean. Without this the Google round-trip never signs in.
if (typeof window !== "undefined") {
  const ottUrl = new URL(window.location.href);
  const ott = ottUrl.searchParams.get("ott");
  if (ott) {
    ottUrl.searchParams.delete("ott");
    window.history.replaceState({}, "", ottUrl);
    const crossDomain = authClient as unknown as {
      crossDomain?: {
        oneTimeToken?: {
          verify?: (args: {
            token: string;
          }) => Promise<{ data?: { session?: { token?: string } } }>;
        };
      };
      updateSession?: () => void;
    };
    void (async () => {
      try {
        const result = await crossDomain.crossDomain?.oneTimeToken?.verify?.({ token: ott });
        const sessionToken = result?.data?.session?.token;
        if (sessionToken) {
          await authClient.getSession({
            fetchOptions: { headers: { Authorization: `Bearer ${sessionToken}` } },
          });
          crossDomain.updateSession?.();
        }
      } catch {
        // A stale/invalid ott just means no session was established; the user can
        // retry sign-in. Never let the handoff throw during module init.
      }
    })();
  }
}

export type SocialProvider = "google" | "microsoft" | "apple";

const LAST_SIGN_IN_STORAGE_KEY = "pyper:lastSignInTime";
const GRACE_PERIOD_MS = 60_000;
const GRACE_RETRY_COUNT = 6;
const INITIAL_GRACE_RETRY_DELAY_MS = 500;

let lastSignInTime: number | null = null;

function getLocalStorageSafe(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function loadLastSignInTimeFromStorage(): number | null {
  const storage = getLocalStorageSafe();
  if (!storage) return null;

  const raw = storage.getItem(LAST_SIGN_IN_STORAGE_KEY);
  if (!raw) return null;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    storage.removeItem(LAST_SIGN_IN_STORAGE_KEY);
    return null;
  }

  return parsed;
}

function persistLastSignInTime(value: number | null): void {
  const storage = getLocalStorageSafe();
  if (!storage) return;

  if (value === null) {
    storage.removeItem(LAST_SIGN_IN_STORAGE_KEY);
  } else {
    storage.setItem(LAST_SIGN_IN_STORAGE_KEY, String(value));
  }
}

function getLastSignInTime(): number | null {
  const stored = loadLastSignInTimeFromStorage();
  if (stored !== null) {
    lastSignInTime = stored;
  }
  return lastSignInTime;
}

function createAuthExpiredError(originalError: unknown): Error {
  const error = originalError instanceof Error ? originalError : new Error("Session expired");
  Object.assign(error, {
    code: "AUTH_EXPIRED",
    messageKey: "hooks.audioRecording.errorDescriptions.sessionExpired",
  });
  return error;
}

function clearLastSignInTime(): void {
  lastSignInTime = null;
  persistLastSignInTime(null);
}

function markSignedOutState(): void {
  const storage = getLocalStorageSafe();
  storage?.setItem("isSignedIn", "false");
  clearLastSignInTime();
}

export function updateLastSignInTime(): void {
  const now = Date.now();
  lastSignInTime = now;
  persistLastSignInTime(now);
}

export function isWithinGracePeriod(): boolean {
  const startedAt = getLastSignInTime();
  if (!startedAt) return false;

  const elapsed = Math.max(0, Date.now() - startedAt);
  return elapsed < GRACE_PERIOD_MS;
}

export function getGracePeriodRemainingMs(): number {
  const startedAt = getLastSignInTime();
  if (!startedAt) return 0;
  return Math.max(0, GRACE_PERIOD_MS - Math.max(0, Date.now() - startedAt));
}

export async function deleteAccount(): Promise<{ error?: Error }> {
  if (!PYPER_API_URL) {
    return { error: new Error("API not configured") };
  }

  try {
    const res = await fetch(`${PYPER_API_URL}/api/auth/delete-account`, {
      method: "DELETE",
      credentials: "include",
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to delete account");
    }

    return {};
  } catch (error) {
    return { error: error instanceof Error ? error : new Error("Failed to delete account") };
  }
}

// The crossDomain Better Auth client persists its session under these
// localStorage keys (default "better-auth" storagePrefix — see the client
// comment at the top of this file). authClient.signOut() normally clears them,
// but only as a side effect of successfully dispatching the /sign-out request.
// We clear them directly too so sign-out is final even when that request never
// runs (offline, or a future client version changes behavior): otherwise the
// stale token survives the post-sign-out reload and the app silently stays
// signed in — which is exactly how "I can't log out" manifests.
const CROSS_DOMAIN_SESSION_STORAGE_KEYS = ["better-auth_cookie", "better-auth_session_data"];

function clearCrossDomainAuthSession(): void {
  const storage = getLocalStorageSafe();
  if (storage) {
    for (const key of CROSS_DOMAIN_SESSION_STORAGE_KEYS) {
      try {
        storage.removeItem(key);
      } catch {
        // Best-effort: a storage failure must not abort the rest of sign-out.
      }
    }
  }
  // Reset the in-memory session atom so useSession() reports signed-out
  // immediately, without waiting on a /get-session round trip that would fail
  // on the same outage that can break signOut(). Mirrors the crossDomain
  // client's own sign-out cleanup; guarded because it reaches client internals.
  try {
    const sessionAtom = (
      authClient as unknown as {
        $store?: { atoms?: { session?: { get?: () => unknown; set?: (value: unknown) => void } } };
      }
    ).$store?.atoms?.session;
    if (sessionAtom?.set) {
      const current = (sessionAtom.get?.() ?? {}) as Record<string, unknown>;
      sessionAtom.set({
        ...current,
        data: null,
        error: null,
        isPending: false,
        isRefetching: false,
      });
    }
  } catch {
    // Client internals can change across versions — never let this throw.
  }
}

export async function signOut(): Promise<void> {
  credentialAccountCache = null;
  try {
    await authClient.signOut();
  } catch {
    // The remote session can expire independently; a failed network sign-out
    // must still clear the local signed-in state below.
  } finally {
    // Guarantee the local signed-out state regardless of whether the network
    // sign-out ran: clear the crossDomain session (localStorage token + the
    // in-memory session atom), then drop the renderer-managed auth generation so
    // useAuth() flips to guest and sync fences immediately, independent of the
    // (optional) main-process bridge.
    clearCrossDomainAuthSession();
    clearRendererAuthSession();
    if (window.electronAPI?.authClearSession) {
      await window.electronAPI.authClearSession().catch(() => undefined);
    }
    markSignedOutState();
  }
}

export async function withSessionRefresh<T>(operation: () => Promise<T>): Promise<T> {
  const startedInGracePeriod = isWithinGracePeriod();
  let graceRetriesUsed = 0;

  while (true) {
    try {
      return await operation();
    } catch (error: any) {
      const isAuthExpired =
        error?.code === "AUTH_EXPIRED" ||
        error?.message?.toLowerCase().includes("session expired") ||
        error?.message?.toLowerCase().includes("auth expired");

      if (!isAuthExpired) {
        throw error;
      }

      if (startedInGracePeriod && graceRetriesUsed < GRACE_RETRY_COUNT) {
        const delayMs = INITIAL_GRACE_RETRY_DELAY_MS * Math.pow(2, graceRetriesUsed);
        graceRetriesUsed += 1;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      throw createAuthExpiredError(error);
    }
  }
}

export async function signInWithSocial(provider: SocialProvider): Promise<{ error?: Error }> {
  try {
    // Convex Better Auth OAuth: signIn.social navigates this window to the
    // provider, which 302s back through convex.site to callbackURL with a
    // one-time token (?ott=); the handler at the top of this file exchanges it
    // for a session (crossDomainClient persists the token).
    //
    // In DEV the renderer is served from http://localhost — a real origin the
    // 302 can land on, so callbackURL is the renderer's own URL. In the PACKAGED
    // app the renderer is file://, which OAuth cannot redirect back to, so use
    // the pyper:// deep link instead: the main process intercepts the redirect
    // (main.js will-redirect / open-url -> routeOttToRenderer) and reloads the
    // control panel at the app URL carrying ?ott=, where this file's handler runs.
    let callbackURL: string;
    if (typeof window !== "undefined" && window.location.protocol === "file:") {
      const electronApi = window.electronAPI as unknown as {
        getOAuthProtocol?: () => Promise<string | null | undefined>;
      };
      const protocol = (await electronApi?.getOAuthProtocol?.()) || "pyper";
      callbackURL = `${protocol}://oauth-callback`;
    } else {
      callbackURL = `${window.location.href.split("?")[0].split("#")[0]}?panel=true`;
    }
    await authClient.signIn.social({ provider, callbackURL, newUserCallbackURL: callbackURL });
    return {};
  } catch (error) {
    return { error: error instanceof Error ? error : new Error("Social sign-in failed") };
  }
}

export async function signInWithSSO(_email: string): Promise<{ error?: Error }> {
  // SSO (work-email → workspace IdP) is not configured on the Convex deployment
  // yet. Return a friendly error so the UI can fall back to email/social rather
  // than calling an endpoint that doesn't exist.
  return { error: new Error("Single sign-on isn't available yet — use email or Google.") };
}

export async function requestPasswordReset(email: string): Promise<{ error?: Error }> {
  try {
    await authClient.requestPasswordReset({
      email: email.trim(),
      redirectTo: `${BRAND.urls.website}/reset-password`,
    });
    return {};
  } catch (error) {
    return { error: error instanceof Error ? error : new Error("Failed to send reset email") };
  }
}

export interface AuthActionError extends Error {
  code?: string;
}

function toAuthActionError(source: unknown, fallbackMessage: string): AuthActionError {
  if (source instanceof Error) return source as AuthActionError;
  if (source && typeof source === "object") {
    const record = source as { message?: string; code?: string };
    const error: AuthActionError = new Error(record.message || fallbackMessage);
    if (record.code) error.code = record.code;
    return error;
  }
  return new Error(fallbackMessage);
}

export async function updateDisplayName(name: string): Promise<{ error?: AuthActionError }> {
  try {
    const { error } = await authClient.updateUser({ name });
    if (error) return { error: toAuthActionError(error, "Failed to update name") };
    return {};
  } catch (error) {
    return { error: toAuthActionError(error, "Failed to update name") };
  }
}

export async function changePassword(params: {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions: boolean;
}): Promise<{ error?: AuthActionError }> {
  try {
    const { error } = await authClient.changePassword({
      currentPassword: params.currentPassword,
      newPassword: params.newPassword,
      revokeOtherSessions: params.revokeOtherSessions,
    });
    if (error) return { error: toAuthActionError(error, "Failed to change password") };
    return {};
  } catch (error) {
    return { error: toAuthActionError(error, "Failed to change password") };
  }
}

// Cache only successful results; errors fail open without being cached. Cleared
// in signOut() so a different account never inherits a stale value.
let credentialAccountCache: boolean | null = null;

export async function hasCredentialAccount(): Promise<boolean> {
  if (credentialAccountCache !== null) return credentialAccountCache;
  try {
    const { data, error } = await authClient.listAccounts();
    if (error || !data) return true;
    credentialAccountCache = data.some((account) => account.providerId === "credential");
    return credentialAccountCache;
  } catch {
    return true;
  }
}
