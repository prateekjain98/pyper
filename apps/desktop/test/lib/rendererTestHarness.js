// Shared setup for tests that load renderer modules through Vite SSR:
// Map-backed browser globals plus a dev server with per-test module mocks.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function installBrowserGlobals(t, { initialStorage = {}, window: windowProps = {} } = {}) {
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const values = new Map(Object.entries(initialStorage));
  const storage = {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
  globalThis.localStorage = storage;
  globalThis.window = {
    innerWidth: 1200,
    localStorage: storage,
    addEventListener() {},
    removeEventListener() {},
    setInterval() {
      return 1;
    },
    electronAPI: {},
    ...windowProps,
  };
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
  });
  return { window: globalThis.window, storage };
}

// mockModules maps an import-path suffix (e.g. "/utils/logger") to the ESM
// source served in its place.
async function createRendererServer(
  t,
  { cachePrefix = "pyper-renderer-test-", mockModules = {}, env = {} } = {}
) {
  const { createServer } = await import("vite");
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), cachePrefix));
  const suffixes = Object.keys(mockModules);
  // Inject VITE_-prefixed env (e.g. VITE_PYPER_API_URL) so import.meta.env sees it
  // during SSR module evaluation. Vite reads process.env when the server is created.
  const savedEnv = {};
  for (const [key, value] of Object.entries(env)) {
    savedEnv[key] = Object.prototype.hasOwnProperty.call(process.env, key)
      ? process.env[key]
      : undefined;
    process.env[key] = value;
  }
  const vite = await createServer({
    root: path.resolve(__dirname, "../../src"),
    cacheDir,
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    // Mirror vite.config.mjs's `.ts`-first extension order (configFile:false
    // means we don't inherit it). Without this, a bare `../config/brand`
    // resolves to the CommonJS `brand.js` (main-process require target), which
    // the SSR module runner serves as ESM → "module is not defined". `.ts`
    // first makes it pick the ESM `brand.ts`, matching the real renderer build.
    resolve: { extensions: [".mjs", ".mts", ".ts", ".tsx", ".js", ".jsx", ".json"] },
    optimizeDeps: { noDiscovery: true },
    plugins: [
      {
        name: "renderer-test-module-mocks",
        enforce: "pre",
        resolveId(source) {
          const suffix = suffixes.find((candidate) => source.endsWith(candidate));
          return suffix ? `\0mock:${suffix}` : null;
        },
        load(id) {
          if (!id.startsWith("\0mock:")) return null;
          return mockModules[id.slice("\0mock:".length)];
        },
      },
    ],
    server: { middlewareMode: true },
  });
  t.after(async () => {
    await vite.close();
    fs.rmSync(cacheDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  return vite;
}

module.exports = { createRendererServer, installBrowserGlobals };
