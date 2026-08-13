// electron-builder beforeBuild hook.
//
// Runs before electron-builder rebuilds native dependencies (requires
// npmRebuild: true in electron-builder.json). We rebuild better-sqlite3 from
// source against the exact target Electron version + arch, then return false so
// electron-builder skips its own rebuild — whose default prebuild-install
// download would otherwise replace our correct binary with a Node-ABI prebuilt
// and reintroduce the "NODE_MODULE_VERSION" startup crash.
//
// better-sqlite3 is the only node-gyp module in the app; onnxruntime-node and
// @napi-rs/keyring are N-API/ABI-stable prebuilts that need no per-Electron
// rebuild, so owning the rebuild here (and skipping the default) is safe.
//
// This hook is strict on purpose: if the compile fails, the error propagates and
// the release build fails loudly rather than shipping a broken app.

const { Arch } = require("app-builder-lib");
const { rebuildBetterSqlite3 } = require("./rebuild-better-sqlite3");

exports.default = async function beforeBuild(context) {
  // BeforeBuildContext.arch is normally a string, but map defensively in case
  // an Arch enum value is passed.
  const arch = typeof context.arch === "number" ? Arch[context.arch] : context.arch;

  console.log(
    `  beforeBuild: rebuilding better-sqlite3 from source for Electron ${context.electronVersion} (${arch})`
  );

  await rebuildBetterSqlite3({
    appDir: context.appDir,
    electronVersion: context.electronVersion,
    arch,
  });

  // We fully own native rebuilds; skip electron-builder's default step.
  return false;
};
