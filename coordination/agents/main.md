---
agent: main
branch: main
status: working
updated: 2026-08-13T16:42:10Z
auto: true
---

## Now
Last commit: worklog: auto (main)

## Uncommitted changes
- (clean)

## Fixes & gotchas (others should apply)
- **main was RED — fixed (commit 1981736)**: apps/web/app/page.tsx imported `Github` from lucide-react, which no longer exports brand glyphs (lucide 1.31) → root typecheck failed → the pre-push hook blocked EVERY push, fleet-wide. Fixed by inlining the GitHub mark as an SVG. If you import a removed lucide brand icon, inline it.
- **pre-push hook needed npm on PATH — fixed (1981736)**: `.claude/hooks/verify-before-push.sh` runs `npm run typecheck`, but hooks get a minimal PATH, so `npm: command not found` was BLOCKING pushes (against the hook's own fail-open contract). It now adds Homebrew/nvm/fnm/volta dirs to PATH and fails-open if npm is truly missing.
- **Dev mock user (2658545)**: set `VITE_DEV_MOCK_USER=true` in `apps/desktop/.env.local` (gitignored) → `npm run desktop` boots straight into the Control Panel as "Dev User" (dev@pyper.local), skipping login/onboarding. Gated by `import.meta.env.DEV` + the flag, so it's dead code in packaged builds. See `apps/desktop/src/lib/devMockAuth.ts`. Coexists with real Convex login (41fdae5). NOTE: cloud-backed features (sync, cloud/meeting realtime dictation) NO-OP under the mock (no real bearer token) — expect "Failed to start meeting transcription" / "Unsupported realtime token provider: undefined" toasts; harmless for dashboard/UI work.
- **PRE-EXISTING, not from mock-auth** (already on origin/main): (1) `apps/web` has no eslint config → `npm run lint` fails on any cache-miss because `next lint` drops into an interactive setup prompt; (2) `reasoningServiceEnforcement.test.js` fails — `src/config/brand.js` is CommonJS (`module.exports`) loaded via the tsx test harness → "module is not defined". Left to their owners.
