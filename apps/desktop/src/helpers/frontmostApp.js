const { execFile } = require("child_process");
const debugLogger = require("./debugLogger");

const FRONTMOST_TIMEOUT_MS = 1500;

// JXA that prints "<bundleId>\n<localizedName>" for the OS's frontmost
// application. NSWorkspace.frontmostApplication identifies the key-window owner
// and ignores panel-type windows like Pyper's own overlays (the same primitive
// textEditMonitor relies on to capture the dictation target). A newline joins
// the two fields so a bundle id or name containing spaces can't be mis-split.
const JXA_FRONTMOST =
  'ObjC.import("AppKit");' +
  "var a = $.NSWorkspace.sharedWorkspace.frontmostApplication;" +
  "[a.bundleIdentifier.js, a.localizedName.js].join(String.fromCharCode(10))";

// Parse the two-line osascript output into `{ bundleId, name }`, or `null` when
// no usable bundle id was reported. Exported so the parsing contract is tested
// without spawning osascript.
function parseFrontmostOutput(stdout) {
  if (!stdout) return null;
  const [bundleIdRaw = "", nameRaw = ""] = String(stdout).split("\n");
  const bundleId = bundleIdRaw.trim();
  if (!bundleId || bundleId === "undefined") return null;
  const name = nameRaw.trim();
  return { bundleId, name: name && name !== "undefined" ? name : "" };
}

// Resolve the OS's frontmost application on macOS. Resolves `{ bundleId, name }`
// or `null` on any failure, timeout, or non-darwin platform, so callers can
// always treat "no attribution" as the safe default and never block on it.
// `execFileImpl` is injectable for tests.
function getFrontmostApp({ execFileImpl = execFile, timeoutMs = FRONTMOST_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    if (process.platform !== "darwin") {
      resolve(null);
      return;
    }
    try {
      execFileImpl(
        "osascript",
        ["-l", "JavaScript", "-e", JXA_FRONTMOST],
        { timeout: timeoutMs },
        (err, stdout) => {
          if (err) {
            debugLogger.debug("Frontmost app lookup failed", { error: err.message }, "meeting");
            resolve(null);
            return;
          }
          resolve(parseFrontmostOutput(stdout));
        }
      );
    } catch (err) {
      debugLogger.debug("Frontmost app lookup threw", { error: err?.message }, "meeting");
      resolve(null);
    }
  });
}

// A browser's identity is its active tab, not its bundle id — Gmail/Outlook web/
// Slack web all run inside Chrome/Safari. Each browser exposes the active tab URL
// via its own AppleScript dictionary (Chromium family shares the grammar; Safari
// uses documents). Reading it prompts for Automation permission for that browser
// on first use; if denied or unsupported (e.g. Firefox), the URL is empty and we
// fall back to the app-name signal.
const BROWSER_URL_SCRIPTS = {
  "com.google.Chrome": 'tell application "Google Chrome" to get URL of active tab of front window',
  "com.google.Chrome.canary":
    'tell application "Google Chrome Canary" to get URL of active tab of front window',
  "com.brave.Browser": 'tell application "Brave Browser" to get URL of active tab of front window',
  "com.microsoft.edgemac":
    'tell application "Microsoft Edge" to get URL of active tab of front window',
  "company.thebrowser.Browser": 'tell application "Arc" to get URL of active tab of front window',
  "com.operasoftware.Opera": 'tell application "Opera" to get URL of active tab of front window',
  "com.vivaldi.Vivaldi": 'tell application "Vivaldi" to get URL of active tab of front window',
  "com.apple.Safari": 'tell application "Safari" to get URL of front document',
};

// Best-effort active-tab URL for a known browser bundle id; "" on anything else,
// denial, or failure. `null` bundle ids are tolerated.
function getBrowserActiveUrl(bundleId, { execFileImpl = execFile, timeoutMs = FRONTMOST_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const script = bundleId && BROWSER_URL_SCRIPTS[bundleId];
    if (!script) {
      resolve("");
      return;
    }
    try {
      execFileImpl("osascript", ["-e", script], { timeout: timeoutMs }, (err, stdout) => {
        if (err) {
          debugLogger.debug("Browser active-tab URL lookup failed", { error: err.message }, "meeting");
          resolve("");
          return;
        }
        resolve(String(stdout || "").trim());
      });
    } catch (err) {
      debugLogger.debug("Browser active-tab URL lookup threw", { error: err?.message }, "meeting");
      resolve("");
    }
  });
}

// Resolve `{ bundleId, name, url }` for the frontmost app, or `null`. `url` is the
// active tab URL when the frontmost app is a supported browser (else ""). Same
// failure contract as getFrontmostApp. Used for channel-aware cleanup.
async function getFrontmostAppContext(opts = {}) {
  const app = await getFrontmostApp(opts);
  if (!app) return null;
  const url = await getBrowserActiveUrl(app.bundleId, opts);
  return { ...app, url };
}

module.exports = {
  getFrontmostApp,
  parseFrontmostOutput,
  getFrontmostAppContext,
  getBrowserActiveUrl,
  BROWSER_URL_SCRIPTS,
};
