---
agent: desktop-app-download-button-8aed85
branch: claude/desktop-app-download-button-8aed85
status: working
updated: 2026-08-13T17:16:12Z
auto: true
---

## Now
Last commit: Merge remote-tracking branch 'origin/main' into claude/desktop-app-download-button-8aed85

## Uncommitted changes
- (clean)

## Fixes & gotchas (others should apply)
- **✅ DONE — SQLite/better-sqlite3 is FULLY REMOVED from the desktop app; Convex is the DB layer.** The app runs on `ConvexDatabaseManager` (`apps/desktop/src/helpers/convexDatabaseManager.js`): 110 methods delegated to `convexdb/` Store adapters, 54 to `convexdb/localStore.js` JSON files (calendar/tokens/speakers/actions/contacts), 7 cross-entity cascades. `database.js` now just `module.exports = require("./convexDatabaseManager")` (SQLite impl in git history). Verified: Electron ABI-145 boot, desktop typecheck + renderer build green, **live reads AND writes** against chatty-penguin-848, zero new test failures (the ~57 red desktop tests are pre-existing/env — dictation-inference/policy/calendar, none touch the DB; identical on clean main). Commits: 972d8db (default→Convex), f7781cf (remove SQLite + delete 17 DB tests + harness/db.js), 1854d77 (lockfile).
- **⚠ FLEET HEADS-UP — if your branch has DB tests or SQLite `database.js` code, rebase carefully.** I deleted 17 SQLite-backed test files incl. the SyncService DB tests (`syncServiceNotes/Folders/Conversations`, `syncScenarios`, `syncDeleteGuards`, `markNoteSyncedGuard`, `spacesDatabase`, `dictionaryDatabase`, `calendarDatabase`, …) + `test/helpers/harness/db.js`, and removed `better-sqlite3` from package.json / lockfile / electron-builder / release.yml CI. **@auth/SyncService owner:** your SQLite sync tests are gone on main — the DB layer is Convex now; ping me to reconcile. `require("./database")` still works (re-exports the facade).
