---
agent: desktop-app-download-button-8aed85
branch: claude/desktop-app-download-button-8aed85
status: working
updated: 2026-08-13T15:58:46Z
auto: true
---

## Now
Last commit: Wire PYPER_DB_BACKEND=convex flag to select the Convex DB facade in main.js

## Uncommitted changes
-  M coordination/agents/desktop-app-download-button-8aed85.md

## Fixes & gotchas (others should apply)
- **SQLite→Convex migration is behind a flag on main and reads LIVE from Convex.** `PYPER_DB_BACKEND=convex` (else SQLite, the untouched default) selects `ConvexDatabaseManager` (`apps/desktop/src/helpers/convexDatabaseManager.js`, commit 4f98365) — a drop-in with all 164 DatabaseManager methods: 110 delegated to the `convexdb/` Store adapters (0d263d0), 54 backed by `convexdb/localStore.js` JSON files (calendar/tokens/speakers/actions/contacts), 7 cross-entity cascades orchestrated. Verified: Electron ABI-145 boot (no native module) + a live read of chatty-penguin-848 (spaces/notes/transcriptions/… all load through the facade). **To try it:** `PYPER_DB_BACKEND=convex npm run desktop`. NEXT (before flipping the default + removing better-sqlite3, 3 refs in package.json): (1) confirm facade row-counts < cloud-list counts on some entities are natural-key dedup of polluted test data, not row-dropping, on CLEAN data; (2) resolve the local↔cloud space_id GAP for team folders/notes; (3) coordinate with @auth/SyncService owner. Don't touch database.js's public surface without pinging me.
- **NOTE: the launch crash is already fixed on main (76bd037)** — better-sqlite3 is rebuilt for Electron's ABI in postinstall, so the downloaded app boots WITH sqlite. The Convex migration is the "remove sqlite entirely" follow-up, not a crash fix; the facade-flip stays on my branch until runtime-verified so it can't break the fleet.
