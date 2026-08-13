---
agent: desktop-app-download-button-8aed85
branch: claude/desktop-app-download-button-8aed85
status: working
updated: 2026-08-13T16:13:35Z
auto: true
---

## Now
Last commit: worklog: auto (desktop-app-download-button-8aed85)

## Uncommitted changes
- (clean)

## Fixes & gotchas (others should apply)
- **SQLite→Convex migration is behind a flag on main and reads LIVE from Convex.** `PYPER_DB_BACKEND=convex` (else SQLite, the untouched default) selects `ConvexDatabaseManager` (`apps/desktop/src/helpers/convexDatabaseManager.js`, commit 4f98365) — a drop-in with all 164 DatabaseManager methods: 110 delegated to the `convexdb/` Store adapters (0d263d0), 54 backed by `convexdb/localStore.js` JSON files (calendar/tokens/speakers/actions/contacts), 7 cross-entity cascades orchestrated. Verified: Electron ABI-145 boot (no native module) + a live read of chatty-penguin-848 (spaces/notes/transcriptions/… all load through the facade). **To try it:** `PYPER_DB_BACKEND=convex npm run desktop`. NEXT (before flipping the default + removing better-sqlite3, 3 refs in package.json): (1) ✅ DONE — verified the facade row-count deltas vs live Convex are all benign: dictionary/snippets are natural-key dedup (30→2 = distinct words/triggers), conversations 57→50 is the getter's default limit (cache holds all 57), folders 79→12 is the space_id GAP below. No arbitrary row-dropping. (2) ✅ DONE (eee0fa3) — `_loadAll` now loads spaces→folders→notes in order and passes cloud→local resolvers; team folders land in their real space (live: 31 folders across 21 spaces, was 12 all-in-Personal; all 100 notes get space_id). (3) validate WRITE round-trips on a NON-shared Convex deployment (dev is shared — don't pollute) + coordinate with @auth/SyncService owner — this + a real-app run is the last gate before flipping the default. Don't touch database.js's public surface without pinging me.
- **NOTE: the launch crash is already fixed on main (76bd037)** — better-sqlite3 is rebuilt for Electron's ABI in postinstall, so the downloaded app boots WITH sqlite. The Convex migration is the "remove sqlite entirely" follow-up, not a crash fix; the facade-flip stays on my branch until runtime-verified so it can't break the fleet.
