# Realtime Dictation Architecture — replicating the Wispr Flow pipeline

**Status:** design / proposal · **Owner:** dictation-cloud · **Last updated:** 2026-08-13

> Companion docs: [`wispr-flow-pipeline.md`](./wispr-flow-pipeline.md) (how Wispr works) and
> [`asr-streaming-options.md`](./asr-streaming-options.md) (the streaming-ASR engine decision).

---

## TL;DR

- **We are ~80% there already.** The desktop app inherited a complete streaming dictation
  **client** from OpenWhispr: it captures 16 kHz PCM in an AudioWorklet, streams it live over a
  WebSocket, handles interim/final transcripts, commits on key-release, and falls back to batch.
  This is *exactly* Wispr's client shape.
- **Wispr's model, confirmed by research:** stream audio to the cloud *while you speak* (recognition
  overlaps speech), show only a **waveform** (no live text), then on key-release run **one LLM
  formatting pass** and inject the finished text as a single block. Streaming is what makes their
  sub-700 ms p99 possible — it takes ASR off the post-stop critical path.
- **The two gaps** are both backend/wiring, not client rewrites:
  1. **No streaming ASR endpoint on our cloud.** The deployed GCP proxy is **batch-only** (PyAI
     `pyai-hear`). We must give the streaming client something to stream *to*.
  2. **The formatting pass isn't wired to the cloud.** The proxy already exposes `POST /cleanup`
     (provider-switchable: OpenAI `gpt-4o-mini` **or** Groq `llama-3.3-70b-versatile`), but the
     desktop still calls the undeployed `/api/reason` and fails soft to raw text.
- **All backend work is in-repo.** The proxy is `services/pyai-proxy/server.js` — a tiny
  dependency-free Node/Cloud Run service. A streaming token-minter is a ~30-line addition.

---

## Current state (verified in code + against the live services)

| Piece | State | Evidence |
|-------|-------|----------|
| Streaming **client** (capture → WS → partial/final → commit) | ✅ exists | `audioManager.js` `STREAMING_PROVIDERS`, `startStreamingRecording`, `pcm-streaming-processor` worklet |
| Streaming providers wired | ✅ openai-realtime, deepgram, assemblyai, corti, tinfoil | `audioManager.js:266` |
| Warm-connection pre-open (latency) | ✅ exists | `warmupStreamingConnection` (`audioManager.js:3603`) |
| Realtime **token provider** bug | ✅ **fixed & pushed** (`036848e`) | stamped `provider:"openai-realtime"` on start/warmup |
| Realtime → batch **fallback** on `NO_API` | ✅ works (after the fix) | `startStreamingRecording` `res.code === "NO_API"` → `needsFallback` |
| Batch STT via **GCP proxy** | ✅ shipped (`8e8e52d`) | `cloud-transcribe` → `proxyFetch(pyai-proxy/transcribe)`, WAV, no sign-in |
| Proxy source | ✅ **in this repo** | `services/pyai-proxy/server.js` (Cloud Run, keys in Secret Manager) |
| Formatting `/cleanup` on proxy | ✅ exists, provider-switchable | `CLEANUP_PROVIDER` = `openai` (gpt-4o-mini) \| `groq` (llama-3.3-70b) |
| Desktop → proxy `/cleanup` wiring | ❌ **TODO** | `cloud-transcribe` `TODO(cloud-cleanup)`; `cloudReason` still targets `/api/reason` (fails soft → raw text) |
| Streaming ASR on our cloud | ❌ **absent** | PyAI is batch-only: `/audio/transcriptions`, `/v1/*`, all `/realtime*` → 404 |

**Net:** dictation *works today* in batch on GCP (raw text). To match Wispr we add (1) a streaming
ASR path and (2) the `/cleanup` wiring.

---

## Target pipeline (Wispr-replica) — mapped to what exists

| # | Step | Status |
|---|------|--------|
| 1 | Hotkey down → mic capture, **waveform only (no live text)** | ✅ capture · 🎚️ optional: hide the live preview |
| 2 | **Stream 16 kHz PCM chunks over WSS during speech** | ✅ worklet + streaming client |
| 3 | Streaming ASR returns interim+final, **buffered (not shown)** | ✅ partial/final handling |
| 4 | Hotkey up → **commit** → final transcript | ✅ `awaitsFinalTranscript` |
| 5 | **Format LLM pass** on full transcript + context → clean text | ❌ wire to proxy `/cleanup` |
| 6 | Inject formatted text as **one block** at cursor | ✅ `safePaste` |

---

## Architecture

```
┌──────────────────────── DESKTOP (Electron) — mostly built ────────────────────────┐
│  Mic ─► AudioWorklet(16 kHz PCM) ═══ stream during speech ═══►  Streaming STT client│
│                                                                  │ interim+final    │
│  hotkey up ─► commit ─► FINAL transcript ◄───────────────────────┘ (held, not shown)│
│        └─► POST transcript (+ tone/context) ─►[format]─► inject ONE block at cursor  │
└───────────════ (2) audio stream ════────────────────────────════ (5) format ══──────┘
                       │                                              │
                       ▼                                              ▼
   ┌─────────────────────────────────┐            ┌──────────────────────────────────┐
   │      STREAMING ASR (the fork)   │            │  services/pyai-proxy  POST /cleanup│
   │  A1 OpenAI Realtime  ◄ fastest  │            │  provider switch:                 │
   │  A2 self-hosted GPU (own model) │            │   openai → gpt-4o-mini            │
   │  A3 Deepgram / AssemblyAI       │            │   groq   → llama-3.3-70b ◄ Wispr- │
   └───────────────┬─────────────────┘            │            style formatting        │
                   │ needs a small backend         └──────────────────────────────────┘
                   ▼
   ┌─────────────────────────────────┐            GCP · Cloud Run · Secret Manager
   │ services/pyai-proxy (in-repo)   │            (holds PyAI / OpenAI / Groq keys)
   │  + POST /realtime-token   (NEW) │  A1: mint ephemeral key → client streams
   │    (or /transcribe-stream WS)   │      DIRECTLY to OpenAI realtime WSS
   └─────────────────────────────────┘
```

**Key property:** for A1/A3 the backend only **mints a short-lived token**; the audio never transits
our servers — the desktop streams straight to the ASR provider's WebSocket. For A2, we host the WS
ASR ourselves (GPU) and the client streams to it.

---

## What Pyper already has (the streaming client)

Inherited from OpenWhispr and already present in `apps/desktop`:

- **Capture:** `AudioWorkletProcessor("pcm-streaming-processor")` converts float samples to 16-bit
  PCM chunks and posts them to the main process → `provider.send(pcm)` over IPC → WebSocket.
- **Provider table:** `STREAMING_PROVIDERS` with `warmup / start / send / stop / onPartial / onFinal /
  onSessionEnd` for `openai-realtime`, `deepgram`, `assemblyai`, `corti`, `tinfoil-realtime`.
- **Commit-on-stop:** worklet flushes the tail, waits briefly for the WS to deliver the final, then
  finalizes (`awaitsFinalTranscript`).
- **Warm connection:** `warmupStreamingConnection` pre-opens the WS, pre-loads the worklet module,
  and warms the OS mic driver — the same latency trick Wispr uses.
- **Batch fallback:** a parallel path so a failed/absent WS degrades to record-then-transcribe.
- **Formatting stage:** `processTranscription` → `ReasoningService` already runs a **separate LLM
  cleanup pass** after transcription (filler removal, punctuation, tone), non-fatal on failure.

> This is why the effort is small: we are supplying a **backend** for a client that already speaks
> the streaming + format-on-stop protocol.

---

## What's required

### Backend (all in `services/pyai-proxy/`, deploy via `gcloud run deploy`)
1. **Streaming ASR access** — one of the three engines (see the fork below).
   - **A1 / A3:** add a token-minter route (`POST /realtime-token`) — ~30 lines; returns an ephemeral
     key; client streams directly to the provider WSS. Reuses the proxy's Secret Manager keys.
   - **A2:** a *new* GPU service (Cloud Run GPU / GKE) running a streaming ASR model + a WS provider
     client in the desktop. Heaviest.
2. **Formatting** — `POST /cleanup` already exists. Decide the default `CLEANUP_PROVIDER`
   (`groq`/`llama-3.3-70b` gives Wispr-style formatting at low latency; `openai`/`gpt-4o-mini` is the
   current default).

### Desktop (`apps/desktop`)
3. ✅ **Provider-stamp fix** — done (`036848e`).
4. 🔧 **Wire step 5**: point `cloudReason` (cleanupCloudMode `pyper`) at proxy `/cleanup` instead of
   the dead `/api/reason`. *Engine-independent — can land now.*
5. ⚙️ **Config**: set `VITE_PYPER_API_URL` (or a dedicated var) to the host that serves the
   token-minter, so the realtime token fetch resolves instead of falling back to batch.
6. 🎚️ **Optional UX parity**: suppress the live partial-text preview during dictation (Wispr shows a
   waveform only; we currently show text).
7. ✅ Keep batch-via-proxy as the offline / token-failure safety net.

### Latency (to approach Wispr's sub-second feel)
- Pre-open the WS on hotkey/focus — **already have it** (`warmupStreamingConnection`).
- Small, fast formatting model under a tight budget — **Groq `llama-3.3-70b`** (sub-200 ms TTFT,
  300+ tok/s) is already an option in the proxy.
- Stream during speech so only *final flush + format + network* remain at key-release.

---

## The fork: which streaming ASR engine?

Full detail + costs/latency/citations in [`asr-streaming-options.md`](./asr-streaming-options.md).
Summary:

| Option | What it is | Backend needed | Effort | "Ours"? | Best for |
|--------|------------|----------------|--------|---------|----------|
| **A1 OpenAI Realtime** | Stream to OpenAI's realtime WSS with an ephemeral key | `/realtime-token` (~30 LOC) | **Low** | No (per-min) | **Fastest** working Wispr-UX |
| **A2 Self-hosted GPU** | Our own streaming Whisper/Parakeet on GCP GPU | New GPU service + WS client | High | **Yes** | Long-term parity / privacy |
| **A3 Deepgram/AssemblyAI** | Stream to a managed ASR WSS with a temp key | token-minter (~30 LOC) | Low | No (per-min) | Fast + production-grade |

The desktop client is **identical** for all three; only the backend + one config value differ.

---

## Phased plan

- **P0 — Formatting on the cloud (no-regret, engine-independent).** Wire desktop `cloudReason` →
  proxy `/cleanup`. Outcome: dictation produces **formatted** text on GCP (batch today, streaming
  after P1). *Ready to start now.*
- **P1 — Streaming ASR.** Implement the chosen engine's token-minter in `services/pyai-proxy` (A1/A3)
  or stand up the GPU service (A2); point the desktop at it. Outcome: **true streaming dictation**,
  recognition overlapping speech.
- **P2 — UX + latency parity.** Waveform-only (hide live text), tune the formatting budget, verify
  warm-connection is engaged. Outcome: Wispr-feel.
- **P3 — Own the stack (optional).** Migrate ASR to a self-hosted model (A2) for cost/privacy/control,
  matching Wispr's Baseten approach. Same client, swapped backend.

---

## Open decisions (need your input)

1. **ASR engine** — A1 (fast) vs A2 (own the stack) vs A3 (managed). See the ASR doc.
2. **Formatting model default** — Groq/Llama (Wispr-style, fast) vs OpenAI/gpt-4o-mini (current).
3. **Live-text UX** — match Wispr exactly (waveform only) or keep our live preview as a differentiator.

---

## Appendix — lineage note (OpenWhispr)

Our fork parent uses the **same dual design**: `shouldUseStreaming()` forks per-recording — local
engines and self-hosted are always batch; a signed-in cloud user on a realtime-capable model
(`gpt-4o-mini-transcribe`) **streams via OpenAI Realtime brokered through the cloud**, with a separate
post-transcription cleanup LLM call. In other words, the streaming-then-format architecture proposed
here is the one this codebase was built around — we are re-pointing it at our own GCP backend.
