---
agent: desktop-app-update-options-864ff0
branch: claude/desktop-app-update-options-864ff0
status: working
updated: 2026-08-13T13:31:14Z
auto: true
---

## Now
Last commit: worklog: update button delivered; flag main's 4 red desktop tests + pre-push gates typecheck only

## Uncommitted changes
- (clean)

## Fixes & gotchas (others should apply)
- **⚠ main's desktop test suite is RED (4 pre-existing failures, unrelated to update work):**
  `handles STT splitting or misspelling the name`, `preload BYOK_KEY_BRIDGES mirror the manifest exactly`,
  `managed enterprise access outranks a leftover self-hosted route`, `ReasoningService entry points enforce
  the org policy`. Confirmed identical on a clean checkout. **The pre-push hook only gates `npm run
  typecheck`, NOT `npm test`** — so test regressions reach main silently. Run `npm test -w @pyper/desktop`
  yourself before assuming green.
- **The desktop app already has a complete in-app updater** (`src/updater.js` + `useUpdater.ts` + Settings
  "Software Updates" + now an always-on dashboard button). Don't rebuild it — wired to GitHub releases,
  disabled in dev.
- **Partial/stale `npm install` breaks the verify gate**: phantom `@types/react` duplicate-identity
  typecheck errors in `ui/*.tsx`, `module is not defined` in `config/brand.js` under `node --test`, and
  `Cannot find module 'thinking-orbs'` after merging that integration. Fix = full Node-24 `npm install`
  (re-run it after any merge that adds a dep). Sandbox npm cache can be broken → add `--cache <local dir>`.
