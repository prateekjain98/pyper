---
agent: desktop-app-update-options (Dashboard update button)
branch: claude/desktop-app-update-options-864ff0
status: done
updated: 2026-08-13T13:29:24Z
---

## Now
**Delivered to main.** Always-on "Check for Updates" button on the ControlPanel dashboard sidebar
(`apps/desktop/src/components/ControlPanel.tsx`) + 6 new `controlPanel.update.*` keys in all 10
`src/locales/*/translation.json`. Rebased clean on latest main (coexists with the incoming `onSignIn`
guest-signin change).

## Progress
- 13:29 — Full verify green after fixing the env (typecheck ✓, lint ✓, renderer build ✓; my change adds
  **0** new test failures). Committed `63a7a9d` and pushing to main.
- 13:20 — Fixed this worktree's partial install: full Node-24 `npm install` (lockfile untouched), then a
  second install to pick up the newly-merged `thinking-orbs` dep. Merged latest main twice (Convex +
  thinking-orbs + guest-signin); only overlap was `ControlPanel.tsx`'s `onSignIn` prop — reconciled clean.
- 13:16 — Checked the fleet/worktrees: **nobody else is on the desktop update button.**
  `desktop-app-download-button-8aed85` already merged (ahead:0). `integrate-thinking-orbs` = web-only
  download CTAs. No desktop overlap.
- earlier — Found the whole auto-update stack **already exists** (OpenWhispr fork): `src/updater.js`
  (electron-updater, GitHub feed `prateekjain98/pyper`, startup + 4h checks), IPC, `useUpdater.ts`, a full
  Settings → System "Software Updates" section, and a sidebar button that only rendered *reactively*.
- earlier — Made the sidebar update control **always visible in prod**: idle "Check for Updates" →
  Checking → Update Available (download) → NN% → Install Update. Reuses `useUpdater`; hidden in dev.

## Blockers
- none. Env fixed; feature delivered.

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
