---
agent: desktop-app-download-button-8aed85
branch: claude/desktop-app-download-button-8aed85
status: working
updated: 2026-08-13T20:43:48Z
auto: true
---

## Now
Last commit: Merge remote-tracking branch 'origin/main' into claude/desktop-app-download-button-8aed85

## Uncommitted changes
-  M coordination/agents/desktop-app-download-button-8aed85.md
- ?? .stray_database.js
- ?? .stray_nmcopybak/
- ?? apps/desktop/AgentOverlay-Brx076r_.js
- ?? apps/desktop/AiNoteTakerView-BbfIoqAo.js
- ?? apps/desktop/ChatEmptyIllustration-DPsTJUoP.js
- ?? apps/desktop/ChatView-AXcOo7t7.js
- ?? apps/desktop/CommandSearch-yrdptxcf.js
- ?? apps/desktop/ControlPanel-BFGPGsG8.js
- ?? apps/desktop/ConvexAuthTest-Ca8yJEsc.js
- ?? apps/desktop/CopyableCommand-5dhoNQp9.js
- ?? apps/desktop/DictionaryView-DXE_jw2J.js
- ?? apps/desktop/EmailVerificationStep-C9-PH-Az.js
- ?? apps/desktop/GetApiKeyLink-DLnEj7O8.js
- ?? apps/desktop/InsightsView-BcfFhSzz.js

## Fixes & gotchas (others should apply)
- **✅ FIXED — Google sign-in no longer bounces back to the login screen (account-scope reconciliation).** After a valid Better Auth session, `useAuth` ran account-scope reconciliation which called into the legacy pyper-api cloud sync (`SyncService.purgeTeamSpacesForSignOut` / `verifyTeamSpacesForAccount` → `SpacesService` → `cloudApi.ts` throws `CLOUD_NOT_CONFIGURED` because `PYPER_API_URL` is unset under the Convex DB facade). That throw propagated to `run().catch` → `invalidateValidatedAuthContext()` → `accountScopePresentable=false` → user stranded on login despite a good session. Fix: made BOTH side-effecting callbacks in `useAuth.ts` non-blocking — `purgeCachedTeamContent` (returns/ warns instead of throwing on unclearable remainder) and `verifyCachedTeamContent` (try/catch swallows `CLOUD_NOT_CONFIGURED`, RE-THROWS `AUTH_CONTEXT_CHANGED`). `applyReconcile` (authAccountScope.ts) then reaches `markScopeValidated()` → `commitValidatedAuthContext` → `setIsSignedIn(true)`. Commits: 49b896d (purge path), 28c48e7 (verify path). **If you touch auth/SyncService: these two callbacks must never throw for the mock-auth/Convex-facade config — only real `AUTH_CONTEXT_CHANGED` aborts.**
- **✅ SHIPPED — widget gate: the dictation pill is hidden until signed in.** `windowManager._dictationGateOpen` + `setDictationAllowed(allowed)` IPC (preload/ipcHandlers/electron.ts); `AppRouter.jsx` computes `onLoginScreen = onboardingCompleted && !signedInMirror && !authSkipped` and calls `setDictationAllowed(!onLoginScreen)`. Gates showDictationPanel, toggle/PTT senders, mic warm, ready-to-show auto-show.
- **⚠ PACKAGING GOTCHA — `electron-builder --mac` with `CSC_IDENTITY_AUTO_DISCOVERY=false` leaves a BROKEN signature** (`Identifier=Electron`, `flags=adhoc,linker-signed`, "code has no resources" → macOS "damaged"). You MUST `codesign --force --deep --sign - dist/mac-arm64/Pyper.app` afterward (gives `Identifier=com.saaslabs.pyper`, clean adhoc, verify --deep --strict passes → "Open Anyway"), THEN rebuild the dmg from the re-signed app (ditto to a clean staging dir → `hdiutil create`; detach any stale `/Volumes/Pyper` first or `hdiutil create` fails "Resource busy"). The dmg electron-builder emits directly is built from the broken-signature app — don't ship it.
- **✅ SHIPPED — the downloaded macOS app is rebuilt WITHOUT better-sqlite3 and live on the GCS download link** (`gs://pyper-desktop-downloads/Pyper-1.8.3-arm64.dmg`, verified serving the new 334MB build). The old dmg still had better-sqlite3 → same NODE_MODULE_VERSION crash; a fresh `electron-builder` build fixed it. **BUILD GOTCHA (3ab671f):** after removing better-sqlite3, `npm run build`/`electron-builder --mac` produced an app with **0 bundled node_modules** (afterPack failed on "missing ffmpeg-static"). Cause: `scripts/beforeBuild.js` returned `false`, which tells electron-builder to SKIP dependency install — fine when it rebuilt better-sqlite3 and the app had local node_modules, but fatal once deps are hoisted to the workspace root (app dir empty). Fix: deleted the beforeBuild hook. Also: build from a **clean `npm ci`** state (a stray hand-copied `apps/desktop/node_modules` shadows the workspace linkage → `npm ls` shows all deps "extraneous" → 0 deps bundled). Unsigned build → deep ad-hoc sign (`codesign --force --deep --sign -`) so it's "Open Anyway", not "damaged"; notarization still pending.
- **✅ DONE — SQLite/better-sqlite3 is FULLY REMOVED from the desktop app; Convex is the DB layer.** The app runs on `ConvexDatabaseManager` (`apps/desktop/src/helpers/convexDatabaseManager.js`): 110 methods delegated to `convexdb/` Store adapters, 54 to `convexdb/localStore.js` JSON files (calendar/tokens/speakers/actions/contacts), 7 cross-entity cascades. `database.js` now just `module.exports = require("./convexDatabaseManager")` (SQLite impl in git history). Verified: Electron ABI-145 boot, desktop typecheck + renderer build green, **live reads AND writes** against chatty-penguin-848, zero new test failures (the ~57 red desktop tests are pre-existing/env — dictation-inference/policy/calendar, none touch the DB; identical on clean main). Commits: 972d8db (default→Convex), f7781cf (remove SQLite + delete 17 DB tests + harness/db.js), 1854d77 (lockfile).
- **⚠ FLEET HEADS-UP — if your branch has DB tests or SQLite `database.js` code, rebase carefully.** I deleted 17 SQLite-backed test files incl. the SyncService DB tests (`syncServiceNotes/Folders/Conversations`, `syncScenarios`, `syncDeleteGuards`, `markNoteSyncedGuard`, `spacesDatabase`, `dictionaryDatabase`, `calendarDatabase`, …) + `test/helpers/harness/db.js`, and removed `better-sqlite3` from package.json / lockfile / electron-builder / release.yml CI. **@auth/SyncService owner:** your SQLite sync tests are gone on main — the DB layer is Convex now; ping me to reconcile. `require("./database")` still works (re-exports the facade).
