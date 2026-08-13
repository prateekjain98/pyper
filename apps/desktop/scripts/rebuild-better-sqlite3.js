// Rebuild the better-sqlite3 native addon against Electron's ABI (from source).
//
// Why this exists
// ---------------
// better-sqlite3 is the only node-gyp native module in the desktop app. A plain
// `npm install` fetches a *Node*-ABI prebuilt binary (NODE_MODULE_VERSION 137 for
// Node 24), and electron-builder's default rebuild step (and `install-app-deps`)
// just re-download a prebuilt via prebuild-install — for which no matching
// Electron 41 build is published — so the copy that ends up bundled stays a
// Node-ABI binary. The packaged app then crashes on launch:
//
//   The module '…/better_sqlite3.node' was compiled against a different Node.js
//   version using NODE_MODULE_VERSION 137. This version of Node.js requires
//   NODE_MODULE_VERSION 145. Please try re-compiling or re-installing the module.
//
// Forcing a from-source compile against Electron's headers produces the correct
// ABI (145 for Electron 41). N-API modules (onnxruntime-node, @napi-rs/keyring)
// are ABI-stable prebuilts and deliberately left untouched.
//
// Monorepo note: the module is hoisted to the workspace-root node_modules.
// @electron/rebuild locates it by walking the dependency tree from the app dir
// (`buildPath`), so we pass the desktop package dir — not the module path.

const fs = require("fs");
const path = require("path");
const { rebuild } = require("@electron/rebuild");

const APP_DIR = path.resolve(__dirname, "..");

// Walk up from the app dir to the npm-workspaces root (the package.json that
// declares `workspaces`). In this monorepo native deps are hoisted there, so
// @electron/rebuild needs it as `projectRootPath` to locate better-sqlite3 —
// without it the dependency search finds nothing and silently skips the rebuild.
function findWorkspaceRoot(startDir) {
  let dir = startDir;
  for (;;) {
    const parent = path.dirname(dir);
    if (parent === dir) return startDir; // hit the fs root without a match
    const parentPkg = path.join(parent, "package.json");
    if (fs.existsSync(parentPkg)) {
      try {
        if (JSON.parse(fs.readFileSync(parentPkg, "utf8")).workspaces) return parent;
      } catch {
        // ignore malformed package.json and keep walking up
      }
    }
    dir = parent;
  }
}

/**
 * Rebuild better-sqlite3 from source for a given Electron version + arch.
 * Throws if the compile fails — callers decide whether that is fatal.
 *
 * @param {object} [opts]
 * @param {string} [opts.appDir]          App dir to resolve deps from (default: apps/desktop).
 * @param {string} [opts.electronVersion] Target Electron version (default: installed electron).
 * @param {string} [opts.arch]            Target arch, e.g. "x64" | "arm64" (default: process.arch).
 */
async function rebuildBetterSqlite3({ appDir = APP_DIR, electronVersion, arch } = {}) {
  const version = electronVersion || require("electron/package.json").version;
  const targetArch = arch || process.arch;

  await rebuild({
    buildPath: appDir,
    // Where the hoisted node_modules actually lives (workspace root). Required
    // for @electron/rebuild to find better-sqlite3 in this monorepo.
    projectRootPath: findWorkspaceRoot(appDir),
    electronVersion: version,
    arch: targetArch,
    onlyModules: ["better-sqlite3"],
    force: true,
    // The whole point: compile against Electron headers instead of grabbing a
    // (Node-ABI, or entirely absent) prebuilt via prebuild-install.
    buildFromSource: true,
  });

  return { electronVersion: version, arch: targetArch };
}

module.exports = { rebuildBetterSqlite3 };

// Direct/postinstall entry: best-effort so a rebuild failure never breaks
// `npm install` for the rest of the workspace. The release build's strict
// beforeBuild hook (scripts/beforeBuild.js) is the gate that must not ship a
// wrong-ABI binary.
if (require.main === module) {
  rebuildBetterSqlite3()
    .then(({ electronVersion, arch }) =>
      console.log(`  rebuilt better-sqlite3 from source for Electron ${electronVersion} (${arch})`)
    )
    .catch((err) => {
      console.warn(
        `  warning: could not rebuild better-sqlite3 for Electron (${err.message}).\n` +
          `  The Electron app may fail to start with a NODE_MODULE_VERSION mismatch until\n` +
          `  you run:  npm run rebuild:native -w @pyper/desktop`
      );
      // Exit 0 on purpose — do not fail the install for the whole workspace.
    });
}
