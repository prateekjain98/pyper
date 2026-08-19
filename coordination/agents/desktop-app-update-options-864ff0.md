---
agent: desktop-app-update-options-864ff0
branch: claude/desktop-app-update-options-864ff0
status: working
updated: 2026-08-19T07:38:01Z
auto: true
---

## Now
Last commit: worklog: auto (desktop-app-update-options-864ff0)

## Uncommitted changes
- (clean)

## Fixes & gotchas (others should apply)
- **🛑 STOP — THE DESKTOP RELEASE BUCKET IS FROZEN TO ONE OWNER. DO NOT PUBLISH.**
  `gs://pyper-desktop-downloads` (served by pyper.work). **No agent other than desktop-app-update-options-864ff0
  may run `gcloud storage cp` to that bucket — any arch (arm64 OR x64), any reason.** This has now shipped
  broken builds to real users TWICE in one day:
  - 2026-08-18 ~15:04Z a **1.8.5** build (x64 batch: `Pyper-1.8.5.dmg`, `Pyper-latest-x64.dmg`,
    `latest-x64-mac.yml`) was uploaded ON TOP of a live **1.9.2** and overwrote the shared
    `latest-mac.yml` / `latest-arm64-mac.yml`. Anyone downloading in that window got a build ~5 versions old:
    no per-user data scoping (**cross-user data leak**), no calendar creds, no hotkey fixes.
  - Earlier the same day a manual 1.8.5 overwrote a live 1.8.8.
  **THE TRAP:** `latest-mac.yml`, `latest-arm64-mac.yml`, `latest-x64-mac.yml`, `Pyper-latest-*.dmg` are
  SHARED, MUTABLE, CROSS-ARCH pointers with NO isolation — publishing an **x64** build overwrites **arm64**
  users' update feed. A LOWER version also breaks auto-update permanently: electron-updater never moves users
  backwards, so they are stranded until someone re-publishes.
  **If you think a build must ship:** (1) do NOT upload — ping the deploy owner first; (2) check live FIRST:
  `curl -s https://storage.googleapis.com/pyper-desktop-downloads/latest-arm64-mac.yml | grep ^version:`;
  (3) your `apps/desktop/package.json` version MUST be strictly greater — never equal, never lower;
  (4) bake calendar creds (`GOOGLE_CALENDAR_CLIENT_ID`/`_SECRET` from the **parent repo's** `apps/desktop/.env`)
  or fresh downloads lose Google Calendar; (5) sign with the reused **`Pyper Local Signing`** cert
  (ad-hoc / `identity=null` → "damaged" app + TCC permission resets).
  **Current live = 1.9.3** (per-user data scoping on account switch, hotkey disable from orb + macOS menu bar,
  custom dictionary on the Pyper Cloud path, calendar creds) + matching pyai-proxy revision. Do not regress it.
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
