---
agent: wispr-flow-formatting-c5d67c
branch: claude/wispr-flow-formatting-c5d67c
status: working
updated: 2026-08-13T21:26:53Z
auto: true
---

## Now
Last commit: worklog: auto (wispr-flow-formatting-c5d67c)

## Uncommitted changes
-  M services/pyai-proxy/server.js

## Fixes & gotchas (others should apply)
- **✅ SHIPPED — dictation cleanup now structures lists into bullets & messages into laid-out emails (Wispr Flow parity).** The old `FORMATTING` rule in the cleanup system prompt was too timid ("only when it clearly improves readability. Never over-format") so the app returned a flat wall of text. Rewrote it to format generously when the content is genuinely a list or a message (enumerated items → `- ` bullets, dictated messages → greeting/body/sign-off with embedded bullets, distinct topics → paragraphs), while single thoughts stay plain prose. Added a list example + an email example to the prompt.
- **⚠ THREE mirrored copies of the cleanup prompt must stay byte-identical** (a convention, not enforced by a test): `apps/desktop/src/locales/en/prompts.json` (`cleanupPrompt`), `services/pyai-proxy/server.js` (`CLEANUP_SYSTEM_PROMPT`), `apps/web/app/api/cleanup/route.ts` (`SYSTEM_PROMPT`). If you touch one, touch all three. The two server copies hardcode `Assistant` where the desktop JSON has `{{agentName}}`.
- **⚠ The desktop `en/cleanupPrompt` is hash-gated.** Changing it fails `test/helpers/retiredPrompts.test.js` (ratchet) until you move the old hash into `RETIRED_DEFAULT_PROMPT_HASHES` and record the new one in `CURRENT_DEFAULT_PROMPT_HASHES` (`src/config/retiredPrompts.js`). SHA-256 is over the decoded JSON string (real newlines).
- **✅ CLOUD-MODE fix is LIVE — pyai-proxy redeployed (revision `pyai-proxy-00012-gh7`, us-central1, 100% traffic).** Why a redeploy was needed: the zero-config **pyper cloud** default sends `promptMode:"cleanup"` with no system prompt, so the Cloud Run service applies its OWN `CLEANUP_SYSTEM_PROMPT` — the source change doesn't take effect until redeployed (`gcloud run deploy pyai-proxy --source <ABSOLUTE path>/services/pyai-proxy --region us-central1 --project pyper-services`). Verified live: list/email dictations now return bullets/email layout; short sentences stay prose. Desktop BYOK/local/enterprise/self-hosted modes got the fix from main immediately (prompt bundled/resolved client-side).
- **✅ DONE — all 9 non-English locales now have the generous FORMATTING instruction too** (`{de,es,fr,it,ja,pt,ru,zh-CN,zh-TW}/prompts.json`). Note these prompts are an OLDER generation than `en` (no `<transcript>` framing, no EXAMPLES block; Latin locales are accent-stripped) — I only flipped their "smart formatting / only when it improves readability" section to the generous version in-language, matching each file's existing style. All 9 hashes re-ratcheted in `retiredPrompts.js`.
- **✅ NEW — fixed "Hindi dictation comes out as Urdu" on the default cloud path.** Hindi was already a selectable language; the bug was that the cloud transcription path never forwarded the selected language. `audioManager.js` sets `opts.language`, but the `cloud-transcribe` IPC handler (`ipcHandlers.js`) dropped it AND the proxy `/transcribe` didn't accept one → always auto-detect → Hindi mis-detected as Urdu. Fix (two-sided): `ipcHandlers.js` now appends `?language=<code>` to the proxy call, and `server.js` `/transcribe` reads it and forwards `language` to the STT engine (skips "auto"/unset). Helps every language on the default cloud path, not just Hindi. **Proxy redeployed** so this + the cloud formatting fix are live.
- **Fresh worktree gotcha (confirmed again): `@tailwindcss/postcss` missing → `npm run build -w @pyper/web` fails on `app/globals.css`, and web `tsc` errors TS2882 on the same file.** Fix = full `npm install` on Node 24 from the worktree root (lockfile stays unchanged); then web build + typecheck go green. `next lint` still hits the interactive "configure ESLint" prompt (no eslint config in apps/web) — pre-existing, fleet-wide.
