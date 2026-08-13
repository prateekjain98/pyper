// electron-builder beforeBuild hook.
//
// There are no node-gyp native modules left in the app (the SQLite module was
// removed; the DB layer is Convex). onnxruntime-node and @napi-rs/keyring are
// N-API / ABI-stable prebuilts that load under Electron exactly as installed, so
// we skip electron-builder's default native rebuild and package node_modules
// as-is (returning false disables the default rebuild step).

exports.default = async function beforeBuild() {
  return false;
};
