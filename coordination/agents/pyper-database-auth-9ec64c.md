---
agent: pyper-database-auth-9ec64c
branch: claude/pyper-database-auth-9ec64c
status: working
updated: 2026-08-13T14:22:20Z
auto: true
---

## Now
Last commit: Merge main before push

## Uncommitted changes
- (clean)

## Fixes & gotchas (others should apply)
- **convex/ deploy race**: only ONE `npx convex dev` should run against the shared dev deployment (`chatty-penguin-848`). A second long-running `convex dev` re-pushes an older tree and clobbers others' deploys (drops the apiKeys/spaceInvitations tables mid-test). Use `npx convex dev --once` for one-shot deploys.
- **Install**: Node 24 + `npm install --legacy-peer-deps`; sandbox npm cache is broken → add `--cache <local dir>`. turbo isn't linked by a partial `npm install <pkg>` — a full `npm install` is needed for `npm run typecheck` to work.
- **Auth is mocked**: any Convex function reads the caller via `requireSubject(ctx)` → `DEV_SUBJECT` until `AUTH_MODE=real`. Don't rely on real identities yet.
- **`convex/http.ts` is shared** (auth-component routes + my v1 REST routes coexist). Merge carefully.
- **Renderer typecheck drag-in**: do NOT `import { api } from "../convex/_generated/api"` in `apps/desktop/src/**` — it drags the whole `convex/` dir into `npm run typecheck` (`cd src && tsc`) and fails (TS2589 deep-instantiation + a TS2345 in conversations.ts; convex/ is meant for Convex's own toolchain). In renderer code use `anyApi` from `convex/server` (see `src/components/ConvexDevView.tsx`). Client provider lives in `src/lib/convexClient.ts`; `?convexdev` renders an isolated Convex read view for browser verification.
