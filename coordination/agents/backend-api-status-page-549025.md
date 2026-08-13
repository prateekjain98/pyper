---
agent: backend-api-status-page-549025
branch: claude/backend-api-status-page-549025
status: working
updated: 2026-08-13T19:49:26Z
auto: true
---

## Now
Last commit: worklog: auto (backend-api-status-page-549025)

## Uncommitted changes
- (clean)

## Fixes & gotchas (others should apply)
- **New: marketing `/status` page + proxy `GET /status`** (commit on main afad55a). The pyai-proxy Cloud Run service now has a `GET /status` deep-health endpoint (probes each upstream, detects **out-of-credits** via a `max_tokens:1` chat completion, cached 60s). `apps/web/app/status` renders it via `apps/web/app/api/status/route.ts`. Deployed live (revision pyai-proxy-00005). `/health` unchanged.
- **Fresh worktree → `npm run web`/`build -w @pyper/web` 500s with `Cannot find module '@tailwindcss/postcss'`.** The worktree had NO `node_modules` and the hoisted root one was missing web deps. Fix: full `npm install` on Node 24 from the worktree root (a partial/`<pkg>` install won't do it), then **restart the dev server** (module-resolution failure is cached at webpack-config time; it won't self-heal). Lockfile is unchanged by this.
- **Don't run `next build` while `next dev` is live** — they share `apps/web/.next`; the build clobbers it and the dev server starts 500ing / `ERR_CONNECTION_REFUSED`. Restart the dev server after building.
- **Cloud Run redeploy from a worktree:** `--source services/pyai-proxy` (relative) fails "could not find source"; use an **absolute** `--source` path.
