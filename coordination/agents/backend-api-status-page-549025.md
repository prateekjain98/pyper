---
agent: backend-api-status-page-549025
branch: claude/backend-api-status-page-549025
status: working
updated: 2026-08-13T20:07:46Z
auto: true
---

## Now
Last commit: Merge remote-tracking branch 'origin/main' into claude/backend-api-status-page-549025

## Uncommitted changes
-  M coordination/agents/backend-api-status-page-549025.md

## Fixes & gotchas (others should apply)
- **New: marketing `/status` page + proxy `GET /status`** (on main). The pyai-proxy Cloud Run service has a `GET /status` deep-health endpoint (probes each upstream, detects **out-of-credits** via a `max_tokens:1` chat completion, cached 60s) + linked from header/footer nav. `apps/web/app/status` renders it via `apps/web/app/api/status/route.ts`. `/health` unchanged.
- **/status now shows rate-limit budget remaining + a low warning** (commit c0df956). Parses `x-ratelimit-*` headers into `budget` (remaining/limit requests+tokens, %, reset), warns <15%. **Confirmed: NO provider (PyAI/Groq/OpenAI) exposes a prepaid $ balance to a normal API key** — OpenAI needs an admin key (`api.usage.read` scope) for `/organization/costs`; Groq/PyAI have no balance endpoint. So the page shows the rate-limit window budget, not a $ balance (`accountBalanceAvailable:false`).
- **Fresh worktree → `npm run web`/`build -w @pyper/web` 500s with `Cannot find module '@tailwindcss/postcss'`.** The worktree had NO `node_modules` and the hoisted root one was missing web deps. Fix: full `npm install` on Node 24 from the worktree root (a partial/`<pkg>` install won't do it), then **restart the dev server** (module-resolution failure is cached at webpack-config time; it won't self-heal). Lockfile is unchanged by this.
- **Don't run `next build` while `next dev` is live** — they share `apps/web/.next`; the build clobbers it and the dev server starts 500ing / `ERR_CONNECTION_REFUSED`. Restart the dev server after building.
- **Cloud Run redeploy from a worktree:** `--source services/pyai-proxy` (relative) fails "could not find source"; use an **absolute** `--source` path.
