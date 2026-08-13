// Renderer-side typed brand config.
//
// This intentionally MIRRORS `brand.js` rather than importing it. `brand.js` is
// CommonJS (so the Electron *main* process can `require()` it), and the
// rolldown-based Vite dev/build pipeline serves a source `.js` file as ESM
// without synthesizing exports from its `module.exports` — so
// `import brand from "./brand.js"` fails in the renderer ("does not provide an
// export named 'default'"). Keeping the renderer copy self-contained is the
// safe fix.
//
// ⚠️ Keep this in sync with `brand.js`. If you change the domain, change it in
// BOTH files (or consolidate to a single `.cjs`/JSON source consumed by both).
const DOMAIN = "pyper.work";

export const BRAND = {
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

export { DOMAIN };
