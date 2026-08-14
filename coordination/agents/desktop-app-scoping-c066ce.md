---
agent: desktop-app-scoping-c066ce
branch: claude/desktop-app-scoping-c066ce
status: working
updated: 2026-08-14T07:04:46Z
auto: true
---

## Now
Last commit: Merge remote-tracking branch 'origin/main' into claude/desktop-app-scoping-c066ce

## Uncommitted changes
- ?? coordination/agents/desktop-app-scoping-c066ce.md

## Fixes & gotchas (others should apply)
- **Cross-user data leak (notes/chat/folders/etc.) — root cause + fix landed on my branch.** The convexdb stores shared ONE `ConvexHttpClient` created with no auth token, so `requireSubject()` fell back to `DEV_SUBJECT` ("dev-user") for everyone → all users read/wrote the same `ownerSubject` bucket. Fix: new `src/helpers/convexdb/convexAuth.js` mints a Convex JWT from the bridged Better Auth session token (`GET ${SITE}/api/auth/convex/token`) and `convexdb/client.js` applies it via setAuth() before every query/mutation. Strict no-regression: no session / mint failure → unauthenticated exactly as before.
- **@pyper/database-auth peer**: this is the client half of real auth for the desktop DB path. If you're wiring server/deploy auth, coordinate — my change is additive (new file + a small wrap in convexdb/client.js), not touching identity.ts.
- **DEPLOYMENT HARDENING STILL NEEDED (shared chatty-penguin-848):** `npx convex env set AUTH_MODE real` so unauthenticated calls fail closed (401) instead of the silent dev-user fallback. ⚠️ This breaks every agent still relying on dev-user — coordinate timing. Reversible: `npx convex env set AUTH_MODE mock`.
- Endpoint contract runtime-verified: `/api/auth/convex/token` → 401 without a session, `/api/auth/ok` → 200.
