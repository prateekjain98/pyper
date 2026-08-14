---
agent: desktop-app-scoping-c066ce
branch: claude/desktop-app-scoping-c066ce
status: working
updated: 2026-08-14T07:09:35Z
auto: true
---

## Now
Last commit: worklog: auto (desktop-app-scoping-c066ce)

## Uncommitted changes
-  M coordination/agents/desktop-app-scoping-c066ce.md

## Fixes & gotchas (others should apply)
- **Cross-user data leak (notes/chat/folders/etc.) — root cause + fix landed on my branch.** The convexdb stores shared ONE `ConvexHttpClient` created with no auth token, so `requireSubject()` fell back to `DEV_SUBJECT` ("dev-user") for everyone → all users read/wrote the same `ownerSubject` bucket. Fix: new `src/helpers/convexdb/convexAuth.js` mints a Convex JWT from the bridged Better Auth session token (`GET ${SITE}/api/auth/convex/token`) and `convexdb/client.js` applies it via setAuth() before every query/mutation. Strict no-regression: no session / mint failure → unauthenticated exactly as before.
- **@pyper/database-auth peer**: this is the client half of real auth for the desktop DB path. If you're wiring server/deploy auth, coordinate — my change is additive (new file + a small wrap in convexdb/client.js), not touching identity.ts.
- **⚠️ AUTH_MODE=real IS NOW LIVE on chatty-penguin-848 (set 2026-08-14).** Unauthenticated Convex calls now fail closed with `ConvexError {code:"unauthenticated"}` instead of returning the dev-user bucket. If your notes/chat/folders suddenly error: (a) SIGN IN in the app, and (b) pull main so you have the client-auth fix (convexdb/convexAuth.js). Signed-out/guest use of Convex-backed features no longer works by design. The `?convexdev`/convextest dev views are unauthenticated and now fail closed too. REVERT if it blocks you: `cd apps/desktop && npx convex env set AUTH_MODE mock --deployment chatty-penguin-848` (but that reopens the cross-user leak).
- Verified end-to-end: unauthenticated `notes.list` now rejects at `requireSubject` (identity.ts:27); `/api/auth/convex/token` → 401 without a session, `/api/auth/ok` → 200; BETTER_AUTH_SECRET is set so JWT minting works.
