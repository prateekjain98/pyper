---
agent: desktop-app-update-options (Dashboard update button)
branch: claude/desktop-app-update-options-864ff0
status: working
updated: 2026-08-13T13:16:19Z
---

## Now
Making the in-app updater discoverable from the dashboard. Touching
`apps/desktop/src/components/ControlPanel.tsx` + the 6 new `controlPanel.update.*` keys in all 10
`src/locales/*/translation.json`. Implemented + verified locally (renderer build + desktop lint green);
NOT yet pushed to main.

## Progress
- 13:16 — Checked the fleet/worktrees: **nobody else is on the desktop update button.**
  `desktop-app-download-button-8aed85` is already merged (ahead:0). `integrate-thinking-orbs` has web
  (`apps/web`) download-CTA work only — no desktop overlap. origin/main advanced 14 commits (Convex +
  worklogs + transcription fix) — none touch my files, so my change merges clean.
- earlier — Found the whole auto-update stack **already exists** (from the OpenWhispr fork): `src/updater.js`
  (electron-updater, GitHub feed `prateekjain98/pyper`, startup + 4h checks), IPC in `ipcHandlers.js`,
  `useUpdater.ts`, a full Settings → System "Software Updates" section, and a sidebar button — but the
  sidebar button only rendered *reactively* after a background check found an update.
- earlier — Made the ControlPanel sidebar update control **always visible in prod**: idle "Check for
  Updates" → Checking → Update Available (download) → NN% → Install Update. Reuses `useUpdater`; hidden
  in dev (updater disabled there, same as Settings).

## Blockers
- none blocking the change itself. Full push-gate `npm run typecheck`/`npm test` fail on **pre-existing**
  errors in untouched files (`ui/button.tsx`, `ui/dialog.tsx`, `config/brand.js`) — confirmed identical
  with my diff stashed. Root cause is the partial-install gotcha below; fix is a full `npm install`.

## Fixes & gotchas (others should apply)
- **The desktop app already has a complete in-app updater** (`src/updater.js` + `useUpdater.ts` +
  Settings "Software Updates"). Don't rebuild it — it's wired to GitHub releases and dev-disabled. The
  dashboard now also has an always-on "Check for Updates" button in the ControlPanel sidebar footer.
- **Partial `npm install` breaks the verify gate** (confirming pyper-database-auth's note): a stale/partial
  node_modules gives phantom `@types/react` duplicate-identity typecheck errors in `ui/*.tsx` and a
  `module is not defined` in `config/brand.js` under `node --test`. A full Node-24 `npm install` fixes both;
  gate on `npm run build:renderer -w @pyper/desktop` + `npm run lint -w @pyper/desktop` meanwhile.
