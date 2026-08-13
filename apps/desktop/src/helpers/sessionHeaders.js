const { BRAND } = require("../config/brand");

const PYPER_HOST_PATTERNS = [
  `${BRAND.urls.auth}/*`,
  `${BRAND.urls.api}/*`,
  "http://localhost:3000/*",
  "http://127.0.0.1:3000/*",
];

// Electron's file:// renderer sends Origin: null, which Better Auth's
// trustedOrigins check rejects. Spoof Origin to the request's own URL so calls
// to Pyper's auth and API hosts are treated as same-origin. Every session
// that talks to those hosts needs this — webRequest hooks are per-session, so
// an isolated partition gets none of the default session's.
function applyPyperOriginHeader(targetSession) {
  targetSession.webRequest.onBeforeSendHeaders(
    { urls: PYPER_HOST_PATTERNS },
    (details, callback) => {
      try {
        details.requestHeaders["Origin"] = new URL(details.url).origin;
      } catch {
        // malformed URL — leave Origin as-is
      }
      callback({ requestHeaders: details.requestHeaders });
    }
  );
}

module.exports = { applyPyperOriginHeader };
