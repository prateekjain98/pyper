---
agent: pyper-database-auth (Convex backend)
branch: claude/pyper-database-auth-9ec64c
status: working
updated: 2026-08-13T12:52:08Z
---

## Now
Building the Convex backend for the migration (`apps/desktop/convex/`). All work pushed to `main`
through `6ed4012`. Auth is MOCKED to `DEV_SUBJECT` (`convex/lib/identity.ts`) — one-line swap once
`@convex-dev/better-auth` is activated via `npx convex dev`.

## Progress
- 12:52 — v1 transcriptions: get-by-id + cursor pagination. 53 assertions green.
- 12:49 — Public REST v1 API complete: notes CRUD + search + **cursor pagination**, folders, transcriptions, spaces, usage — over `.convex.site` with `pyk_live_` API-key auth + scopes. 52 assertions green.
- earlier — Teams/spaces: CRUD, roles, cross-member note/folder visibility, moveToSpace, invitations, leaveSpace/transferOwnership. API keys (create/list/revoke, sha256 at rest).
- earlier — All 6 content entities (notes, folders, transcriptions, dictionary, snippets, conversations+messages) as native Convex fns + full-text search index.
- Verify loop each push: `npx convex dev --once` → `node apps/desktop/scripts/convex-test.mjs` (52/52) → `npm run typecheck`.

## Blockers
- **Desktop client rewrite (wire app to Convex + remove SQLite) needs a human**: `npx convex dev` interactive auth activation + a running Electron app to verify. Vector/semantic search needs an embeddings API key. Prod deploy needs deploy keys.

## Fixes & gotchas (others should apply)
- **convex/ deploy race**: only ONE `npx convex dev` should run against the shared dev deployment (`chatty-penguin-848`). A second long-running `convex dev` re-pushes an older tree and clobbers others' deploys (drops the apiKeys/spaceInvitations tables mid-test). Use `npx convex dev --once` for one-shot deploys.
- **Install**: Node 24 + `npm install --legacy-peer-deps`; sandbox npm cache is broken → add `--cache <local dir>`. turbo isn't linked by a partial `npm install <pkg>` — a full `npm install` is needed for `npm run typecheck` to work.
- **Auth is mocked**: any Convex function reads the caller via `requireSubject(ctx)` → `DEV_SUBJECT` until `AUTH_MODE=real`. Don't rely on real identities yet.
- **`convex/http.ts` is shared** (auth-component routes + my v1 REST routes coexist). Merge carefully.
