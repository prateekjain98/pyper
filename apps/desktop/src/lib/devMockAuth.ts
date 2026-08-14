/**
 * Dev-only mock user.
 *
 * When enabled, `useAuth()` returns a fixed, signed-in mock account so a
 * developer can land straight on the Control Panel dashboard without a real
 * Better Auth session — and stay "signed in" across app restarts.
 *
 * Enablement requires BOTH conditions, so it can never activate in a shipped app:
 *   1. a Vite dev build (`import.meta.env.DEV`) — packaged/production renderer
 *      builds set this to `false`, so the whole mock arm is dead code there, and
 *   2. `VITE_DEV_MOCK_USER=true` — set in a gitignored `apps/desktop/.env.local`
 *      (see `.env.example`). Because it lives in an env file, the mock sign-in is
 *      "kept" across restarts until you remove the flag.
 *
 * `useAuth` selects its implementation ONCE at module load from
 * `MOCK_AUTH_ENABLED` (see hooks/useAuth.ts): the real hook, or a function that
 * returns `MOCK_AUTH_RESULT`. That keeps it rules-of-hooks-clean — every render
 * calls exactly one implementation.
 *
 * The mock user id is "dev-user" to line up with the Convex backend's
 * `DEV_SUBJECT` (see `convex/lib/identity.ts`), so any mocked backend call
 * resolves to the same identity.
 *
 * SCOPE: this only fakes the *renderer* auth gate — enough to open the dashboard
 * and exercise its UI against local SQLite data. Cloud sync stays fenced by the
 * main-process token store (`helpers/tokenStore.js`); with no real bearer token,
 * cloud sync simply no-ops. To exercise real cloud sync, sign in for real or
 * inject a valid bearer token via the dev auth bridge (see `main.js`
 * `startAuthBridgeServer`).
 */
import { useSettingsStore } from "../stores/settingsStore";

export const MOCK_AUTH_ENABLED: boolean =
  import.meta.env.DEV && import.meta.env.VITE_DEV_MOCK_USER === "true";

// Fixed timestamps — never derive these from Date.now() so the mock objects are
// referentially stable and cannot churn renders.
const MOCK_TIMESTAMP = new Date("2025-01-01T00:00:00.000Z").toISOString();
const FAR_FUTURE = new Date("2100-01-01T00:00:00.000Z").toISOString();

export const MOCK_USER = {
  id: "dev-user",
  email: "dev@pyper.local",
  name: "Dev User",
  image: null as string | null,
  emailVerified: true,
  createdAt: MOCK_TIMESTAMP,
  updatedAt: MOCK_TIMESTAMP,
};

const MOCK_SESSION = {
  user: MOCK_USER,
  session: {
    id: "dev-session",
    userId: MOCK_USER.id,
    token: "dev-mock-token",
    expiresAt: FAR_FUTURE,
    createdAt: MOCK_TIMESTAMP,
    updatedAt: MOCK_TIMESTAMP,
  },
};

// The exact shape `useAuth()` returns, so `() => MOCK_AUTH_RESULT` is a drop-in
// for the real hook.
export const MOCK_AUTH_RESULT = {
  isSignedIn: true,
  isGracePeriodOnly: false,
  isLoaded: true,
  session: MOCK_SESSION,
  user: MOCK_USER,
  refetch: async () => null,
};

// Because the mock `useAuth` runs no effects, nothing else flips the settings
// store's `isSignedIn` (a second signed-in signal many feature components read).
// Prime it — plus the localStorage flags the router reads — at module load, so
// the dashboard presents as fully onboarded + signed in from the first render.
if (MOCK_AUTH_ENABLED) {
  try {
    localStorage.setItem("onboardingCompleted", "true");
    localStorage.setItem("isSignedIn", "true");
    // A mock user is signed in, not a guest — clear the "continue without
    // account" flags so the app presents a real (mock) identity.
    localStorage.removeItem("authenticationSkipped");
    localStorage.removeItem("skipAuth");
  } catch {
    // localStorage unavailable — the useAuth() mock still applies.
  }
  try {
    useSettingsStore.getState().setIsSignedIn(true);
  } catch {
    // Settings store not ready — localStorage priming above still applies.
  }
}
