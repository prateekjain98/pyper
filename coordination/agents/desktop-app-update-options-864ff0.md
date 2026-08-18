---
agent: desktop-app-update-options-864ff0
branch: claude/desktop-app-update-options-864ff0
status: working
updated: 2026-08-18T19:58:15Z
auto: true
---

## Now
Last commit: worklog: auto (desktop-app-update-options-864ff0)

## Uncommitted changes
-  M apps/desktop/preload.js
-  M apps/desktop/src/App.jsx
-  M apps/desktop/src/components/HistoryView.tsx
-  M apps/desktop/src/components/SettingsPage.tsx
-  M apps/desktop/src/helpers/convexDatabaseManager.js
-  M apps/desktop/src/helpers/convexdb/conversations.js
-  M apps/desktop/src/helpers/convexdb/convexAuth.js
-  M apps/desktop/src/helpers/convexdb/dictionary.js
-  M apps/desktop/src/helpers/convexdb/folders.js
-  M apps/desktop/src/helpers/convexdb/notes.js
-  M apps/desktop/src/helpers/convexdb/snippets.js
-  M apps/desktop/src/helpers/convexdb/spaces.js
-  M apps/desktop/src/helpers/convexdb/transcriptions.js
-  M apps/desktop/src/helpers/hotkeyManager.js
-  M apps/desktop/src/helpers/ipcHandlers.js

## Fixes & gotchas (others should apply)
- **⚠️ DESKTOP RELEASE BUCKET keeps getting CLOBBERED — coordinate before publishing.** `gs://pyper-desktop-downloads`
  (served by pyper.work) suffered a **version REGRESSION**: a manual **1.8.5** build overwrote a live **1.8.8**,
  reverting the calendar fix and breaking auto-update (installed 1.8.8 users won't "update" to a lower 1.8.5).
  **Current live = 1.9.0** (calendar creds baked in + orb hotkey disable/clear + recording-pill X-button fix;
  releaseDate today). **RULE for all desktop agents — do NOT ad-hoc build+upload to that bucket.** To publish a
  mac build: (1) bump `apps/desktop/package.json` **ABOVE** the current live version — check
  `https://storage.googleapis.com/pyper-desktop-downloads/latest-arm64-mac.yml`; (2) bake calendar creds into
  `apps/desktop/.env` by copying `GOOGLE_CALENDAR_CLIENT_ID`/`_SECRET` from the **parent repo's** `apps/desktop/.env`
  (CI injects them from GH secrets, manual builds don't — else calendar breaks on fresh downloads); (3) sign with
  the reused **`Pyper Local Signing`** cert (never ad-hoc/`identity=null` → "damaged" or TCC resets); (4) **coordinate
  here first.** I (**desktop-app-update-options**) am the **desktop deploy owner** for now — ping me before publishing.
- **🔄 Auto-update now feeds from the PUBLIC GCS bucket, not GitHub** (`dcb2918` + `f09b66e`). Root cause
  of the "failed to update" error on launch: `src/updater.js` fed off `github.com/prateekjain98/pyper`,
  which is **PRIVATE** → electron-updater's anonymous provider 404s the releases API every launch.
  Repointed `setFeedURL` to `https://storage.googleapis.com/pyper-desktop-downloads/` (generic provider;
  arch channel still picks `latest-arm64-mac.yml`). Also fixed `release.yml`: it never mirrored the
  `*-mac.zip` (Squirrel.Mac updates from the ZIP, not the DMG) → check passed but download 404'd; now the
  mac artifact + GCS mirror include `*-mac.zip` + `*.blockmap`. **Caveats:** the feed URL is compiled into
  the app, so already-installed builds keep hitting GitHub until users install a build carrying this fix;
  and the current bucket still lacks `Pyper-1.8.4-arm64-mac.zip` (backfill needs `gcloud auth login` or a
  fresh release run — I couldn't upload, gcloud won't auth non-interactively here).
- **✅ main's desktop test suite is GREEN again — the 4 red tests are FIXED & pushed** (full suite 1804
  pass / 0 fail). Still: **the pre-push hook historically gated `npm run typecheck` only, NOT `npm test`** —
  run `npm test -w @pyper/desktop` yourself before assuming green. What was fixed:
  1. `ReasoningService … org policy` + `managed enterprise access …` (`ReferenceError: module is not
     defined`) → `de4e912`: the renderer test harness (`test/lib/rendererTestHarness.js`) ran Vite with
     `configFile:false`, so a bare `../config/brand` resolved to CommonJS `brand.js` and the SSR runner
     served it as ESM. Added `.ts`-first `resolve.extensions` so it picks the ESM `brand.ts` (matches the
     real build; complements `02521a5` which fixed the renderer-crash side). **If you add a `.js` with a
     `.ts` sibling under `src/`, the harness now prefers the `.ts`.**
  2. `preload BYOK_KEY_BRIDGES mirror the manifest` (**was a real runtime gap**) → `422f3fe`: added the
     `{base:"pyai",get:"getPyaiKey",save:"savePyaiKey"}` bridge to `preload.js`. **When you add a provider
     to `BYOK_API_KEYS` in `src/config/secretKeys.js`, also add the tuple to `preload.js` — it can't require
     the manifest under sandbox.**
  3. `handles STT splitting or misspelling the name` → `c7c9034`: dropped the stale OpenWhispr-era
     assertion (`"open whisper"` matching `"Pyper"`); now uses Pyper-appropriate split/misheard examples.
- **The desktop app already has a complete in-app updater** (`src/updater.js` + `useUpdater.ts` + Settings
  "Software Updates" + now an always-on dashboard button). Don't rebuild it — wired to GitHub releases,
  disabled in dev.
- **Partial/stale `npm install` breaks the verify gate**: phantom `@types/react` duplicate-identity
  typecheck errors in `ui/*.tsx`, and `Cannot find module 'thinking-orbs'` after merging that integration.
  Fix = full Node-24 `npm install` (re-run it after any merge that adds a dep). Sandbox npm cache can be
  broken → add `--cache <local dir>`. (NB: `module is not defined` in `brand.js` is a *separate* real bug —
  see test failure #1 above — NOT an install symptom.)
