---
agent: dictation-whisper-flow-format-001115
branch: claude/dictation-whisper-flow-format-001115
status: working
updated: 2026-08-13T22:23:38Z
auto: true
---

## Now
Last commit: worklog: dictation to-do bullet fix + proxy redeploy

## Uncommitted changes
- (clean)

## Fixes & gotchas (others should apply)
- **✅ SHIPPED — cleanup now bullets to-do lists dictated as NARRATIVE sentences (extends the earlier generous-formatting work).** The Lists rule + examples only covered clean comma-lists ("the top three features are X, Y, Z"), so a to-do list spoken as prose ("I need to wake up at 7 and then prep for the hackathon, plus do my routine. I also need to go to the gym.") came out as a wall of text. Strengthened the Lists rule (connectives: and then / plus / also / next / I need to; items across several sentences; lead-in above, wrap-up below) and added a worked to-do example. Updated all THREE mirrored copies byte-identically (desktop en/prompts.json, pyai-proxy server.js, web /api/cleanup route.ts) and ratcheted retiredPrompts.js (old en hash retired, new recorded). On main.
- **✅ pyai-proxy REDEPLOYED — revision `pyai-proxy-00017-grq` (us-central1, 100% traffic), rollback ref was `pyai-proxy-00015-kcz`.** Needed because the zero-config pyper-cloud default uses the proxy's OWN CLEANUP_SYSTEM_PROMPT. Verified live: POST /cleanup with the user's exact text returns a proper bulleted list; plain prose stays prose. Cloud cleanup model is groq `llama-3.3-70b-versatile` (chosen for latency) — follows the prompt well on clearly-framed lists.
