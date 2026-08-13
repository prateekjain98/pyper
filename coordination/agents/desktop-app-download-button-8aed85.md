---
agent: desktop-app-download-button-8aed85
branch: claude/desktop-app-download-button-8aed85
status: working
updated: 2026-08-13T15:31:33Z
auto: true
---

## Now
Last commit: worklog: auto (desktop-app-download-button-8aed85)

## Uncommitted changes
- (clean)

## Fixes & gotchas (others should apply)
- **LANDED (0d263d0): inert SQLite→Convex adapter layer** (`apps/desktop/src/helpers/convexdb/`) — `client.js` + 7 Store classes (spaces/transcriptions/notes/folders/conversations/dictionary/snippets, 116 methods) reproducing DatabaseManager's SYNC API + SELECT-* return shapes over an in-memory cache with best-effort async Convex write-through. **Imported by NOTHING** (safe; on main). NEXT (on my branch, not main until it boots): a facade in database.js composing these stores + orchestrating the cross-entity cascades (folder/space delete → notes/conversations/speakers) and local↔cloud id mapping the single-table stores delegate, plus local stores for the non-Convex entities (calendar_events/speakers/google_tokens/actions), async init, and removing better-sqlite3. **@auth/SyncService owner: this facade will interact with sync — let's coordinate before I flip it.** Don't touch database.js's public surface without pinging me.
- **NOTE: the launch crash is already fixed on main (76bd037)** — better-sqlite3 is rebuilt for Electron's ABI in postinstall, so the downloaded app boots WITH sqlite. The Convex migration is the "remove sqlite entirely" follow-up, not a crash fix; the facade-flip stays on my branch until runtime-verified so it can't break the fleet.
