---
agent: pyper-app-download-error-8d60dc
branch: claude/pyper-app-download-error-8d60dc
status: working
updated: 2026-08-13T14:38:02Z
auto: true
---

## Now
Last commit: worklog: better-sqlite3 Electron-ABI fix delivered; note DB-test rebuild caveat

## Uncommitted changes
- (clean)

## Fixes & gotchas (others should apply)
- **✅ FIXED & pushed (76bd037): downloaded app crashed on launch** with
  `better_sqlite3.node … compiled against NODE_MODULE_VERSION 137 … requires 145`. Cause:
  better-sqlite3 is the only node-gyp native module; `npm install` grabs a **Node**-ABI prebuilt
  (137 = Node 24) and electron-builder's default rebuild only re-downloads a prebuilt via
  prebuild-install — no Electron 41 prebuilt exists — so the **Node**-ABI copy shipped and Electron
  41 (ABI 145) couldn't load it. In this workspaces monorepo the module is **hoisted to the root**,
  which the default rebuild search doesn't reach. Fix = force a **from-source** compile against
  Electron headers (`scripts/rebuild-better-sqlite3.js` via `@electron/rebuild`, passing the
  workspace root as `projectRootPath`), wired into an electron-builder **`beforeBuild`** hook that
  returns `false` so the default prebuild-download can't clobber it. onnxruntime-node and
  @napi-rs/keyring are N-API/ABI-stable — deliberately **not** rebuilt.
- **⚠ postinstall now builds better-sqlite3 for ELECTRON, not Node.** `npm install` (and
  `npm run rebuild:native -w @pyper/desktop`) leave `better_sqlite3.node` at Electron's ABI so
  `npm run desktop` works out of the box. Consequence: the **Node-based DB unit tests skip locally**
  (the binding won't load under `node --test`). To run DB tests locally, first
  `npm rebuild better-sqlite3` (rebuilds for Node) — exactly what CI's tests job already does
  (`npm ci --ignore-scripts` skips my postinstall, then it `npm rebuild better-sqlite3`). CI build
  jobs are unaffected (beforeBuild handles the Electron ABI per target arch).
- If you bump the `electron` version, no action needed — the rebuild reads the installed Electron
  version and recompiles better-sqlite3 for its ABI automatically (postinstall + beforeBuild).
- **✅ FIXED & pushed (664c9eb): legacy-cloud error-loop when `VITE_PYPER_API_URL` is unset.**
  `cloudApiRequest` / `cloudConfigRequest` / the `cloud-usage` IPC handler used to throw + ERROR-log
  "Pyper API URL not configured" on every call, and renderer effects re-fired them on each
  auth-context change → perpetual log spam. They now return a benign
  `{ success:false, code:"CLOUD_NOT_CONFIGURED" }` (debug log, not error). No change when the URL is
  set (CI/prod). To fully silence the renderer callers, gate them on `code === "CLOUD_NOT_CONFIGURED"`.
- **⚠ @auth owner (pyper-database-auth): account-scope reconciliation retry loop.** With a bound
  Convex session but no bearer token in the main-process token store, `useAuth`'s reconciliation
  effect fails `assertAuthGenerationCurrent` ("Authentication context changed during reconciliation"),
  invalidates the context (bumps `authContext.revision`, an effect dep), and retries forever (backed
  off 1s→30s). Root cause looks like the Convex Better Auth token not reaching
  `helpers/tokenStore.js`. Local workaround: `VITE_DEV_MOCK_USER=true` (mock `useAuth`, no effects).
