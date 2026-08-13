// Single source of truth for Pyper brand identifiers.
//
// Change DOMAIN here to repoint every Pyper URL/email across the app (renderer
// and main process). This is intentionally a plain CommonJS module so the
// Electron main process can `require()` it directly; the renderer consumes the
// typed re-export in `brand.ts`.
const DOMAIN = "pyper.work";

const BRAND = {
  name: "Pyper",
  domain: DOMAIN,
  // Custom URL scheme used for desktop OAuth deep links (e.g. "pyper://").
  protocol: "pyper",
  appId: "com.saaslabs.pyper",
  urls: {
    website: `https://${DOMAIN}`,
    docs: `https://docs.${DOMAIN}`,
    api: `https://api.${DOMAIN}`,
    auth: `https://auth.${DOMAIN}`,
    mcp: `https://mcp.${DOMAIN}`,
    notes: `https://notes.${DOMAIN}`,
  },
  emails: {
    support: `support@${DOMAIN}`,
    security: `security@${DOMAIN}`,
  },
};

module.exports = { DOMAIN, BRAND };
