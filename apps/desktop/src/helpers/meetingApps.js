// Central registry of apps whose microphone use signals a meeting, keyed by
// macOS bundle identifier. `type` controls how detection treats each app:
//   - "meeting": dedicated meeting apps (Zoom / Teams / Webex / FaceTime). Their
//                mere launch is meaningful, so the process detector watches them.
//   - "comms":   always-running chat apps where the mic going live means a
//                huddle / call just started (Slack, Discord). Process launch is
//                useless (they're always running) — the real signal is the mic
//                turning on while that app is frontmost.
//   - "browser": web browsers that host web meetings such as Google Meet. Never
//                watched by process detection (a browser being open is not a
//                meeting); only attributed when the mic is live and the browser
//                is the frontmost app.
//
// The `key` is a stable, lowercase icon identifier the meeting-notification
// overlay maps to an app icon; `name` is the human-facing display name.
const MEETING_APP_BUNDLE_IDS = {
  // --- Dedicated meeting apps ---
  "us.zoom.xos": { key: "zoom", name: "Zoom", type: "meeting" },
  "com.microsoft.teams": { key: "teams", name: "Microsoft Teams", type: "meeting" },
  "com.microsoft.teams2": { key: "teams", name: "Microsoft Teams", type: "meeting" },
  "com.cisco.webexmeetingsapp": { key: "webex", name: "Webex", type: "meeting" },
  "com.apple.FaceTime": { key: "facetime", name: "FaceTime", type: "meeting" },

  // --- Always-running comms apps (huddles / calls) ---
  "com.tinyspeck.slackmacgap": { key: "slack", name: "Slack", type: "comms" },
  "com.hnc.Discord": { key: "discord", name: "Discord", type: "comms" },

  // --- Browsers (web meetings like Google Meet) ---
  "com.google.Chrome": { key: "chrome", name: "Google Chrome", type: "browser" },
  "com.google.Chrome.beta": { key: "chrome", name: "Google Chrome", type: "browser" },
  "com.google.Chrome.dev": { key: "chrome", name: "Google Chrome", type: "browser" },
  "com.google.Chrome.canary": { key: "chrome", name: "Google Chrome Canary", type: "browser" },
  "org.chromium.Chromium": { key: "chromium", name: "Chromium", type: "browser" },
  "com.microsoft.edgemac": { key: "edge", name: "Microsoft Edge", type: "browser" },
  "com.apple.Safari": { key: "safari", name: "Safari", type: "browser" },
  "com.apple.SafariTechnologyPreview": {
    key: "safari",
    name: "Safari Technology Preview",
    type: "browser",
  },
  "company.thebrowser.Browser": { key: "arc", name: "Arc", type: "browser" },
  "com.brave.Browser": { key: "brave", name: "Brave", type: "browser" },
  "org.mozilla.firefox": { key: "firefox", name: "Firefox", type: "browser" },
  "com.vivaldi.Vivaldi": { key: "vivaldi", name: "Vivaldi", type: "browser" },
  "com.operasoftware.Opera": { key: "opera", name: "Opera", type: "browser" },
};

function getMeetingAppByBundleId(bundleId) {
  if (!bundleId) return null;
  return MEETING_APP_BUNDLE_IDS[bundleId] || null;
}

// Given the frontmost app (`{ bundleId, name }` from the OS), decide how a
// live-mic meeting detection should be attributed. Returns a compact,
// serialisable descriptor the notification pipeline forwards to the overlay so
// it can render the right app icon, or `null` when the frontmost app is not a
// recognised meeting / comms / browser app — in which case the detection still
// fires, just without app branding (the pre-existing generic behaviour).
function resolveMicMeetingApp(frontmost) {
  if (!frontmost || !frontmost.bundleId) return null;
  const entry = getMeetingAppByBundleId(frontmost.bundleId);
  if (!entry) return null;
  return {
    key: entry.key,
    name: entry.name || frontmost.name || entry.key,
    bundleId: frontmost.bundleId,
    type: entry.type,
  };
}

// Bundle-id → processKey and processKey → display-name maps for the process
// detector. Browsers are intentionally excluded: an open browser is not a
// meeting, so process detection must not react to one.
function processDetectionMaps() {
  const bundleIdMap = {};
  const appNames = {};
  for (const [bundleId, entry] of Object.entries(MEETING_APP_BUNDLE_IDS)) {
    if (entry.type === "browser") continue;
    bundleIdMap[bundleId] = entry.key;
    appNames[entry.key] = entry.name;
  }
  return { bundleIdMap, appNames };
}

module.exports = {
  MEETING_APP_BUNDLE_IDS,
  getMeetingAppByBundleId,
  resolveMicMeetingApp,
  processDetectionMaps,
};
