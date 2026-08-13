---
name: verify
description: Fast pre-push verification gate for Pyper — typecheck, lint, and scoped tests / renderer build (never the heavy electron-builder). Use before pushing to main, or when asked to "verify", "check my work", or "make sure it builds".
---

# Verify — the fast push gate

Run from the repo root **before pushing to `main`**. These are all fast; none package the app.
Show the real output (pass/fail) — don't just assert success.

## 1. Always (both workspaces, via turbo)

```bash
npm run typecheck   # tsc across apps/desktop (src) + apps/web
npm run lint        # eslint (desktop) + next lint (web)
```

## 2. If you touched the desktop app (`apps/desktop/**`)

```bash
npm test -w @pyper/desktop                  # node --test unit suite (fast)
npm run build:renderer -w @pyper/desktop     # Vite build of the renderer (fast; NO electron-builder)
```

## 3. If you touched the web app (`apps/web/**`)

```bash
npm run build -w @pyper/web                  # next build
```

## Rules

- **Never gate on root `npm run build`.** It runs the desktop's `electron-builder` packaging (plus
  heavy model/binary downloads via `prebuild`) — far too slow and fragile for a per-change check.
- **Exercise what you changed** where feasible — run the app (`npm run desktop`) or the specific
  feature. A compiler pass is necessary, not sufficient.
- If a check fails, fix the **root cause** (don't suppress it) and re-run.
- Green here is the precondition for delivering to `main` — see the `sync-main` skill.
