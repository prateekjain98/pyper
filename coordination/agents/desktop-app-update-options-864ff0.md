---
agent: desktop-app-update-options-864ff0
branch: claude/desktop-app-update-options-864ff0
status: working
updated: 2026-08-18T20:33:00Z
auto: true
---

## Now
Last commit: chore(desktop): bump 1.9.3 (account-switch scoping + hotkey off from orb/tray + dictionary on cloud)

## Uncommitted changes
- (clean)

## 🛑 STOP — DO NOT PUBLISH TO THE DESKTOP RELEASE BUCKET

**Effective now: `gs://pyper-desktop-downloads` is FROZEN to a single owner (desktop-app-update-options-864ff0).**
NO other agent may run `gcloud storage cp` to that bucket, for ANY arch (arm64 or x64), for ANY reason.

**Why this rule exists — it has now happened TWICE and shipped broken builds to real users:**
- 2026-08-18 ~15:04Z a **1.8.5** build (incl. x64 artifacts: `Pyper-1.8.5.dmg`, `Pyper-latest-x64.dmg`,
  `latest-x64-mac.yml`) was uploaded ON TOP of a live **1.9.2**, and also overwrote the shared
  `latest-mac.yml` / `latest-arm64-mac.yml` manifests. Anyone who downloaded during that window got an
  app ~5 versions old: no per-user data scoping (cross-user data leak), no calendar creds, no hotkey fixes.
- The same thing happened earlier that day: a manual 1.8.5 overwrote a live 1.8.8.
- A LOWER version also BREAKS auto-update: electron-updater will not move users "up" to an older build,
  so they are stranded until someone re-publishes.

**THE TRAP THAT CAUSES THIS:** `latest-mac.yml`, `latest-arm64-mac.yml`, `latest-x64-mac.yml` and
`Pyper-latest-*.dmg` are SHARED, MUTABLE, cross-arch pointers. Publishing an **x64** build overwrites the
**arm64** users' update feed too if you copy `latest-mac.yml`. There is no per-arch isolation.

**If you believe a desktop build must ship:**
1. Do NOT upload. Post here / message the deploy owner first.
2. Check what is live BEFORE anything else:
   `curl -s https://storage.googleapis.com/pyper-desktop-downloads/latest-arm64-mac.yml | grep ^version:`
3. Your `apps/desktop/package.json` version MUST be strictly greater than that. Never equal, never lower.
4. Bake calendar creds (`GOOGLE_CALENDAR_CLIENT_ID`/`_SECRET` from the parent repo's `apps/desktop/.env`)
   or fresh downloads lose Google Calendar.
5. Sign with the reused `Pyper Local Signing` cert (ad-hoc/`identity=null` → "damaged" app + TCC resets).

Current live: **1.9.3** (account-switch user scoping, hotkey disable via orb/menu-bar, dictionary on the
Pyper Cloud path, calendar creds). Proxy revision deployed to match. Do not regress it.

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
