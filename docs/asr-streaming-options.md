# Streaming ASR Engine Options for Pyper

**Decision doc — choosing a low-latency streaming speech-to-text engine for live dictation.**

**Status:** Draft for team review · **Date:** 2026-08-13 · **Audience:** Pyper desktop + backend engineers

> **Confidence tags** used throughout:
> **[src]** = confirmed from a cited web source · **[code]** = confirmed from this repo ·
> **[inf]** = inferred / our own arithmetic or judgement (not a vendor claim).
> Unit prices and latency numbers are **[src]**; monthly-cost and break-even figures are **[inf]** built on those unit prices.

---

## 1. Executive summary

Pyper needs **streaming** ASR (partial words appearing as you speak) to match Wispr Flow's dictation UX. We evaluate three paths:

- **A1 — OpenAI Realtime API** (client streams directly to OpenAI over WSS; we mint an ephemeral token).
- **A2 — Self-host streaming ASR on GCP** (own the stack: Whisper/Parakeet over WebSockets on Cloud Run or GKE GPUs — the same shape as Wispr's own Baseten deployment).
- **A3 — Managed streaming ASR** (Deepgram, AssemblyAI — client streams directly; we mint a temporary token).

**The single most important fact for this decision:** the desktop app **already ships working WebSocket streaming clients** for `openai-realtime`, `deepgram`, `assemblyai`, `corti`, and `tinfoil`. It captures 16 kHz Int16 PCM in an AudioWorklet, streams chunks live, renders partial/final results, and commits on stop. **[code]** So for A1 and A3, "integration effort" is **almost entirely backend**: a tiny **token-minting endpoint**. The client work is done.

The **only** GCP backend deployed today is a **batch-only** proxy: `POST /transcribe` (our `pyai-hear` model) and `POST /cleanup` (gpt-4o-mini). **It has no streaming/realtime endpoint.** **[code]** Nothing we have today streams.

**Recommendation in one line:**

- **Hackathon / fastest path to a Wispr-like UX:** ship **A1 (OpenAI Realtime)** — add one `POST /realtime/client_secrets` proxy (~30 lines) and flip the client to the existing `openai-realtime` provider. If we want the lowest possible latency instead, **A3 / AssemblyAI or Deepgram** is the same amount of backend work. **[inf]**
- **Long-term own-the-stack:** stand up **A2** — a `faster-whisper` or **sherpa-onnx Parakeet-streaming** WebSocket service on a **GKE L4/A100 GPU node pool** (Cloud Run GPU is viable but its scale-to-zero cold starts fight low latency). This is where our own `pyai-hear` model and privacy story live, and where per-user cost goes to ~zero at scale. **[inf]**

---

## 2. Background: how streaming dictation ASR works

Batch ASR (what our `/transcribe` proxy does today) waits for the whole recording, then transcribes. **Streaming** ASR emits text *while you talk*. The engine must decide **when a word is "final"** vs still a revisable **partial/interim** hypothesis. Two common designs:

- **Fixed-chunk + local agreement.** Feed the model overlapping N-second windows; a word is *committed* only once consecutive decodes agree on it. UFAL's `whisper_streaming` uses **LocalAgreement-2**: "confirm a transcript prefix if 2 consecutive updates … agree on that prefix." With a 1.0 s chunk this yields an average final-emission latency of ~2.0 s (≈ twice the chunk size). **[src]** This is how you bolt streaming onto a fundamentally non-streaming model like Whisper.
- **Natively streaming transducers (RNN-T / FastConformer).** Models like NVIDIA Parakeet emit tokens frame-by-frame with a small right context, so partials appear in tens of milliseconds and don't need the agreement trick. sherpa-onnx runs these "online" models over a WebSocket with built-in **endpointing** (detecting utterance end). **[src]**
- **Server VAD / endpointing.** A voice-activity detector marks speech start/stop so the engine knows when to *commit* a turn. OpenAI Realtime exposes `server_vad`; Deepgram exposes `endpointing=<ms>`; our client already configures these. **[code]/[src]**

Pyper's client speaks all of this already: partial deltas update the overlay live, a final/committed event appends the turn, and stop triggers a commit. **[code]**

---

## 3. A1 — OpenAI Realtime API (streaming transcription)

### 3.1 How the protocol works

- **Transport:** one WebSocket to **`wss://api.openai.com/v1/realtime?intent=transcription`**. **[code]/[src]**
- **Auth options:**
  1. **Standard API key** in the `Authorization: Bearer` header — fine for our Electron main process (BYOK), which is exactly what the client does today. **[code]**
  2. **Ephemeral client secret** for untrusted clients: `POST /v1/realtime/client_secrets` with a standard key returns `{ "value": "ek_…", "expires_at": …, "session": {…} }`. TTL is set via `expires_after.seconds`, range **10–7200 s (default 600 s / 10 min)**. **[src]**
- **Session config** is sent as a `session.update` event (or embedded in the ephemeral token — see below):
  ```json
  {
    "type": "session.update",
    "session": {
      "type": "transcription",
      "audio": { "input": {
        "format": { "type": "audio/pcm", "rate": 24000 },
        "transcription": { "model": "gpt-4o-mini-transcribe" },
        "turn_detection": { "type": "server_vad", "threshold": 0.6,
                            "silence_duration_ms": 600, "prefix_padding_ms": 500 }
      }}
    }
  }
  ```
  This is verbatim the shape our client already sends. **[code]**
- **Audio input:** base64 `input_audio_buffer.append` frames of **PCM16**. **OpenAI rejects PCM session rates below 24 kHz**, so our 16 kHz capture is **upsampled 16→24 kHz** client-side before sending. **[code]** (Deepgram/AssemblyAI take 16 kHz directly — OpenAI is the outlier here.)
- **Events:** partials arrive as `conversation.item.input_audio_transcription.delta` (`delta` field); a turn finalizes with `conversation.item.input_audio_transcription.completed` (`transcript` field). `input_audio_buffer.speech_started/stopped/committed` bracket server-VAD turns. **[code]/[src]**
- **Preconfigured sessions:** session config (model, VAD, language, noise reduction) **can be embedded in the ephemeral token**, so the client connects with the session already set up and must *not* re-send `session.update` (doing so would strip language/noise-reduction). The client already has this exact `preconfigured` branch. **[src]/[code]**
- **Session cap:** Realtime sessions die at **60 minutes**; the client proactively reconnects at ~55 min. **[code]** Irrelevant for dictation bursts, relevant for meeting mode.

### 3.2 Models

`gpt-4o-transcribe`, `gpt-4o-mini-transcribe` (our default), and `whisper-1`; plus newer snapshots surfaced in the docs — `gpt-live-transcribe` ("returns transcript deltas as speech arrives"), `gpt-transcribe`, `gpt-realtime-whisper` (labelled "Very fast"), and `gpt-4o-transcribe-diarize` (speaker labels). Live sessions expose a **`delay` knob** (`minimal → low → medium → high → xhigh`) trading latency for WER. **[src]**

### 3.3 Latency

No official single-number SLA. Qualitatively: partials stream "as speech arrives"; the `gpt-4o-transcribe` model page labels speed **"Medium"** while `gpt-realtime-whisper` is **"Very fast."** Real-world reports put `gpt-4o-transcribe` on the slower side of the realtime pack, tunable via `delay`. **[src]** Practically: **good enough for dictation, not the fastest option** (Deepgram/AssemblyAI are faster — see A3). **[inf]**

### 3.4 Cost

Billed per audio token; effective per-minute rates: **`gpt-4o-transcribe` ≈ $0.006/min** ($2.50 /M input audio tokens, $10 /M output text) and **`gpt-4o-mini-transcribe` ≈ $0.003/min** ($1.25 /M, $5 /M). **[src]** At a heavy-dictation assumption of **15 h audio/user/month**: **~$2.70 (mini) / ~$5.40 (full) per user/month.** **[inf]**

### 3.5 GCP backend needed

**Just a token minter.** One authenticated route on our existing Cloud Run/Convex backend that calls `POST /v1/realtime/client_secrets` with the server-held OpenAI key and returns the `ek_…` to the desktop app; the client then streams **directly** to OpenAI. No audio passes through our infra. **[src]/[inf]** (For pure BYOK we don't even need that — the client uses the user's own key directly. **[code]**)

### 3.6 Accuracy & languages

Top-tier. `gpt-4o-transcribe` sits within **1–2 points of the best** on LibriSpeech/FLEURS; the Dec-2025 `gpt-4o-mini-transcribe` snapshot lowered WER further and cut hallucinations ~90% vs Whisper v2. Strong multilingual (Whisper's ~90+ language lineage; notably strong Mandarin/Hindi/Bengali/Japanese/Italian). **[src]**

### 3.7 Privacy / data handling

API data is **not used for training by default**. Default retention is **up to 30 days for abuse monitoring**; **Zero Data Retention (ZDR)** is available for eligible endpoints/enterprise accounts. **[src]** Note: ZDR on Realtime is an **enterprise agreement**, not a per-request flag — for a privacy-first product this is the main asterisk on A1. Audio would leave the user's machine for OpenAI's servers. **[src]/[inf]**

### 3.8 Integration effort

**Lowest.** Client is done. **[code]** Backend = one ~30-line token-proxy route (or zero for BYOK). Ship in an afternoon. **[inf]**

---

## 4. A2 — Self-hosted streaming ASR on GCP (own the stack)

This is the **Wispr-style** path: Wispr Flow runs its speech + Llama cleanup pipeline on **Baseten** end-to-end in **under 700 ms**. **[src]** We'd run the equivalent on GCP.

### 4.1 The realistic engines

| Engine | Model family | Streaming mechanism | Notes |
|---|---|---|---|
| **`whisper_streaming` (UFAL)** | Whisper (via faster-whisper) | Fixed-chunk + **LocalAgreement-2** | Reference impl; ~2.0 s emission latency at 1 s chunk; faster-whisper GPU backend recommended. **[src]** |
| **WhisperLive / WhisperLiveKit** | Whisper | LocalAgreement + FastAPI **WebSocket** server, buffering preview, multi-user | Turnkey self-host; browser/client connects over WS. **[src]** |
| **faster-whisper server** | Whisper (CTranslate2) | Chunked decode | The fast GPU inference core most of the above build on. **[src]** |
| **sherpa-onnx "online" server** | **Parakeet / Zipformer transducer (RNN-T)** | Natively streaming, frame-synchronous + **endpointing** | Lowest partial latency; no agreement trick needed. **We already bundle sherpa-onnx locally** for Parakeet. **[src]/[code]** |
| **Baseten-style Whisper-over-WebSockets** | Whisper V3 | Custom WS streaming impl | The exact pattern Wispr uses; Baseten also offers self-hosted/single-tenant deploys. **[src]** |

**Key architectural point:** we **already run sherpa-onnx Parakeet streaming *on-device*** for local dictation (`nemotron-speech-streaming`, `runtime: online`). **[code]** A2 is largely *"take that same online WebSocket server and run it on a GCP GPU instead of the user's laptop"* — high code reuse. **[inf]**

### 4.2 How streaming works here

- **Whisper-based** (whisper_streaming/WhisperLive): VAD-gated or fixed overlapping chunks, LocalAgreement-2 to commit prefixes. Latency floor ≈ chunk size × 2. **[src]**
- **Parakeet/transducer** (sherpa-onnx online): frame-synchronous partials in tens of ms, built-in endpointer emits finals at utterance end. **[src]** This is the better fit for dictation feel.

### 4.3 GCP deployment: Cloud Run GPU vs GKE

| | **Cloud Run (GPU)** | **GKE (GPU node pool)** |
|---|---|---|
| GPUs | **NVIDIA L4 only** (24 GB) **[src]** | T4, L4, A100 40/80 GB, etc. **[src]** |
| Price (on-demand, us-central1) | L4 ≈ **$0.67/hr** (no zonal redundancy) / ~$1.05/hr (with); **per-second billing**, scales to zero. **[src]** | T4 ≈ **$0.35/hr**, L4 ≈ **$0.70/hr**, A100 40 GB **$3.67/hr**, 80 GB **$5.07/hr**; **Spot −60–91%**. **[src]** |
| WebSockets | **Supported** (long-running HTTP); request timeout up to **60 min** (default 5). **[src]** | Fully supported; you own the ingress/timeouts. **[inf]** |
| Cold start | **The catch.** Full cold start (idle >10 min) ≈ **105–120 s** with model load; warm ≈ 6–7 s; hot ≈ 1.5 s. Scale-to-zero + a 105 s cold start = terrible first-dictation latency **unless `min-instances ≥ 1`** (which pays for an idle GPU 24/7). **[src]/[inf]** | You keep nodes warm by design (node pool always on); no scale-to-zero surprise, but you pay for the pool continuously. **[inf]** |
| Autoscaling | Automatic, per-request, to zero. **[src]** | HPA + cluster autoscaler; more control, more ops. **[inf]** |
| Long-lived WS viability | OK up to the 60-min cap; fine for dictation bursts, needs reconnect logic for long meetings. **[src]/[inf]** | Best for long-lived connections. **[inf]** |

**Verdict on infra:** for **bursty low-latency dictation**, Cloud Run GPU's scale-to-zero cold start (~2 min) is disqualifying unless you pin `min-instances ≥ 1` — at which point you're paying ~$490/mo for an always-on L4 anyway and **GKE gives more GPU choice for similar money.** **[inf]** Use **Cloud Run GPU** for a quick single-container demo; use **GKE (L4 or A100, optionally Spot)** for the real service. **[inf]**

### 4.4 Latency

Achievable **sub-second to ~1 s** with a transducer model on a warm L4/A100 (Wispr's whole pipeline is <700 ms on comparable infra). **[src]/[inf]** Whisper-based self-hosting lands slower (~1.5–2 s finals due to LocalAgreement). **[src]**

### 4.5 Cost model

**Fixed GPU cost, not per-minute.** One always-on L4 ≈ **$489/mo** (Cloud Run, 730 h × $0.67) or ~**$511/mo** (GKE L4) before vCPU/RAM; A100 far more but serves many more concurrent streams. **[inf, from src unit prices]** A single L4/A100 serves **many concurrent dictation streams** (dictation is bursty and low duty-cycle), so **per-user cost collapses toward zero at scale** — the opposite curve from per-minute APIs. **Break-even vs OpenAI-mini (~$2.70/user/mo): ~180 heavy users on one $489 L4.** **[inf]** Spot GPUs cut the fixed cost 60–91% if you tolerate ~30 s preemption notice. **[src]**

### 4.6 Accuracy & languages

Whisper large-v3 and Parakeet-tdt are **near cloud-parity**; Parakeet EN is state-of-the-art (our bundled `parakeet-unified-en` is 5.91% avg WER on Open ASR Leaderboard **[code]**). Multilingual Parakeet covers ~25 languages; Whisper ~90+. We control the model, so accuracy is a tuning choice, not a vendor lottery. **[inf]**

### 4.7 Privacy / data handling

**Best possible.** Audio never leaves infra we control; ZDR is the default because *we* are the data processor. This is the only path fully consistent with Pyper's "privacy-first" positioning for **cloud** dictation. **[inf]**

### 4.8 Integration effort

**Highest.** Client is done **[code]**, but we must build, containerize, GPU-deploy, autoscale, monitor, and keep-warm a stateful WebSocket ASR service — plus a token/session auth shim. Real ops burden (GPU quota, driver images, cold-start mitigation, cost monitoring). **Days-to-weeks, not hours.** **[inf]**

---

## 5. A3 — Managed streaming ASR (Deepgram, AssemblyAI)

Both are drop-in for us: **the client already has WebSocket implementations for both**, including AssemblyAI's temporary-token fetch. **[code]**

### 5.1 Deepgram

- **Protocol:** `wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&interim_results=true&…` (Nova-3). Interim results (`is_final:false`) then finalized (`is_final:true`); built-in VAD endpointing via `endpointing=<ms>` (e.g. 300) — no separate VAD round-trip. **[code]/[src]**
- **Latency:** first-word ≈ **60–80 ms**; end-to-end **200–300 ms** in good conditions. **Fastest of the cloud options.** **[src]**
- **Cost:** Nova-3 streaming ≈ **$0.0077/min PAYG** (~$0.46/hr), $0.0065/min on Growth. **[src]** → **~$6.93/user/mo** at 15 h audio. **[inf]**
- **Backend:** **Temporary JWT tokens, 30 s TTL**, `usage::write` scope, minted from a Member+ key — designed for exactly our client-side/low-latency case so we don't proxy audio. One minting route. **[src]**
- **Privacy:** SOC 2 Type II; HIPAA/BAA available. **Caveat:** hosted-API usage may default into the opt-in **Model Improvement Program** (persists audio); set **`mip_opt_out=true`** to store nothing (forfeits a 50% MIP discount). Regional endpoints (e.g. `api.au.`) exist. **[src]**
- **Accuracy/langs:** Nova-3 strong on accented/noisy speech; broad language support. **[src]**

### 5.2 AssemblyAI (Universal-Streaming)

- **Protocol:** single WebSocket `wss://streaming.assemblyai.com/v3/ws`, **16 kHz mono PCM**; **immutable transcripts** (emitted text is never rewritten) with word emission ~**300 ms**. **[code]/[src]**
- **Latency:** ~**300 ms** time-to-complete; AssemblyAI claims **41% faster median than Deepgram Nova-3**. **[src]**
- **Cost:** **$0.15/hr** base (Universal-Streaming); Universal-3.5 Pro Realtime $0.45/hr. **Critical billing nuance:** billed on **total WebSocket session duration — including idle time**, not audio sent. **[src]** If Pyper holds the socket open between utterances, we pay for silence. At 15 h *connected* time: **~$2.25/user/mo**; but a naive "keep socket warm all day" design could be far worse. **Bill by connecting only during capture.** **[inf]**
- **Backend:** temporary token endpoint **`GET /v3/token?expires_in_seconds=60`** — **already wired in our client** (`ipcHandlers.js`). **[code]/[src]** One minting route with the server key.
- **Privacy:** **Zero data retention for Streaming when opted out of model training** (some metadata kept for billing); HIPAA via BAA; strong "delete after processing" posture. **[src]**
- **Accuracy/langs:** tuned for voice-agent/dictation; multilingual Universal-Streaming available. **[src]**

---

## 6. Comparison table

| Dimension | **A1 OpenAI Realtime** | **A2 Self-host on GCP** | **A3a Deepgram** | **A3b AssemblyAI** |
|---|---|---|---|---|
| **Latency** | Partials live; "Medium" speed, tunable `delay` **[src]** | **<1 s** (Parakeet, warm) / ~2 s (Whisper) **[src/inf]** | **60–80 ms** first word, 200–300 ms e2e **[src]** | ~**300 ms** (immutable) **[src]** |
| **Unit cost** | $0.003/min (mini) · $0.006 (full) **[src]** | Fixed GPU: L4 ~$0.67–0.70/hr; Spot −60–91% **[src]** | $0.0077/min (~$0.46/hr) **[src]** | $0.15/hr session (idle billed!) **[src]** |
| **Cost @15 h/user/mo** | ~$2.70 / $5.40 **[inf]** | ~$0 marginal; ~$489/mo per L4 fixed; break-even ~180 users **[inf]** | ~$6.93 **[inf]** | ~$2.25 if connected only while capturing **[inf]** |
| **Backend plumbing** | Token proxy (`/client_secrets`), ~30 lines; **0 for BYOK** **[inf]** | **Full GPU WS service** + autoscale + auth shim **[inf]** | Temp-JWT minter (30 s) **[src]** | Temp-token minter (`/v3/token`), **already client-wired** **[code]** |
| **Our model vs 3rd-party** | 3rd-party (OpenAI) | **Ours** (Whisper/Parakeet/`pyai-hear`) | 3rd-party (Deepgram) | 3rd-party (AssemblyAI) |
| **Privacy** | No training by default; 30-day abuse retention; ZDR = enterprise deal **[src]** | **Best — audio stays on our infra** **[inf]** | SOC2/HIPAA; set `mip_opt_out=true` to store nothing **[src]** | **ZDR for Streaming** when opted out of training **[src]** |
| **Client work** | **Done** **[code]** | **Done** **[code]** | **Done** **[code]** | **Done** **[code]** |
| **Effort to ship** | **Hours** **[inf]** | **Days–weeks** **[inf]** | **Hours** **[inf]** | **Hours** **[inf]** |

---

## 7. Recommendation

### 7.1 Fastest path to a working Wispr-like UX (hackathon)

**Ship a managed streaming provider behind a one-route token minter. Two equally-cheap-to-integrate choices:**

1. **Lowest latency (most Wispr-like feel): A3 / Deepgram Nova-3 or AssemblyAI Universal-Streaming.** 60–300 ms partials beat OpenAI's "Medium" speed. Both need only a temporary-token minting endpoint, and **AssemblyAI's token fetch is already coded in the client** (`/v3/token`). **[code]/[src]** Pick **AssemblyAI** if we want immutable partials and ZDR-by-opt-out; pick **Deepgram** if we want the absolute fastest first word and per-minute (not per-session) billing. **[inf]**
2. **Least backend risk / leverage existing OpenAI infra: A1 / OpenAI Realtime.** We already hold OpenAI keys server-side (the `/cleanup` proxy uses gpt-4o-mini). Add a `POST /v1/realtime/client_secrets` proxy and flip the client to `openai-realtime` with `gpt-4o-mini-transcribe`. Latency is merely "good," not class-leading, but it's the **smallest new surface area** and keeps one vendor. **[src]/[inf]**

**Concrete hackathon move:** wire **AssemblyAI** (client already 90% there) *or* **OpenAI Realtime** (single vendor) — both are an afternoon. If a judge cares about raw responsiveness, demo **Deepgram**. Guard the socket so it opens on hotkey-down and closes on commit (protects AssemblyAI session billing). **[inf]**

### 7.2 Long-term own-the-stack path

**Build A2 on GKE, reusing our sherpa-onnx Parakeet streaming server.**

- **Engine:** sherpa-onnx **online (transducer) Parakeet** — natively streaming, lowest partial latency, and **we already run this exact server on-device** [code], so the cloud version is largely a redeploy. Keep faster-whisper/WhisperLive as a multilingual fallback. **[inf]**
- **Infra:** **GKE GPU node pool (L4 for cost, A100 for density), Spot for non-critical replicas.** Avoid Cloud Run GPU for production dictation — its scale-to-zero cold start (~105–120 s) breaks first-dictation latency, and pinning `min-instances≥1` erases the serverless cost advantage. **[src/inf]** Cloud Run GPU is fine for a **staging single-container demo**. **[inf]**
- **Why:** this is the only path that (a) puts **our own model** (`pyai-hear` / Parakeet) in the loop, (b) gives **true privacy** (audio never leaves our infra — the core brand promise), and (c) drives **marginal per-user cost to ~zero** past ~180 concurrent heavy users on a single L4. **[inf]**
- **Sequencing:** run a managed provider (§7.1) in production **while** A2 is built; the client's provider abstraction means swapping the backend is a config change, not a rewrite. **[code]/[inf]**

### 7.3 What this decision does *not* require

No client work for any option — the WebSocket streaming clients, 16 kHz AudioWorklet capture, partial/final rendering, and commit-on-stop already exist for all five providers. **[code]** Every option's real cost is the **backend**: a token minter (A1/A3, hours) or a GPU WebSocket service (A2, days–weeks).

---

## 8. Sources

**OpenAI Realtime / transcription**
- Realtime transcription guide — https://developers.openai.com/api/docs/guides/realtime-transcription
- Create client secret (ephemeral token) — https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create
- Realtime & audio guide — https://developers.openai.com/api/docs/guides/realtime
- gpt-4o-transcribe pricing/specs — https://gate.ai/blog/gpt-4o-transcribe-openai-specs-pricing-api-use-cases · https://tokenmix.ai/blog/gpt-4o-transcribe-speech-to-text-api-guide-2026 · https://costgoat.com/pricing/openai-transcription
- Updates for developers building with voice (delay/models) — https://developers.openai.com/blog/updates-audio-models
- Independent STT benchmarks — https://www.coval.ai/blog/best-speech-to-text-providers-in-2026-independent-benchmarks-and-how-to-choose/
- OpenAI data retention / ZDR — https://openai.com/enterprise-privacy/ · https://developers.openai.com/api/docs/guides/your-data · https://meetily.ai/llm-privacy/openai

**Self-hosted streaming ASR + GCP infra**
- UFAL whisper_streaming (LocalAgreement-2) — https://github.com/ufal/whisper_streaming
- WhisperLiveKit — https://github.com/QuentinFuxa/WhisperLiveKit
- sherpa-onnx streaming server / Parakeet — https://k2-fsa.github.io/sherpa/onnx/index.html · https://github.com/k2-fsa/sherpa-onnx/blob/master/python-api-examples/streaming_server.py · https://github.com/aivo0/rust-asr-server
- Baseten Whisper-over-WebSockets + Wispr Flow — https://www.baseten.co/blog/zero-to-real-time-transcription-the-complete-whisper-v3-websockets-tutorial/ · https://www.baseten.co/resources/customers/wispr-flow/
- Cloud Run GPU (L4, pricing, GA) — https://docs.cloud.google.com/run/docs/configuring/services/gpu · https://cloud.google.com/run/pricing · https://jikkujose.in/2025/06/03/cloud-run-gpu-llm-deployment.html
- Cloud Run WebSockets + request timeout — https://docs.cloud.google.com/run/docs/triggering/websockets · https://docs.cloud.google.com/run/docs/configuring/request-timeout
- Cloud Run AI cold starts — https://cloud.google.com/blog/topics/developers-practitioners/a-guide-to-ai-cold-starts-on-cloud-run
- GKE GPU node pools + GCP GPU pricing (T4/L4/A100, Spot) — https://docs.cloud.google.com/kubernetes-engine/docs/how-to/gpus · https://www.thundercompute.com/blog/google-cloud-gpu-instances
- Self-host faster-whisper on GPU — https://www.spheron.network/blog/faster-whisper-gpu-cloud-production-deployment-guide/ · https://medium.com/zencore/hosting-a-whisper-api-on-gpu-with-gke-for-speech-transcription-88740f72d140

**Managed (Deepgram / AssemblyAI)**
- Deepgram Nova-3 latency/pricing — https://convertaudiototext.com/blog/deepgram-nova-3-explained · https://brasstranscripts.com/blog/deepgram-pricing-per-minute-2025-real-time-vs-batch
- Deepgram endpointing/interim & WebSockets — https://developers.deepgram.com/docs/understand-endpointing-interim-results · https://developers.deepgram.com/docs/lower-level-websockets
- Deepgram token auth (30 s JWT) + privacy/MIP — https://developers.deepgram.com/guides/fundamentals/token-based-authentication · https://developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program · https://developers.deepgram.com/trust-security/data-privacy-compliance
- AssemblyAI Universal-Streaming (latency, immutable, WS) — https://www.assemblyai.com/blog/introducing-universal-streaming · https://www.assemblyai.com/universal-streaming
- AssemblyAI session-based pricing — https://www.assemblyai.com/docs/faq/how-does-universal-streaming-session-based-pricing-work
- AssemblyAI data retention / ZDR / HIPAA — https://support.assemblyai.com/articles/2240096256-does-assemblyai-offer-zero-data-retention · https://www.assemblyai.com/security

**Repo (Pyper client — [code] claims)**
- `apps/desktop/src/helpers/openaiRealtimeStreaming.js` · `deepgramStreaming.js` · `assemblyAiStreaming.js` · `cortiStreaming.js`
- `apps/desktop/src/helpers/audioManager.js` (16 kHz Int16 PCM AudioWorklet) · `ipcHandlers.js` (batch `/transcribe` `pyai-hear` + `/cleanup`; AssemblyAI `/v3/token` fetch)
- `docs/backend-handoff-gcp.md` (current GCP backend contract) · `apps/desktop/CLAUDE.md` (sherpa-onnx online Parakeet streaming)
