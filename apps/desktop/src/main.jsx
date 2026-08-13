import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import AppRouter from "./AppRouter.jsx";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import CleanupFailureToastListener from "./components/CleanupFailureToastListener.tsx";
import TinfoilModelSwitchToastListener from "./components/TinfoilModelSwitchToastListener.tsx";
import { ToastProvider } from "./components/ui/Toast.tsx";
import { SettingsProvider } from "./hooks/useSettings";
import ConvexDevView from "./components/ConvexDevView.tsx";

import i18n from "./i18n";
import "./index.css";

// Create the React root exactly once per container. Vite re-executes this entry
// module on HMR whenever an updated dependency has no Fast-Refresh boundary of
// its own (e.g. `hooks/useSettings.ts`, which exports a provider *and* hooks) and
// the update propagates up to the self-accept at the bottom of this file. Calling
// createRoot() again on the same #root would spawn a second root that fights the
// live tree — surfacing as "createRoot() on a container that has already been
// passed to createRoot()", "Failed to execute 'removeChild' ... not a child of
// this node", and a transient "useSettings must be used within a SettingsProvider"
// thrown from <AppRouter> as the old tree's context is torn down mid-render.
// Persisting the root across re-execution turns HMR into a clean root.render()
// reconcile. `import.meta.hot` is statically undefined in production builds, so
// there the root is simply created once.
const container = document.getElementById("root");
const root = import.meta.hot?.data.root ?? ReactDOM.createRoot(container);
if (import.meta.hot) {
  import.meta.hot.data.root = root;
}

// `?convexdev` renders an isolated Convex-backed view (no Electron/IPC needed)
// for browser verification of the client wiring, without touching normal boot.
if (new URLSearchParams(window.location.search).has("convexdev")) {
  root.render(<ConvexDevView />);
} else {
  root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nextProvider i18n={i18n}>
        <SettingsProvider>
          <ToastProvider>
            <TinfoilModelSwitchToastListener />
            <CleanupFailureToastListener />
            <AppRouter />
          </ToastProvider>
        </SettingsProvider>
      </I18nextProvider>
    </ErrorBoundary>
  </React.StrictMode>
  );
}

if (import.meta.hot) {
  import.meta.hot.accept();
}
