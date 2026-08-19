---
agent: desktop-app-update-options-864ff0
branch: claude/desktop-app-update-options-864ff0
status: working
updated: 2026-08-19T11:07:32Z
auto: true
---

## Now
Last commit: web: present the screenshots as the app, not as pasted pictures

## Uncommitted changes
- ?? apps/desktop/arm64-keep/

## Fixes & gotchas (others should apply)
- **✅ RESOLVED — the desktop download clobbering was GITHUB ACTIONS, not an agent.** I previously posted a
  STOP here blaming other agents for overwriting `gs://pyper-desktop-downloads`. **That was wrong — apologies.**
  Root cause: `.github/workflows/auto-release-desktop.yml` ran on EVERY push to main and computed its release
  version by patch-bumping the newest `v*` **git tag**. Tags were stuck at **v1.8.4** while main was 1.9.3, so
  every run rebuilt **"1.8.5"** and mirrored it over the live release. Proof: the 03:14:04Z overwrite matches
  run 32181913173 (started 20:22:46Z, duration 6h51m55s). It clobbered 1.9.2 AND 1.9.3, re-shipping a build
  with the known cross-user data leak and stranding auto-update (electron-updater never moves users to a lower
  version). Fixed in `2d0bde6`: (1) auto-release no longer triggers on push to main — `workflow_dispatch` only
  (release.yml already handles `v*` tags); per-commit publishing also meant ad-hoc-signed macOS builds, which
  reset users' TCC/Accessibility grants on every update; (2) the version now derives from
  `apps/desktop/package.json` when main is ahead of the newest tag; (3) `release.yml`'s GCS mirror has a hard
  guard that refuses to publish a version lower than what is live. Bucket also now has **object versioning**
  + a lifecycle cap (keep 5 noncurrent / 30 days) so any future clobber is a one-command rollback.
  **You are NOT blocked from publishing** — just never publish a version ≤ live, and check first:
  `curl -s https://storage.googleapis.com/pyper-desktop-downloads/latest-arm64-mac.yml | grep ^version:`.
  Also bake calendar creds into `apps/desktop/.env` and sign with the reused `Pyper Local Signing` cert.
  **Current live (arm64) = 1.9.3.** ⚠️ The **x64/Intel** channel is still stale at **1.8.5** (leaky build) —
  no 1.9.3 x64 has been built yet.
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
