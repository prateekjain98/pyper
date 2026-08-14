---
agent: llm-provider-waterfall-ace999
branch: claude/llm-provider-waterfall-ace999
status: working
updated: 2026-08-14T10:08:13Z
auto: true
---

## Now
Last commit: Merge remote-tracking branch 'origin/main' into claude/llm-provider-waterfall-ace999

## Uncommitted changes
- (clean)

## Fixes & gotchas (others should apply)
- **Cleanup is now a WATERFALL, not a single provider.** `services/pyai-proxy/server.js` and `apps/web/lib/engines.ts` take an ordered `CLEANUP_PROVIDERS` chain (default `ollama,anthropic,openai`). `/cleanup` tries each usable link and falls through on ANY failure (out of credits / 429 / 5xx / unreachable). Unconfigured links (no base URL / key) are skipped. PyAI is voice-only and is never in the cleanup chain. Legacy single `CLEANUP_PROVIDER` still works (1-link chain, honors `CLEANUP_MODEL`).
- **PROD PROXY ACTIVATION IS AN ENV/OPS STEP (needs the real keys).** The deployed Cloud Run proxy currently has `CLEANUP_PROVIDER=groq` (legacy single) → chain is `["groq"]` with no fallback, and Groq hit its daily token cap → live cleanup was returning `CLEANUP_WATERFALL_EXHAUSTED`. Fix: set `CLEANUP_PROVIDERS` + mount keys, then redeploy. Immediate no-new-keys fix: `CLEANUP_PROVIDERS=groq,openai` (OPENAI_API_KEY already mounted for realtime). Full chain: `CLEANUP_PROVIDERS=ollama,anthropic,openai` + `OLLAMA_BASE_URL` (+ optional `OLLAMA_API_KEY`) + `ANTHROPIC_API_KEY`.
- **Redeploying the proxy?** `git merge origin/main` first — the proxy holds a LANGUAGE rule in `CLEANUP_SYSTEM_PROMPT` from the multilingual-detection agent (38165b3). Deploy with an ABSOLUTE `--source` path (relative `--source services/pyai-proxy` fails "could not find source").
- **Anthropic in the chain uses its OpenAI-compat endpoint** (`https://api.anthropic.com/v1/chat/completions`, Bearer key) — so it drops into the OpenAI-compatible switch with no special client.
- **/status now reports the whole chain per-STAGE.** Payload gained a `cleanup` summary (`chain`, `activeProvider`, `preferredProvider`, `onFallback`, `healthy`) and each cleanup service carries `role/tier/active`. A rate-limited provider covered by a healthy fallback rolls up to `degraded` (serving), NOT `major_outage`. The status board renders a "Cleanup waterfall" strip.
- **Desktop BYOK cleanup now falls over to Pyper Cloud** (`audioManager._cleanupByokWithCloudFallback`) on rate-limit/out-of-credits/5xx — but ONLY for cloud providers; local/self-hosted/enterprise never leave the machine. Decision logic is pure + unit-tested in `src/helpers/cleanupFallbackPolicy.js`.
- **Renderer-imported helpers must be ESM.** A `module.exports` (CJS) helper statically imported by an ESM renderer file (e.g. audioManager.js) crashes the `node --import tsx --test` harness with `module is not defined` (it evaluates via Vite's SSR runner). Use `export`.
