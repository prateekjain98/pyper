import { useEffect, useState, useSyncExternalStore } from "react";
import { authClient, getGracePeriodRemainingMs, isWithinGracePeriod } from "../lib/auth";
import {
  accountScopeHasMandatoryReconciliation,
  accountScopeRequiresPurge,
  accountScopeRequiresReconciliation,
  getAccountScopeRevision,
  getAccountScopeServerRevision,
  isAccountScopeRetryWaiting,
  markAccountScopePurgeRequired,
  reconcileAccountScope,
  resetAccountScopeRetry,
  scheduleAccountScopeRetry,
  shouldBlockAccountScope,
  shouldReconcileAccountScope,
  subscribeAccountScope,
} from "../lib/authAccountScope";
import {
  assertAuthGenerationCurrent,
  clearRendererAuthSession,
  commitValidatedAuthContext,
  getAuthRequestContextServerSnapshot,
  getAuthRequestContextSnapshot,
  getBoundSessionGeneration,
  getValidatedAuthGeneration,
  invalidateValidatedAuthContext,
  setRendererAuthSession,
  subscribeAuthRequestContext,
} from "../lib/authRequestContext";
import logger from "../utils/logger";
import { MOCK_AUTH_ENABLED, MOCK_AUTH_RESULT } from "../lib/devMockAuth";
import { useSettingsStore } from "../stores/settingsStore";
import { usePolicyStore } from "../stores/policyStore";
import { useEnterpriseIdentityStore } from "../stores/enterpriseIdentityStore";

const useStaticSession = () => ({
  data: null,
  isPending: false,
  error: null,
  refetch: async () => null,
});

async function loadAccountDependencies() {
  const [
    { syncService },
    { invalidateSpaceRoster },
    { resetForAccountChange },
    { useWorkspaceStore },
  ] = await Promise.all([
    import("../services/SyncService.js"),
    import("../lib/spaceRosterCache"),
    import("../stores/noteStore"),
    import("../stores/workspaceStore"),
  ]);

  const resetRendererCaches = () => {
    invalidateSpaceRoster();
    resetForAccountChange();
    useWorkspaceStore.getState().resetForAccountChange();
  };
  return { syncService, resetRendererCaches };
}

async function refreshManagedEnterpriseIdentity(accountId: string, authGeneration: number) {
  const { refreshManagedEnterpriseIdentity: refresh, useWorkspaceStore } =
    await import("../stores/workspaceStore");
  // A newly authenticated employee has no active workspace cached yet. Load
  // memberships first so a single SCIM-provisioned Enterprise workspace is
  // selected and its managed provider config resolves without opening Settings.
  await useWorkspaceStore.getState().refresh();
  refresh(accountId, authGeneration);
}

function useRealAuth() {
  const useSession = authClient?.useSession ?? useStaticSession;
  const { data: ambientSession, isPending, error: sessionError, refetch } = useSession();
  const accountRevision = useSyncExternalStore(
    subscribeAccountScope,
    getAccountScopeRevision,
    getAccountScopeServerRevision
  );
  const authContext = useSyncExternalStore(
    subscribeAuthRequestContext,
    getAuthRequestContextSnapshot,
    getAuthRequestContextServerSnapshot
  );
  const [, setGraceExpiryTick] = useState(0);

  const ambientUser = ambientSession?.user ?? null;
  const ambientUserId = typeof ambientUser?.id === "string" ? ambientUser.id : null;

  // Bridge the Convex Better Auth session into the renderer auth-generation
  // context so the signed-in gate + sync fencing resolve from Convex. The legacy
  // main-process token bridge is only populated by the old OpenWhispr OAuth,
  // which Pyper no longer uses. The token slot is the user id (a stable non-empty
  // marker); Convex requests are authenticated by ConvexReactClient, not this.
  useEffect(() => {
    if (isPending) return;
    if (ambientUserId) setRendererAuthSession(ambientUserId, ambientUserId);
    else clearRendererAuthSession();
  }, [isPending, ambientUserId]);
  // Not gated on sessionError: the binding survives a transient refetch failure
  // and is cleared on its own by a 401 or a credential-generation change.
  const boundGeneration = isPending ? null : getBoundSessionGeneration(ambientUserId);
  const sessionIsBound = boundGeneration != null;
  const resolvedUserId = sessionIsBound ? ambientUserId : null;
  const rawIsSignedIn = sessionIsBound && Boolean(ambientUser);
  const gracePeriodActive = sessionIsBound && !rawIsSignedIn && isWithinGracePeriod();
  const sessionResolutionFailed = Boolean(sessionError) || (!isPending && !sessionIsBound);
  const requiresReconciliation = sessionIsBound
    ? accountScopeRequiresReconciliation(resolvedUserId)
    : true;
  const cloudContextReady = !rawIsSignedIn || getValidatedAuthGeneration() === boundGeneration;
  const accountScopeBlocked =
    isPending ||
    shouldBlockAccountScope(
      isPending,
      gracePeriodActive,
      rawIsSignedIn,
      requiresReconciliation,
      accountScopeHasMandatoryReconciliation(),
      sessionResolutionFailed
    ) ||
    !cloudContextReady;
  // A reconciled session whose refetch failed transiently keeps its binding but
  // loses its validated lease. Keep presenting it instead of flashing to guest;
  // sync stays fenced by getValidatedAuthGeneration() until a refetch succeeds.
  const transientlyAuthenticated =
    Boolean(sessionError) &&
    rawIsSignedIn &&
    !requiresReconciliation &&
    !accountScopeHasMandatoryReconciliation();
  const accountScopePresentable = !accountScopeBlocked || transientlyAuthenticated;
  const isSignedIn = rawIsSignedIn && accountScopePresentable;
  // Loaded means the session settled: fully validated, or failed/signed-out
  // (presented as a guest). Resolution failure must not hold windows hostage —
  // dictation works without an account, and sync stays fenced by
  // hasValidatedAuthContext either way.
  const isLoaded = !isPending && (sessionResolutionFailed || !accountScopeBlocked);

  useEffect(() => {
    if (!gracePeriodActive) return;
    const remaining = getGracePeriodRemainingMs();
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setGraceExpiryTick((value) => value + 1), remaining + 10);
    return () => window.clearTimeout(timer);
  }, [gracePeriodActive]);

  useEffect(() => {
    if (!sessionError) return;
    invalidateValidatedAuthContext();
  }, [sessionError]);

  useEffect(() => {
    if (!sessionResolutionFailed || !resolvedUserId || boundGeneration == null) return;
    void usePolicyStore.getState().fetchPolicy(resolvedUserId, boundGeneration);
    void refreshManagedEnterpriseIdentity(resolvedUserId, boundGeneration);
  }, [boundGeneration, resolvedUserId, sessionResolutionFailed]);

  useEffect(() => {
    if (
      boundGeneration == null ||
      !shouldReconcileAccountScope(
        isPending,
        gracePeriodActive,
        rawIsSignedIn,
        sessionResolutionFailed
      )
    ) {
      return;
    }
    const retryKey = `${boundGeneration}:${resolvedUserId ?? "signed-out"}`;
    if (isAccountScopeRetryWaiting(retryKey)) return;

    let cancelled = false;
    const run = async () => {
      const { syncService, resetRendererCaches } = await loadAccountDependencies();
      const purgeCachedTeamContent = async () => {
        resetRendererCaches();
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await syncService.purgeTeamSpacesForSignOut();
            const spaces = await window.electronAPI?.getSpaces?.();
            if (!spaces) {
              throw new Error("Cannot verify account cleanup: database bridge unavailable");
            }
            if (!spaces.some((space) => space.kind === "team")) {
              resetRendererCaches();
              return;
            }
            lastError = new Error("Team content remained after account cleanup");
          } catch (error) {
            lastError = error;
          }
        }
        // Best-effort, non-blocking: the DB layer is now a Convex-backed facade
        // (helpers/convexDatabaseManager.js). While server-side auth is still
        // mocked (Convex requireSubject -> DEV_SUBJECT), getSpaces() reads the
        // shared DEV_SUBJECT dataset, so it reports server-backed team spaces that
        // this local sign-out purge cannot (and must not) delete — they are the
        // current account's server data, not a previous account's stale local
        // cache. The local purge itself already ran (SyncService
        // .purgeTeamSpacesForSignOut never touches server data), so failing to
        // *verify* an empty result must NOT throw: doing so strands a valid Better
        // Auth session on the login screen (invalidateValidatedAuthContext in the
        // .catch below keeps accountScopePresentable/isSignedIn false). Returning
        // instead lets reconcileAccountScope() reach its success path (mark scope
        // validated, clear the purge-required marker) and lets useAuth commit the
        // validated auth context below, so a signed-in session presents as signed
        // in. Real account-switch purges still clear local cache and pass the
        // check above; only an unclearable remainder is downgraded to a warning.
        logger.warn(
          "Team content could not be fully purged during account reconciliation; continuing (best-effort under Convex-backed DB facade)",
          { error: lastError },
          "auth"
        );
        resetRendererCaches();
      };
      const verifyCachedTeamContent = async () => {
        const purged = await syncService.verifyTeamSpacesForAccount(boundGeneration);
        if (purged > 0) resetRendererCaches();
      };

      if (accountScopeRequiresPurge(resolvedUserId)) {
        markAccountScopePurgeRequired();
      }
      if (accountScopeRequiresReconciliation(resolvedUserId)) {
        // This legacy marker drives every already-running SyncService window;
        // its generation gate provides the immediate fence.
        useSettingsStore.getState().setIsSignedIn(false);
        usePolicyStore.getState().suspendPolicy();
      }

      await reconcileAccountScope(resolvedUserId, {
        purge: purgeCachedTeamContent,
        verify: verifyCachedTeamContent,
      });

      if (resolvedUserId) {
        await assertAuthGenerationCurrent(boundGeneration);
        if (!commitValidatedAuthContext(boundGeneration, resolvedUserId)) {
          throw new Error("Resolved session no longer matches the active credential");
        }
        if (!cancelled) {
          logger.debug("Auth state sync", { isSignedIn: true, userId: resolvedUserId }, "auth");
          useSettingsStore.getState().setIsSignedIn(true);
          void usePolicyStore.getState().fetchPolicy(resolvedUserId, boundGeneration);
          void refreshManagedEnterpriseIdentity(resolvedUserId, boundGeneration);
        }
      } else {
        invalidateValidatedAuthContext();
        if (!cancelled) {
          useSettingsStore.getState().setIsSignedIn(false);
          usePolicyStore.getState().clearPolicy();
          useEnterpriseIdentityStore.getState().clear();
        }
      }
      resetAccountScopeRetry();
    };

    void run().catch((error) => {
      invalidateValidatedAuthContext();
      scheduleAccountScopeRetry(retryKey);
      logger.error("Account-scoped content reconciliation failed", { error }, "auth");
    });

    return () => {
      cancelled = true;
    };
  }, [
    accountRevision,
    authContext.revision,
    boundGeneration,
    gracePeriodActive,
    isPending,
    rawIsSignedIn,
    resolvedUserId,
    sessionResolutionFailed,
  ]);

  return {
    isSignedIn,
    isGracePeriodOnly: gracePeriodActive,
    isLoaded,
    session: sessionIsBound && accountScopePresentable ? ambientSession : null,
    user: isSignedIn ? ambientUser : null,
    refetch,
  };
}

// Dev-only mock user (see lib/devMockAuth.ts). devMockAuth already primes the
// localStorage flags + the settings-store mirror at module load; useMockAuth
// adds the one thing that must happen inside React: settling the policy store on
// mount so MainApp doesn't hang forever on `isWaitingForPolicyStart`
// (AppRouter.jsx) awaiting a policy fetch that the real useAuth path — which
// never runs in mock mode — would have triggered. It returns the shared,
// referentially stable MOCK_AUTH_RESULT so consumers see no render churn.
function useMockAuth() {
  useEffect(() => {
    useSettingsStore.getState().setIsSignedIn(true);
    if (usePolicyStore.getState().status === "idle") {
      usePolicyStore.setState({
        accountId: MOCK_AUTH_RESULT.user.id,
        authGeneration: 1,
        revision: 1,
        status: "unmanaged",
        managed: false,
        policy: null,
        appVersion: null,
      });
    }
  }, []);
  return MOCK_AUTH_RESULT;
}

// Chosen once, from a build-time constant. In production MOCK_AUTH_ENABLED is
// false, so useAuth IS useRealAuth (the mock arm is dead code). In a dev build
// with VITE_DEV_MOCK_USER=true it is useMockAuth instead. Selecting at module
// load (not per render) keeps this rules-of-hooks-clean: every render calls
// exactly one implementation, and that choice never changes for the session.
export const useAuth = MOCK_AUTH_ENABLED ? useMockAuth : useRealAuth;
