import React, { Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import App from "./App.jsx";
import AuthenticationStep from "./components/AuthenticationStep.tsx";
import DragOverlay from "./components/DragOverlay.tsx";
import MeetingNotificationOverlay from "./components/MeetingNotificationOverlay.tsx";
import TranscriptionPreviewOverlay from "./components/TranscriptionPreviewOverlay.tsx";
import UpdateNotificationOverlay from "./components/UpdateNotificationOverlay.tsx";
import WindowControls from "./components/WindowControls.tsx";
import { useAuth } from "./hooks/useAuth";
import { useTheme } from "./hooks/useTheme";
import { usePolicyStore } from "./stores/policyStore";
import { useSettingsStore } from "./stores/settingsStore";
import { isControlPanelWindow } from "./utils/windowContext.ts";

const ControlPanel = React.lazy(() => import("./components/ControlPanel.tsx"));
const OnboardingFlow = React.lazy(() => import("./components/OnboardingFlow.tsx"));
const AgentOverlay = React.lazy(() => import("./components/AgentOverlay.tsx"));
const ConvexAuthTest = React.lazy(() => import("./components/ConvexAuthTest.tsx"));

export default function AppRouter() {
  useTheme();
  const params = window.location.search;

  // Self-contained Convex Better Auth sign-in (email/password + Google). Isolated
  // route so it can't affect normal startup. Reach it in dev at
  // http://localhost:5183/?convex-auth=true (Electron window or your browser).
  if (params.includes("convex-auth=true")) {
    return (
      <Suspense fallback={null}>
        <ConvexAuthTest />
      </Suspense>
    );
  }

  if (params.includes("meeting-notification=true")) {
    return <MeetingNotificationOverlay />;
  }

  if (params.includes("update-notification=true")) {
    return <UpdateNotificationOverlay />;
  }

  if (params.includes("transcription-preview=true")) {
    return <TranscriptionPreviewOverlay />;
  }

  if (params.includes("drag-overlay=true")) {
    return <DragOverlay />;
  }

  return <MainApp />;
}

function MainApp() {
  const { isSignedIn, isGracePeriodOnly, isLoaded: authLoaded } = useAuth();
  // Cross-window auth mirror for the dictation-pill gate. useAuth()'s Convex
  // Better Auth session is per-window, so the pill window would not see a sign-in
  // that happened in the control panel; useSettingsStore().isSignedIn is written
  // to localStorage and synced across windows by the settings-store storage
  // listener (and set by the dev mock), so it is the reliable signal here.
  const signedInMirror = useSettingsStore((s) => s.isSignedIn);
  const floatingIconAutoHide = useSettingsStore((s) => s.floatingIconAutoHide);
  const policyStatus = usePolicyStore((state) => state.status);
  const policyResolved =
    !isSignedIn ||
    policyStatus === "managed" ||
    policyStatus === "unmanaged" ||
    policyStatus === "error";
  const isWaitingForPolicyStart = isSignedIn && !policyResolved;
  const autoSyncReady = authLoaded && policyResolved;

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [postOnboardingSettingsSection, setPostOnboardingSettingsSection] = useState(undefined);

  const isAgentPanel = window.location.search.includes("agent=true");
  const isControlPanel = !isAgentPanel && isControlPanelWindow();
  const isDictationPanel = !isControlPanel && !isAgentPanel;

  useEffect(() => {
    if (isAgentPanel) {
      import("./components/AgentOverlay.tsx").catch(() => {});
    } else if (isControlPanel) {
      import("./components/ControlPanel.tsx").catch(() => {});

      if (!localStorage.getItem("onboardingCompleted")) {
        import("./components/OnboardingFlow.tsx").catch(() => {});
      }
    }

    // Sync starts only after auth settles, so a new bearer token cannot touch
    // the previous account's rows while validation is still running. A failed
    // (guest/offline) resolution also counts as settled: canSync() then no-ops
    // because no validated auth context exists.
    if (!isAgentPanel && autoSyncReady) {
      import("./services/SyncService.js")
        .then(({ syncService }) => syncService.startAutoSync())
        .catch(() => {});
    }
  }, [autoSyncReady, isAgentPanel, isControlPanel]);

  useEffect(() => {
    if (!authLoaded) return;

    const onboardingCompleted = localStorage.getItem("onboardingCompleted") === "true";
    const authSkipped =
      localStorage.getItem("authenticationSkipped") === "true" ||
      localStorage.getItem("skipAuth") === "true";
    const onboardingInProgress = localStorage.getItem("onboardingCurrentStep") !== null;
    const isReturningUser =
      !onboardingCompleted && isSignedIn && !isGracePeriodOnly && !onboardingInProgress;

    if (isReturningUser) {
      localStorage.setItem("onboardingCompleted", "true");
    }

    const resolved = localStorage.getItem("onboardingCompleted") === "true";

    if (isControlPanel) {
      if (!resolved) {
        setShowOnboarding(true);
      } else if (!isSignedIn && !authSkipped) {
        setNeedsReauth(true);
      }
    }

    if (isDictationPanel && !resolved) {
      // Keep the dictation overlay hidden during onboarding — OnboardingFlow
      // shows it explicitly when the user reaches the activation step.
      window.electronAPI?.hideWindow?.();
    }

    setIsLoading(false);
  }, [authLoaded, isControlPanel, isDictationPanel, isGracePeriodOnly, isSignedIn]);

  // Gate the floating dictation pill on auth. The main process must not show the
  // pill — at startup, via hotkey, or via tray — while the control panel is on
  // the login screen (signed out and not an explicit "continue without account"
  // guest); this mirrors the control-panel needsReauth condition above so the
  // pill is hidden exactly when the login screen is up. Onboarding and guests
  // keep the pill (gate open). Reads useSettingsStore().isSignedIn, so it holds
  // under the Convex-backed DB facade and the dev mock too.
  useEffect(() => {
    if (!authLoaded) return;

    const applyGate = () => {
      const onboardingCompleted = localStorage.getItem("onboardingCompleted") === "true";
      const authSkipped =
        localStorage.getItem("authenticationSkipped") === "true" ||
        localStorage.getItem("skipAuth") === "true";
      const onLoginScreen = onboardingCompleted && !signedInMirror && !authSkipped;

      // Open/close the main-process gate: when closed, showDictationPanel() and
      // the dictation hotkeys/push-to-talk all no-op.
      window.electronAPI?.setDictationAllowed?.(!onLoginScreen);

      // Persistent pill visibility, post-onboarding only (during onboarding the
      // flow owns the pill's visibility for its activation-step preview). Signing
      // out hides it; signing in restores it, since the gated startup auto-show
      // stays suppressed until the gate opens. Respect the floating-icon-auto-hide
      // setting, which App.jsx also honors.
      if (isDictationPanel && onboardingCompleted) {
        if (onLoginScreen) {
          window.electronAPI?.hideWindow?.();
        } else if (!floatingIconAutoHide) {
          window.electronAPI?.showDictationPanel?.();
        }
      }
    };

    applyGate();

    // authenticationSkipped/skipAuth/onboardingCompleted are raw localStorage (not
    // reactive store keys) and are toggled in the control-panel window (guest
    // opt-in, onboarding finish). Re-evaluate when another window writes them so
    // the pill window opens/closes its gate accordingly. isSignedIn is already
    // reactive via signedInMirror.
    const onStorage = (event) => {
      if (
        event.key === "authenticationSkipped" ||
        event.key === "skipAuth" ||
        event.key === "onboardingCompleted"
      ) {
        applyGate();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [authLoaded, isSignedIn, signedInMirror, floatingIconAutoHide, isDictationPanel]);

  const handleOnboardingComplete = (options) => {
    if (options?.openSettings) {
      setPostOnboardingSettingsSection("transcription");
    }
    setShowOnboarding(false);
    localStorage.setItem("onboardingCompleted", "true");
  };

  // The agent waits for auth resolution so account policy can fail closed;
  // guests still render once the signed-out state resolves.
  if (isAgentPanel) {
    if (!authLoaded || isWaitingForPolicyStart) return <LoadingFallback />;
    return (
      <Suspense fallback={<LoadingFallback />}>
        <AgentOverlay />
      </Suspense>
    );
  }

  // isLoading clears once the onboarding effect has run, which itself waits
  // for authLoaded — and authLoaded terminates even when the session cannot
  // resolve (guest/offline presents as signed out).
  if (isLoading || isWaitingForPolicyStart) {
    return <LoadingFallback />;
  }

  if (isControlPanel && showOnboarding) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <OnboardingFlow onComplete={handleOnboardingComplete} />
      </Suspense>
    );
  }

  if (isControlPanel && needsReauth) {
    return (
      <div className="relative h-screen w-full overflow-hidden bg-[#08080b]">
        {/* Transparent drag strip for moving the window — no visible bar. */}
        <div
          className="absolute inset-x-0 top-0 z-20 flex h-9 items-center justify-end"
          style={{ WebkitAppRegion: "drag" }}
        >
          {window.electronAPI?.getPlatform?.() !== "darwin" && (
            <div className="pr-1" style={{ WebkitAppRegion: "no-drag" }}>
              <WindowControls />
            </div>
          )}
        </div>
        <AuthenticationStep
          onContinueWithoutAccount={() => {
            localStorage.setItem("authenticationSkipped", "true");
            localStorage.setItem("skipAuth", "true");
            setNeedsReauth(false);
          }}
          onAuthComplete={() => setNeedsReauth(false)}
          onNeedsVerification={() => {}}
        />
      </div>
    );
  }

  return isControlPanel ? (
    <Suspense fallback={<LoadingFallback />}>
      <ControlPanel initialSettingsSection={postOnboardingSettingsSection} />
    </Suspense>
  ) : (
    <App />
  );
}

function LoadingFallback({ message }) {
  const { t } = useTranslation();
  const fallbackMessage = message || t("common.loading");

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 animate-[scale-in_300ms_ease-out]">
        <svg
          viewBox="0 0 1024 1024"
          className="w-12 h-12 drop-shadow-[0_2px_8px_rgba(37,99,235,0.18)] dark:drop-shadow-[0_2px_12px_rgba(100,149,237,0.25)]"
          aria-label="Pyper"
        >
          <rect width="1024" height="1024" rx="241" fill="#2056DF" />
          <circle cx="512" cy="512" r="314" fill="#2056DF" stroke="white" strokeWidth="74" />
          <path d="M512 383V641" stroke="white" strokeWidth="74" strokeLinecap="round" />
          <path d="M627 457V568" stroke="white" strokeWidth="74" strokeLinecap="round" />
          <path d="M397 457V568" stroke="white" strokeWidth="74" strokeLinecap="round" />
        </svg>
        <div className="w-7 h-7 rounded-full border-[2.5px] border-transparent border-t-primary animate-[spinner-rotate_0.8s_cubic-bezier(0.4,0,0.2,1)_infinite] motion-reduce:animate-none motion-reduce:border-t-muted-foreground motion-reduce:opacity-50" />
        {fallbackMessage && (
          <p className="text-[13px] font-medium text-muted-foreground dark:text-foreground/60 tracking-[-0.01em]">
            {fallbackMessage}
          </p>
        )}
      </div>
    </div>
  );
}
