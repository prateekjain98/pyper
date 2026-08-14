# Pyper — Architecture & Dictation Pipeline

> **Purpose:** one map of the whole monorepo, the Electron desktop app's process model, and — the
> centerpiece — the **end-to-end dictation pipeline** (hotkey → audio → transcription → cleanup →
> paste). Companion to the deep-dives in [apps/desktop/CLAUDE.md](../apps/desktop/CLAUDE.md),
> [wispr-flow-pipeline.md](wispr-flow-pipeline.md), and
> [realtime-dictation-architecture.md](realtime-dictation-architecture.md).
> **Audience:** any agent/engineer who needs the shape of the system before touching it.

All diagrams are Mermaid and render inline on GitHub.

---

## 1. Monorepo topology

Three deliverables in one repo: the **desktop app** (the product), the **marketing site + live
demo**, and a small **cloud proxy** that fronts the dictation engines. npm workspaces + turbo, pinned
to Node 24.

```mermaid
graph TB
  subgraph Repo["pyper/ — npm workspaces + turbo · Node 24"]
    direction TB

    subgraph AppsWS["apps/*"]
      Desktop["<b>apps/desktop</b><br/>Electron dictation app<br/><i>the product · forked from OpenWhispr</i>"]
      Web["<b>apps/web</b><br/>Next.js marketing site + /demo"]
    end

    subgraph Svc["services/"]
      Proxy["<b>pyai-proxy</b><br/>Cloud Run (GCP)<br/>STT waterfall + cleanup waterfall"]
    end

    Meta["docs/ · tasks/ · coordination/<br/><i>playbook, task board, live agent worklogs</i>"]
  end

  subgraph Cloud["External / cloud engines"]
    PyAI["PyAI<br/>pyai-hear STT"]
    OpenAI["OpenAI"]
    Groq["Groq"]
    Anthropic["Anthropic"]
    Gemini["Gemini"]
    PyperAPI["Pyper API<br/>/api/reason (authenticated)"]
  end

  Web -->|"/api/transcribe · /api/cleanup · /api/status"| Proxy
  Web -.->|"/transcribe/stream (WebSocket)"| Proxy
  Desktop -->|"cloud mode: 'pyper' provider"| PyperAPI
  Desktop -.->|"web demo shares these engines"| Proxy
  Proxy --> PyAI
  Proxy --> OpenAI
  Proxy --> Groq
  Proxy --> Anthropic

  Desktop -.->|"BYOK cloud transcription / cleanup"| OpenAI
  Desktop -.-> Anthropic
  Desktop -.-> Gemini
  Desktop -.-> Groq

  classDef product fill:#2563eb,stroke:#1e40af,color:#fff;
  classDef svc fill:#7c3aed,stroke:#5b21b6,color:#fff;
  classDef cloud fill:#0f766e,stroke:#115e59,color:#fff;
  class Desktop product;
  class Proxy svc;
  class PyAI,OpenAI,Groq,Anthropic,Gemini,PyperAPI cloud;
```

**Key facts**

- **apps/desktop** — Electron 41 + React 19 + Vite. Privacy-first: the **local** path (whisper.cpp /
  NVIDIA Parakeet + llama.cpp) is the default; cloud is opt-in.
- **apps/web** — Next.js. Server routes (`/api/transcribe`, `/api/cleanup`, `/api/status`) proxy to
  `pyai-proxy` so the browser needs no keys/CORS; `/demo` can also open a **WebSocket** straight to the
  proxy's `/transcribe/stream` relay for live streaming.
- **services/pyai-proxy** — dependency-free Node service on Cloud Run. Both dictation stages are
  **waterfalls** (ordered by latency, fall through on failure): STT = `pyai → openai → groq`;
  cleanup = `groq → openai → anthropic`. Keys mounted from GCP Secret Manager.

---

## 2. Desktop process model

Electron with context isolation. One **main process** owns native OS integration, IPC, storage, and
child processes; the **renderer** is a single React app rendered into four windows; a **preload**
bridge and an **ONNX utility process** round it out. All heavy inference runs in **sidecar child
processes**, so a native crash never takes down the app.

```mermaid
graph TB
  subgraph Main["Main process — main.js · ipcHandlers.js"]
    direction TB
    Managers["<b>~25 Managers</b> (src/helpers/)<br/>window · hotkey · clipboard · audioTap<br/>whisper · parakeet · diarization · qdrant<br/>calendar (Google/MS/Apple) · meeting detect<br/>update · tray · environment · database"]
    Reason["ReasoningService + InferenceProviders<br/>anthropic · openai · gemini · groq · lan<br/>local · enterprise · pyper"]
  end

  subgraph Preload["preload.js — context-isolated bridge"]
    API["window.api (typed IPC surface)"]
  end

  subgraph Renderer["Renderer — React 19 / Vite (AppRouter.jsx)"]
    direction TB
    Overlay["Dictation overlay (App.jsx)<br/><i>the pill / waveform</i>"]
    Panel["Control Panel<br/><i>settings · history · models</i>"]
    AgentW["Agent overlay"]
    Preview["Transcription preview"]
  end

  subgraph Util["ONNX utility process (onnxWorker.js)"]
    ONNX["onnxruntime-node<br/>text + speaker embeddings, fbank"]
  end

  subgraph Sidecars["Sidecar child processes (resources/bin/)"]
    Whisper["whisper.cpp<br/>(+ CUDA / Vulkan variants)"]
    Sherpa["sherpa-onnx<br/>Parakeet WS server (offline/online)"]
    Llama["llama.cpp server<br/>local cleanup / agent LLM"]
    Qdrant["Qdrant<br/>vector DB (semantic search)"]
  end

  subgraph Storage["Local storage"]
    SQLite["Local DB via convexDatabaseManager<br/>transcriptions · notes · calendar_events<br/>(+ background cloud sync)"]
    Secure["safeStorage secure-keys/<br/>12 encrypted secrets"]
    LS["localStorage<br/>settings · dictionary · onboarding"]
    Cache["~/.cache/pyper/<br/>models · qdrant-data"]
  end

  Renderer <-->|"window.api.* IPC"| Preload
  Preload <-->|"ipcMain handlers"| Main
  Main -->|"IPC utility"| Util
  Main --> Whisper
  Main --> Sherpa
  Main --> Llama
  Main --> Qdrant
  Reason --> Llama
  Managers --> SQLite
  Managers --> Secure
  Renderer --> LS
  Whisper --> Cache
  Sherpa --> Cache
  Qdrant --> Cache

  classDef proc fill:#1e293b,stroke:#0f172a,color:#fff;
  classDef store fill:#334155,stroke:#1e293b,color:#fff;
  class Main,Preload,Renderer,Util proc;
  class SQLite,Secure,LS,Cache store;
```

**Native OS glue** (per-platform, feeding the pipeline):

- **Global hotkey** — macOS Globe/Fn via a Swift `globe-listener` binary; Windows push-to-talk via a
  native low-level keyboard hook (`windows-key-listener.exe`); Wayland via D-Bus + GNOME/Hyprland/KDE
  shortcut managers; `globalShortcut` elsewhere.
- **Paste** — macOS AppleScript, Windows PowerShell SendKeys / nircmd, Linux XTest + xdotool/wtype/ydotool.
- **Meeting detection** — event-driven mic/process/calendar signals (separate subsystem; not on the
  dictation critical path).

---

## 3. The main dictation pipeline (end-to-end)

This is the product's core loop: **press hotkey → speak → release → cleaned text appears at the
cursor.** Recognition can stream *while you speak* (online Parakeet / cloud WS); the cleanup LLM pass
runs *after* the full utterance, then one clean block is pasted — the Wispr Flow shape.

```mermaid
flowchart TB
  Start(["User presses global hotkey"]) --> HK

  subgraph Capture["1 · Capture — Main → Renderer"]
    HK["hotkeyManager slot fires<br/>(dictation / voiceAgent)"]
    HK --> Toggle["main.js → windowManager.sendToggle*<br/>IPC → dictation overlay"]
    Toggle --> Rec["useAudioRecording.js → audioManager.js<br/>batch: MediaRecorder (webm/opus)<br/>streaming: AudioWorklet PCM @16kHz"]
    Rec --> Wave["Overlay shows waveform<br/><i>no live text (formatted block on stop)</i>"]
  end

  Wave --> Branch{"resolveTranscriptionRoute()<br/>(settings)"}

  subgraph Transcribe["2 · Transcribe"]
    direction TB
    Branch -->|"local · whisper.cpp"| Whisper["transcribe-local-whisper IPC<br/>→ whisper.js (native binary)"]
    Branch -->|"local · Parakeet offline"| PkOff["transcribe-local-parakeet IPC<br/>→ sherpa-onnx WS (parakeetServer.js)"]
    Branch -->|"local · Parakeet online"| PkOn["stream worklet PCM live →<br/>WS commit on stop (parakeetWsResult.js)"]
    Branch -->|"cloud · pyper"| CloudT["cloud-transcribe IPC<br/>→ PyAI proxy /transcribe (waterfall)"]
    Branch -->|"cloud · BYOK / realtime"| CloudB["openai / deepgram / assemblyAi /<br/>tinfoil / corti (batch or WS stream)"]
  end

  Whisper --> Raw["Raw transcript"]
  PkOff --> Raw
  PkOn --> Raw
  CloudT --> Raw
  CloudB --> Raw

  Raw --> Route{"resolveReasoningRoute →<br/>resolveDictationRouteKind()<br/>dictationRouting.js"}

  subgraph Reason["3 · Reasoning / cleanup — ReasoningService.processText()"]
    direction TB
    Route -->|"normal dictation"| Cleanup["<b>dictationCleanup</b> scope<br/>fillers, punctuation, per-app tone,<br/>custom dictionary"]
    Route -->|"'Hey Agent' / voiceAgent"| Agent["<b>dictationAgent</b> scope<br/>runs the spoken command<br/>(+ optional screen context)"]
    Route -->|"translation hotkey"| Trans["<b>dictationTranslation</b> scope<br/>runTranslationChain()"]
    Route -->|"agent disabled / no model"| Passthru["raw transcript (skip · no LLM)"]
    Cleanup --> Prov["PROVIDER_REGISTRY[provider].call()<br/>local llama.cpp · openai · anthropic · gemini<br/>groq · tinfoil · corti · enterprise · lan · pyper"]
    Agent --> Prov
    Trans --> Prov
  end

  Prov --> Final["Final text"]
  Passthru --> Final

  subgraph Output["4 · Output"]
    Final --> Paste["paste-text IPC → clipboard.js<br/>paste at cursor (AppleScript / SendKeys / XTest)"]
    Final --> Save["db-save-transcription IPC →<br/>convexDatabaseManager → transcriptions store<br/>(+ background cloud sync)"]
  end

  Paste --> Done(["Text in the focused app"])

  classDef phase fill:#1e293b,stroke:#0f172a,color:#fff;
  classDef decision fill:#b45309,stroke:#92400e,color:#fff;
  class Branch,Route decision;
```

**How to read it**

- **Capture** — the hotkey is caught in the main process and toggled into the dictation overlay over
  IPC. The overlay records mic audio (MediaRecorder + an AudioWorklet PCM tap) and shows a **waveform,
  not live text**.
- **Transcribe** — a settings-driven branch. Local **whisper.cpp** and **offline Parakeet** are
  record-then-transcribe; **online Parakeet** streams PCM to a persistent websocket and commits the
  flushed text on stop (recognition finishes as you release). Cloud transcription (BYOK, or the
  desktop's own `pyper` provider) runs the same STT waterfall the web demo uses.
- **Reasoning / cleanup** — `resolveReasoningRoute` → `resolveDictationRouteKind()`
  (`dictationRouting.js`) picks the route: the default **cleanup** scope (Wispr-style formatting), the
  **dictationAgent** scope when the user addresses the named agent or used the voice-agent hotkey
  (optionally with a screenshot), the **translation** scope for the translation hotkey, or a raw
  **skip** when no agent is configured. `ReasoningService.processText()` then dispatches through
  `PROVIDER_REGISTRY[provider].call()` to run it locally (llama.cpp) or in the cloud. The cloud
  **`pyper`** provider splits by mode: cleanup → PyAI proxy `/cleanup` (no auth, fail-open to the raw
  transcript); agent → authenticated `${PYPER_API_URL}/api/reason`.
- **Output** — the final text is pasted at the cursor via the platform clipboard path (`paste-text`
  IPC) and saved through `convexDatabaseManager` to the `transcriptions` store (raw + processed), which
  pushes to the cloud in the background.

**Four inference scopes** (independently configurable provider/model, `src/config/inferenceScopes.ts`):
`dictationCleanup` · `dictationAgent` · `noteFormatting` · `chatIntelligence` (plus the
`dictationTranslation` and `dictationAgentVision` overrides).

> **Note:** the persistence layer now routes through `convexDatabaseManager.js` (Convex-backed store +
> background sync), superseding the `better-sqlite3` / `database.js` description still in the older
> [apps/desktop/CLAUDE.md](../apps/desktop/CLAUDE.md).

---

## 4. Web demo & cloud proxy (the cloud dictation path)

The public `/demo` reuses the exact desktop pipeline shape, but cloud-only — same cleanup prompt, same
engine waterfalls — so it doubles as a live, keyless showcase of the product's core loop.

```mermaid
sequenceDiagram
  autonumber
  actor U as Visitor
  participant B as /demo (browser)
  participant W as apps/web API routes
  participant P as pyai-proxy (Cloud Run)
  participant E as Engines

  U->>B: Hold hotkey, speak
  alt streaming
    B->>P: WS /transcribe/stream (live PCM)
    P-->>B: partial + final transcript
  else record-then-send
    B->>W: POST /api/transcribe (audio)
    W->>P: POST /transcribe
    P->>E: STT waterfall (pyai → openai → groq)
    E-->>P: text
    P-->>W: { text }
    W-->>B: raw transcript
  end
  B->>W: POST /api/cleanup { text }
  W->>P: POST /cleanup
  P->>E: cleanup waterfall (groq → openai → anthropic)
  E-->>P: formatted text
  P-->>W: { text }
  W-->>B: cleaned block shown at cursor
```

Both stages fall through to the next engine on failure, so one provider being rate-limited or out of
credits never breaks the demo. Engines are swappable entirely via env (`STT_PROVIDERS`,
`CLEANUP_PROVIDERS`, and per-provider `*_BASE_URL` / `*_API_KEY` / `*_MODEL`).

---

## 5. Where to go next

| You want to… | Read |
|---|---|
| Understand desktop internals (managers, IPC, sidecars, build) | [apps/desktop/CLAUDE.md](../apps/desktop/CLAUDE.md) |
| See what a Wispr-parity pipeline must do | [wispr-flow-pipeline.md](wispr-flow-pipeline.md) |
| Dig into realtime/streaming dictation design | [realtime-dictation-architecture.md](realtime-dictation-architecture.md) |
| Learn how agents coordinate in this repo | [../CLAUDE.md](../CLAUDE.md) · [agents-playbook.md](agents-playbook.md) |
</content>
</invoke>
