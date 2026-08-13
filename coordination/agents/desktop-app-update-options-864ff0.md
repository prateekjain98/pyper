---
agent: desktop-app-update-options-864ff0
branch: claude/desktop-app-update-options-864ff0
status: working
updated: 2026-08-13T14:11:21Z
auto: true
---

## Now
Last commit: worklog: auto (desktop-app-download-button-8aed85)

## Uncommitted changes
-  M coordination/agents/desktop-app-update-options-864ff0.md

## Fixes & gotchas (others should apply)
- **⚠ main's desktop test suite is RED — 4 failures, root-caused (owners please fix your own):**
  **The pre-push hook only gates `npm run typecheck`, NOT `npm test`** — regressions reach main silently;
  run `npm test -w @pyper/desktop` yourself.
  1. `ReasoningService entry points enforce the org policy` **+** `managed enterprise access outranks a
     leftover self-hosted route` → both `ReferenceError: module is not defined`. Cause: `53ff121`
     (brand centralize) made `src/config/brand.js` **CommonJS** (`module.exports`); the `node --test`+tsx/vite
     ESM loader can't eval it, and these tests' import chain reaches it. Test-harness-only (renderer build +
     runtime are fine — `vite.config.mjs` aliases it). Fix: give the test chain an ESM path to BRAND (import
     `config/brand.ts`, or make `brand.js` dual-mode).
  2. `preload BYOK_KEY_BRIDGES mirror the manifest exactly` → **REAL runtime gap**, not a test nit. `eadfde8`
     (add PyAI BYOK provider) added `pyai` to `BYOK_API_KEYS` in `src/config/secretKeys.js` but NOT the
     matching `{base:"pyai",get:"getPyaiKey",save:"savePyaiKey"}` bridge in `preload.js` → PyAI key
     save/load is unwired for the renderer. Owner: PyAI/npm-package-manager agent.
  3. `handles STT splitting or misspelling the name` → asserts `detectAgentName("…open whisper…","Pyper")`
     is `true`; stale OpenWhispr-era expectation vs current logic. Owner: reconcile test vs `detectAgentName`.
- **The desktop app already has a complete in-app updater** (`src/updater.js` + `useUpdater.ts` + Settings
  "Software Updates" + now an always-on dashboard button). Don't rebuild it — wired to GitHub releases,
  disabled in dev.
- **Partial/stale `npm install` breaks the verify gate**: phantom `@types/react` duplicate-identity
  typecheck errors in `ui/*.tsx`, and `Cannot find module 'thinking-orbs'` after merging that integration.
  Fix = full Node-24 `npm install` (re-run it after any merge that adds a dep). Sandbox npm cache can be
  broken → add `--cache <local dir>`. (NB: `module is not defined` in `brand.js` is a *separate* real bug —
  see test failure #1 above — NOT an install symptom.)
