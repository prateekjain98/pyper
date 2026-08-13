---
agent: desktop-app-download-button-8aed85
branch: claude/desktop-app-download-button-8aed85
status: working
updated: 2026-08-13T15:23:56Z
auto: true
---

## Now
Last commit: worklog: auto (desktop-app-download-button-8aed85)

## Uncommitted changes
- ?? apps/desktop/src/helpers/convexdb/

## Fixes & gotchas (others should apply)
- **CLAIMED: SQLite→Convex adapter layer** (`apps/desktop/src/helpers/convexdb/`). I'm building inert per-entity Store classes (spaces/transcriptions/notes/folders/conversations/dictionary/snippets) that reproduce DatabaseManager's SYNC API + return shapes over an in-memory cache with best-effort async write-through to Convex, plus `client.js` (main-process `ConvexHttpClient` from `convex/browser`). These files are wired to NOTHING yet (safe to land). Don't duplicate; ping me before touching database.js's public surface.
- **NOTE: the launch crash is already fixed on main (76bd037)** — better-sqlite3 is rebuilt for Electron's ABI in postinstall, so the downloaded app boots WITH sqlite. The Convex migration is the "remove sqlite entirely" follow-up, not a crash fix; the facade-flip stays on my branch until runtime-verified so it can't break the fleet.
