# anarlog vs OpenWhispr — feature comparison & "good parts to steal"

> **Purpose:** research doc for the Pyper roadmap. Compares `fastrepl/anarlog` against the
> OpenWhispr codebase Pyper referenced for architecture, and lists the good parts anarlog has
> that OpenWhispr/Pyper lacks.
> **Date:** 2026-08-13 · **Author:** automated research pass, grounded on the local OpenWhispr
> clone (v1.8.3) and public anarlog sources.

## 1. Repo identity check

- **Repo analyzed:** [`github.com/fastrepl/anarlog`](https://github.com/fastrepl/anarlog) — a **real, active repo** (~9,000 stars, ~710 forks), not a 404.
- **Name match:** "anarlog" is correct, but it's the **same codebase renamed twice**: launched as **Hyprnote** (YC S25) → briefly **char** (`fastrepl/unsigned-char`) → **renamed to `anarlog` in Apr 2026, with a license change GPL → MIT**. So it *is* essentially hyprnote under a new name.
- Sources: the anarlog repo, the [fastrepl org repo list](https://github.com/orgs/fastrepl/repositories) (`unsigned-char → Moved to fastrepl/anarlog`), the [anarlog.so "Char Is Now Anarlog" blog](https://anarlog.so/blog/char-is-now-anarlog/), and DeepWiki.

## 2. anarlog at a glance

- **Purpose:** Local-first, privacy-first **AI meeting notetaker** — an open-source Granola alternative. Records system audio (no bot joins the call, no calendar permission required), transcribes on-device, and turns raw notes + transcript into structured "enhanced" notes via an LLM.
- **Stack:** **Rust + Tauri** desktop shell, **TypeScript + React** (TanStack Router/Start), **SQLite** as the canonical local store, **Supabase (Postgres)** for cloud accounts, **Axum** API server. State via **Zustand + TinyBase** (reactive multi-window).
- **Repo shape:** A large **Turborepo monorepo**: `apps/` (`desktop`, `api`, `cli`), `crates/` (~150 Rust crates), `plugins/` (~48 Tauri plugins), `packages/`, `skills/`, `docs/`, `supabase/`.
- **Platforms:** macOS (Apple Silicon), Windows, Linux; a `mobile-bridge` crate hints at a mobile companion.
- **License:** **MIT** — same permissive, open-core posture as OpenWhispr (OSS app + optional hosted cloud).

**Honest caveat:** anarlog is a *big, sophisticated* project (the opposite of "small/archived"). Its README markets a deliberately simple story, but the codebase reveals far more machinery (templates, automations, task extraction, ~48 plugins, dozens of integration crates). Several "good parts" below are visible in code/architecture even where the README stays quiet.

## 3. Feature / architecture comparison

| Dimension | anarlog (fastrepl) | OpenWhispr (v1.8.3) |
|---|---|---|
| **Primary use case** | Meeting notetaker (Granola-style) | **Voice dictation-first**, plus meetings + notes |
| **Desktop framework** | **Tauri (Rust core)** | Electron 41 |
| **Perf/footprint** | Rust + system WebView → **smaller bundle, lower RAM** | Chromium bundled → heavier |
| **Module architecture** | **~48 Tauri plugins + ~150 crates**, highly modular; ships an `add-plugin` dev skill | Monolithic-ish: 67 KB `main.js`, 61 KB `preload.js`, service classes in `src/services` |
| **Local STT** | `plugin/local-stt`, `owhisper-*`, cactus engine; Whisper | whisper.cpp (Metal/CUDA/Vulkan) + **NVIDIA Parakeet** via sherpa-onnx |
| **Local LLM** | `plugin/local-llm`, `gguf`/`gbnf` (grammar-constrained output), `lmstudio` | llama-server (llama.cpp) |
| **Diarization** | pyannote (`pyannote-local`/`-cloud`, `segmentation`) | On-device diarization + **cross-meeting voice fingerprinting** |
| **Meeting capture** | System-audio tap, no bot, `detect` plugin, `meeting-float` | Auto-detect Zoom/Teams/FaceTime, AEC helper, meeting overlay |
| **Dictation** | `dictation` plugin (secondary) | **Headline feature**: global-hotkey paste-anywhere, translation dictation, voice-agent hotkey + screenshot context, in-place edit |
| **Notes model** | SQLite canonical + **`fs-sync` markdown-on-disk** (Obsidian-style vault) | SQLite canonical + on-demand markdown export |
| **Note templates** | ✅ **Structured, sectioned, user-editable templates** (`apps/desktop/src/templates`) + `template` plugin | ❌ Only flat "Actions" = name+description+prompt (`ActionManagerDialog.tsx`) |
| **Task / action items** | ✅ `todo` plugin + `task` UI + `apple-todo` (extract & sync action items) | ❌ None ("actions" = AI prompts, not extracted todos) |
| **Search** | **Tantivy** (embedded Rust FTS) + `embedding` crate | Semantic search via **MiniLM + bundled Qdrant binary** |
| **Calendar** | Google/Outlook/Apple (`*-calendar` crates), via Nango | Google/Microsoft/Apple |
| **Push integrations** | ✅ **Notion, Linear, Slack, GitHub issues, Apple Notes/Todo, Google Drive** (dedicated crates) via **Nango** OAuth framework | ❌ None outbound (only Calendar in + API/MCP out) |
| **Import / migration** | ✅ Modular importer (`imports/` + `granola`, `apple-note` crates) — **migrate off competitors** | ❌ None (only audio/YouTube ingest) |
| **Automations** | ✅ **User-facing automation engine** (`automations/`: `engine`, `actions`, `selection`, `starters`) | ❌ ("automation" in code = Wayland input tool) |
| **Hooks / webhooks** | ✅ `hooks` + `webhook` plugins | ❌ No webhooks |
| **Versioning** | `git` plugin (git-backed notes) | ❌ No note history |
| **Cloud sync** | CloudSync + **`e2ee` crate (end-to-end encryption)** | Cloud sync on Neon Postgres (E2EE not indicated) |
| **Enterprise** | `bedrock` plugin, Supabase auth, subscriptions | ✅ **SSO + SCIM + org policy + Bedrock + Azure OpenAI**, team spaces w/ roles |
| **Public API / MCP** | `local-api` + `mcp` plugins, `apps/api` | ✅ Public REST API + **MCP server** + CLI, documented |
| **CLI** | `apps/cli` (Rust) | CLI + published `agent-skills/` (api, cli) |
| **i18n** | Present | ✅ **10 fully-translated locales** |
| **In-repo dev skills** | ✅ `.agents/skills` + `.claude/skills` (`add-plugin`, `sqlite-schema-design`, `reactive-sqlite-ui`, `release-new-version`) | Minimal (2 end-user skills) |
| **License** | MIT | MIT |

## 4. Good parts in anarlog that OpenWhispr lacks (prioritized)

### Tier 1 — high value, portable to Electron+React

1. **Structured, user-editable note templates (Granola's core wedge).** *(Complexity: Med)*
   - *What:* Reusable meeting-note templates with named **sections**, per-template icons, and **auto-format examples** that steer the LLM's "enhance" pass (`apps/desktop/src/templates/`) + a dedicated `template` plugin.
   - *Why:* This is *the* reason people pick Granola/hyprnote — consistent, structured summaries per meeting type (1:1, standup, sales call). OpenWhispr only has flat prompt "Actions."
   - *Where in Pyper:* Extend `src/config/prompts` into a template registry; new `src/stores/templateStore.ts`; template CRUD UI beside `ActionManagerDialog.tsx`; feed sections into the existing `ReasoningService`/enhance pipeline.

2. **Action-item / task extraction with a Tasks view.** *(Complexity: Med)*
   - *What:* `todo` plugin + `task/` UI extract action items from transcripts into a first-class task list (`apple-todo` crate syncs to Apple Reminders).
   - *Why:* Meetings' highest-value output is "what do I do next." OpenWhispr captures notes but never surfaces todos.
   - *Where:* Reuse the reasoning pipeline to emit structured JSON todos; add a Tasks view under `src/components/notes/`; optional native Reminders bridge.

3. **Outbound integrations via a pluggable OAuth framework (Nango).** *(Complexity: Med per integration / High for the framework)*
   - *What:* Push notes/todos to **Notion, Linear, Slack, GitHub Issues, Apple Notes** — each a crate — brokered through **Nango** so new OAuth integrations are config, not bespoke code.
   - *Why:* OpenWhispr only *pulls* calendars and *exposes* an API; it can't deliver a summary into the tools people live in. Top retention/distribution feature.
   - *Where:* Extend `src/services/tools/ToolRegistry.ts` + `calendarTool.ts` with outbound integration services and cards in `IntegrationsView.tsx`. A Nango-style broker avoids hand-rolling each OAuth.

4. **Import / migration from competitors (Granola, Apple Notes).** *(Complexity: Med)*
   - *What:* Modular importer (`apps/desktop/src/imports/`) backed by `granola` and `apple-note` crates.
   - *Why:* One-click "import your Granola history" is a direct acquisition wedge. OpenWhispr has *no* migration path.
   - *Where:* New `src/services/import/` with per-provider parsers + an onboarding step.

### Tier 2 — valuable, moderate effort

5. **User-facing automation engine.** *(Complexity: Med/High)* — "when a meeting ends, run template X, extract todos, post to Slack." Slots as a new `src/services/automation/` + `automationStore` + trigger hooks in `main.js`.

6. **Developer hooks + outbound webhooks.** *(Complexity: Low/Med)* — let power users/other apps react to events (note created, meeting ended). Natural fit on Electron's `main.js` event bus + a settings panel. Cheap, high leverage for an OSS product.

7. **Embedded SQLite FTS instead of a bundled Qdrant binary.** *(Complexity: Low/Med)* — anarlog uses embedded **Tantivy**; OpenWhispr ships a whole **Qdrant** binary (`scripts/download-qdrant.js`) + MiniLM. Since Pyper already depends on **better-sqlite3**, **SQLite FTS5** + an optional local embedding table would drop a heavy runtime dependency and simplify packaging.

8. **git-backed note history / versioning.** *(Complexity: Med)* — free version history + diff/restore. Implement as a git repo over a markdown-synced notes folder, or a revision table in SQLite.

9. **End-to-end encrypted cloud sync.** *(Complexity: High)* — for a privacy-marketed app, E2EE sync is a credibility differentiator. Slots into `SyncService.ts` with client-side crypto + key management.

### Tier 3 — architectural / DX (aspirational or non-portable)

10. **Modular plugin architecture.** *(Complexity: High)* — a refactor direction: carve `main.js` into registered capability modules with a manifest.
11. **In-repo agent skills for the *dev* workflow.** *(Complexity: Low — do this now)* — add `.claude/skills/` for release, changelog, i18n-check, and native-helper builds. Pure DX, near-zero risk.
12. **Grammar-constrained local LLM output (GBNF/GGUF).** *(Complexity: Med)* — constrain local-model decoding to valid JSON/section schemas so *local* templates/todos are reliable (llama.cpp GBNF grammars).
13. **Tauri's footprint advantage** — context only; not portable into Electron.

## 5. Things OpenWhispr already does better or equally

- **Dictation is a first-class product**, not a side plugin: paste-into-any-app hotkey, **dictation translation**, a **voice-agent hotkey** with **screenshot-as-context** and **in-place text editing**.
- **Enterprise depth:** SSO + SCIM + centrally-enforced org policy + Bedrock + Azure OpenAI, plus team spaces with roles.
- **Breadth of model providers in one app:** whisper.cpp + Parakeet + OpenAI/Anthropic/Gemini/Groq/OpenRouter + **Tinfoil** (confidential compute) + LAN/self-hosted.
- **Cross-meeting voice fingerprinting** — persistent speaker identity across meetings, on-device.
- **Localization:** 10 fully-translated locales with an `i18n:check` gate.
- **Public API + MCP + CLI** already documented and shipped.
- **Audio/URL ingest** via yt-dlp.
- **Maturity/polish:** extensive per-platform native helpers, onboarding, referral system.
- **Parity items** (both do these): local STT, local LLM, diarization, no-bot meeting capture, calendar, semantic search, MCP, CLI, MIT license, open-core cloud.

## 6. Top recommendations to port into Pyper

1. **Structured note templates with sections + auto-format examples** — the single feature that defines the Granola/hyprnote category. *(Med)*
2. **Action-item extraction + a Tasks view** (optionally syncing to Apple Reminders). *(Med)*
3. **Outbound integrations behind a Nango-style OAuth broker** (Notion, Linear, Slack first) — extends the existing `ToolRegistry`. *(Med)*
4. **One-click import/migration from Granola & Apple Notes** — a direct acquisition wedge. *(Med)*
5. **Swap the bundled Qdrant binary for SQLite FTS5 + optional embeddings, and add an automations/webhooks event layer** — packaging simplification + extensibility hooks. *(Low–Med)*

**Bottom line:** anarlog and OpenWhispr are close cousins on opposite shells (Tauri/Rust vs Electron) with the same open-core, privacy-first DNA. OpenWhispr wins on **dictation, enterprise, model breadth, i18n, and shipped API/MCP maturity**. anarlog's transferable edges are all on the **meeting-notes-as-a-workspace** side: **templates, task extraction, outbound integrations, competitor import, automations/hooks, git history, E2EE sync**, plus a cleaner **modular plugin architecture** and stronger **in-repo dev-skill DX**.
