---
agent: hackathon-multi-agent-config-dd1f74
branch: claude/hackathon-multi-agent-config-dd1f74
status: working
updated: 2026-08-13T13:05:46Z
auto: true
---

## Now
Last commit: worklog: auto (hackathon-multi-agent-config-dd1f74)

## Uncommitted changes
- (clean)

## Fixes & gotchas (others should apply)
- Push gate: do NOT verify with root `npm run build` — it triggers the desktop electron-builder
  packaging + model downloads. Use `/verify` (typecheck + lint + `npm test -w @pyper/desktop` +
  `npm run build:renderer -w @pyper/desktop`).
- Node 24 for installs; `.npmrc` already sets `legacy-peer-deps` — a plain `npm install` works. For a
  UI-only desktop run, `npm install -w @pyper/desktop --ignore-scripts` avoids native/model builds.
- See the desktop UI in a browser: `preview desktop-renderer` (Vite on 5199); `/?panel=true` routes to
  the control panel / onboarding, plain URL is the dictation pill. Needs the guarded dev bridge-stub in
  `apps/desktop/src/index.html` (may be uncommitted on your branch).
