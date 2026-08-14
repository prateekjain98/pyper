---
agent: failure-investigation-264780
branch: claude/failure-investigation-264780
status: working
updated: 2026-08-14T13:05:55Z
auto: true
---

## Now
Last commit: worklog: auto (failure-investigation-264780)

## Uncommitted changes
- (clean)

## Fixes & gotchas (others should apply)
- **✅ SHIPPED — /status no longer false-reds "Transcription · openai" as Unreachable/"probe timed out".** Root cause: the STT reachability probe `probeModels()` does `GET {base}/models` bounded by 8000ms `PROBE_TIMEOUT_MS`, and OpenAI's `/models` endpoint INTERMITTENTLY hangs >8s (reproduced: 1/3 attempts stall >12s while others 401 in ~0.35s; Groq/PyAI /models + OpenAI /chat/completions stay fast). One 8s timeout painted a healthy fallback provider red. gcloud logs confirmed 3 `/status` reqs at ~9.5s in 24h (the timeout events); live probe was operational between them. Fix (`services/pyai-proxy/server.js`, on main): `probeWithRetry(once)` retries ONCE, only on a transient `status:"unreachable"` (the timeout/network catch path), with a short 3000ms window; first attempt keeps 8000ms. HTTP verdicts (401/402/404/429/5xx) are real signals and are NEVER retried. `probeChat`/`probeModels` now wrap `probeChatOnce`/`probeModelsOnce(…, timeoutMs)`. Tunables: `STATUS_PROBE_RETRIES` (1), `STATUS_PROBE_RETRY_TIMEOUT_MS` (3000). Worst-case hung probe = 8+3 = 11s, under the web route's 15s `TIMEOUT_MS`.
- **✅ pyai-proxy REDEPLOYED — revision `pyai-proxy-00029-8nk` (us-central1, 100% traffic); rollback ref `pyai-proxy-00028-d7n`.** Verified live: openai transcription operational across 5 forced probes (~450–540ms); all 6 services operational; secrets/env preserved. NOTE: hammering `/status?force=1` bypasses the 60s cache and fires real chat probes → can momentarily trip a cleanup provider's 429 → `degraded` (covered by the waterfall, self-clears). Not a real outage; don't force-probe in a tight loop.
- **Cloud Run redeploy reminder (reconfirmed):** use an ABSOLUTE `--source` path (`gcloud run deploy pyai-proxy --source <abs>/services/pyai-proxy --region us-central1 --project pyper-services`); a source deploy with no `--set-env-vars`/`--set-secrets` PRESERVES existing env + Secret Manager mounts.
