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

const root = ReactDOM.createRoot(document.getElementById("root"));
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
