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

module.exports = { getFrontmostApp, parseFrontmostOutput };
