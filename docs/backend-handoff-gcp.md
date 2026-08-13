# Pyper Backend — Handoff for GCP Setup

> ## ⚠️ SUPERSEDED (2026-08-13)
> **The cloud backend is being built on [Convex](https://convex.dev), NOT Postgres/GCP.**
> Do **not** build the Cloud SQL / pgvector backend described below. The Convex
> backend lives in [`apps/desktop/convex/`](../apps/desktop/convex/) (see its
> `README.md`). This document is retained for its API-contract reference only
> (§3 REST v1, §4 sync/inference shapes) — the compute/database recommendations
> in §5–§7 are void.

**Audience:** the engineer/agent standing up the Pyper **cloud backend** on Google Cloud.
**Status:** greenfield. No server code exists in this repo — only the desktop **client** and a
documented API contract. The client is the source of truth for everything the backend must satisfy.
**Date:** 2026-08-13.

---

## 0. TL;DR

Pyper (a rebranded fork of the open-source OpenWhispr desktop app) is a privacy-first dictation
app. Its desktop client already exists in this monorepo at [`apps/desktop`](../apps/desktop). The
**cloud backend was never open-source**, so it must be built from scratch. The client expects four
HTTPS surfaces on the `pyper.work` domain:

| Host | Purpose | Auth |
|------|---------|------|
| `api.pyper.work` | REST API v1 (external) **+** private desktop endpoints (`/api/transcribe`, `/api/reason`, transcription sync, key mgmt) | Session bearer token (desktop) · `owk_live_` API keys (external/MCP) |
| `auth.pyper.work` | Better Auth server: email/password, social OAuth, SSO/SAML, sessions, desktop sign-in shims | Cookies + bearer session tokens |
| `mcp.pyper.work/mcp` | Remote MCP server (Streamable HTTP, stateless) exposing V1 as tools | `Authorization: Bearer owk_live_…` |
| `notes.pyper.work` | Public read-only viewer for shared notes | Share token (public) |

Plus the marketing/web app at `pyper.work` (already scaffolded at [`apps/web`](../apps/web)) must
grow a few auth routes (see §4).

**Until this backend exists, all cloud features are dead** (sign-in, sync, cloud transcription,
cloud LLM, sharing, spaces, MCP). Local/offline transcription and BYOK (bring-your-own-key) AI work
with no backend — do **not** rebuild those (see §10).

---

## 1. How the client finds the backend (config contract)

The client resolves hosts at **build/runtime** from env vars, falling back to `brand.js`. Once the
backend is live, set these for the desktop build:

| Var | Meaning | Current default |
|-----|---------|-----------------|
| `VITE_PYPER_API_URL` / `PYPER_API_URL` | REST + managed-inference base | **empty** → cloud API off |
| `VITE_AUTH_URL` / `AUTH_URL` | Better Auth base | `https://auth.pyper.work` (from `brand.js`) |
| `VITE_PYPER_OAUTH_CALLBACK_URL` | Override desktop OAuth callback page | `https://pyper.work/auth/desktop-callback` |
| `PYPER_CHANNEL` / `VITE_PYPER_CHANNEL` | `production` \| `staging` \| `development` → deep-link scheme `pyper://` \| `pyper-staging://` \| `pyper-dev://` | `production` |

- Single source of truth for hosts is [`apps/desktop/src/config/brand.js`](../apps/desktop/src/config/brand.js) — `DOMAIN = "pyper.work"` derives `api`, `auth`, `mcp`, `notes`, `website`.
- The client sends these headers to cloud hosts — the backend must tolerate/consume them:
  - `x-pyper-source: desktop`
  - `x-pyper-version: <appVersion>`
  - `x-pyper-policy-version: <n>` (org-policy enforcement handshake)
  - **`Origin` is spoofed** to the target host — Electron's `file://` renderer sends `Origin: null`, so the client rewrites it (see `src/helpers/sessionHeaders.js`). **Better Auth `trustedOrigins` must include `https://api.pyper.work` and `https://auth.pyper.work`.**

---

## 2. Authentication architecture (Better Auth)

The client is built against **Better Auth** (already a dependency: `better-auth/react`,
`@better-auth/sso/client`). Self-host the Better Auth **server** so cookie/session/bearer semantics
match exactly. See [`apps/desktop/src/lib/auth.ts`](../apps/desktop/src/lib/auth.ts).

**Methods to support:** email/password, social OAuth (Google first), SSO/SAML (enterprise, via the
Better Auth SSO plugin).

**Session token model (critical):** the desktop app authenticates cloud calls with a **bearer
session token** (Better Auth *bearer* plugin), not the `owk_live_` API keys. Endpoints the client calls:

- Standard Better Auth: `/api/auth/*` (sign-in, sign-up, callback, sign-out, session, reset-password, social, sso)
- `GET /api/auth/get-session`
- `POST /api/auth/delete-account`
- `GET /api/auth/verification-status?email=…`
- **Custom desktop shims (must implement):** `GET /api/desktop-signin/{provider}` and `GET /api/desktop-signin/sso` — initiate OAuth/SSO **server-side** and 302 to the `callbackURL` with the session established.

**Desktop sign-in handshake** (browser ↔ app):

1. App opens the system browser to
   `${AUTH_URL}/api/desktop-signin/{provider}?callbackURL=${WEBSITE}/auth/desktop-callback?protocol=pyper`
   (or `/sso` with `email`). Browser is used so the state cookie lands in the browser's jar.
2. Server runs OAuth, establishes the session, 302 → the hosted **`/auth/desktop-callback`** page.
3. That page hands the **bearer session token** back to the app via the deep link
   `pyper://…?bearer_token=<token>` (registered protocol handler). In **development** the app also
   runs a localhost bridge that accepts `?bearer_token=` (see `startAuthBridgeServer` in `main.js`).
4. App stores the token and sends `Authorization: Bearer <token>` on all cloud calls.

So the backend deliverables for auth: Better Auth server + bearer plugin + the two `desktop-signin`
shim routes, and the web app must serve `/auth/desktop-callback` and `/reset-password`.

---

## 3. REST API v1 (external + MCP)

The **full, authoritative spec** is in
[`apps/desktop/agent-skills/pyper-api/SKILL.md`](../apps/desktop/agent-skills/pyper-api/SKILL.md) —
implement it verbatim. Summary:

- **Base:** `https://api.pyper.work/api/v1`
- **Auth:** `Authorization: Bearer owk_live_…` (personal) or `ow_wks_live_…` (workspace). Scoped permissions; `403 forbidden` on missing scope.
- **Envelope:** `{ "data": … }` (single), `{ "data": [...], "has_more": bool, "next_cursor": str }` (list), `{ "error": { "code", "message" } }`.
- **Error codes:** `validation_error`(400) `invalid_api_key`(401) `forbidden`(403) `not_found`(404) `method_not_allowed`(405) `conflict`(409) `rate_limited`(429) `internal_error`(500).
- **Rate limits:** per-key minute + daily windows (Free 30/1k, Pro 120/10k, Business 300/50k); search costs 5×. Headers `X-RateLimit-Limit/Remaining/Reset`, `Retry-After`.
- **Pagination:** opaque cursor → `?cursor=`.

**Endpoints:**

- Notes: `GET /notes/list`, `GET /notes/{id}`, `POST /notes/create`, `PATCH /notes/{id}`, `DELETE /notes/{id}` (soft), `POST /notes/search` (hybrid vector + FTS).
- Folders: `GET /folders/list`, `POST /folders/create` (≤50/user).
- Transcriptions: `GET /transcriptions/list`, `GET /transcriptions/{id}`.
- Usage: `GET /usage`.
- Spaces (workspace keys only): `GET /spaces/list`; `space_id` required on notes/folders list/create/search for workspace keys, rejected for personal keys.
- **API-key management** (session-authed, from the desktop Settings UI — see `src/services/ApiKeysService.ts`): `GET /api/v1/keys/list`, `POST /api/v1/keys/create`, `POST /api/v1/keys/{id}/revoke`.

---

## 4. Managed-inference & sync endpoints (desktop-only, session-authed)

These are **not** in SKILL.md but the desktop app depends on them. Auth = bearer **session** token
+ policy headers. Traced from `src/helpers/ipcHandlers.js` and
`src/services/ai/inferenceProviders/pyper.ts`.

### `POST /api/reason` — managed LLM proxy
Server holds provider keys, applies org policy, returns cleaned/agent text.
- **Body:** `{ text, model, agentName, customDictionary, customPrompt, systemPrompt, requestPurpose, promptMode: "cleanup"|"agent"|undefined, screenContext (base64 JPEG, optional/vision), language, locale, sessionId, clientType: "desktop", appVersion, clientVersion, sttProvider, sttModel, sttProcessingMs, sttWordCount, sttLanguage, audioDurationMs, audioSizeBytes, audioFormat, clientTotalMs }`
- **Response:** `{ success, text, model, provider, promptMode, matchType, screenContextApplied }` or `{ success:false, error, code }`.
- Notes: `promptMode:"agent"` only rides with a screenshot; supports vision when `screenContext` present; `requestPurpose` + `x-pyper-policy-version` drive org-policy enforcement.

### `POST /api/transcribe` — managed STT proxy
- **Request:** `multipart/form-data` with an `audio.webm` part + metadata fields; enforces word quota/plan.
- **Response:** `{ text, wordsUsed, wordsRemaining, plan, limitReached, sttProvider, sttModel, sttProcessingMs, sttWordCount, sttLanguage, audioDurationMs }`.
- Large audio is chunked client-side; expect multiple sequential requests.

### Transcription history sync (session-authed)
`/api/transcriptions/{list,create,delete,batch-create,batch-delete}` — the desktop mirrors its local
transcription history to the cloud for cross-device access.

**Backend must supply:** server-side provider credentials (STT + LLM), per-user **quota metering**
(words), and an **org-policy engine** keyed by `x-pyper-policy-version` / `requestPurpose`.

---

## 5. Data model (derive from the contract)

Minimum entities (Postgres):

- **Auth:** `users`, `accounts` (OAuth links), `sessions`, `verifications`, `sso_providers` (SAML).
- **Org/enterprise:** `organizations`/`workspaces`, `members` (roles), SCIM provisioning, `policies` (versioned org policy).
- **Keys:** `api_keys` — hashed secret, `prefix` (`owk_live_` personal / `ow_wks_live_` workspace), `scopes[]`, `plan`, last-used, revoked.
- **Spaces:** `spaces` (workspace-scoped), `space_members`.
- **Content:** `notes` (`id`, `title`, `content`, `enhanced_content`, `note_type` ∈ personal|meeting|upload, `folder_id`, `space_id`, `owner_id`, timestamps, `deleted_at` soft-delete, **`embedding vector`**), `folders` (`name`, `sort_order`, `space_id`), `share_links` (for `notes.pyper.work`).
- **Transcriptions:** `text`, `word_count`, `source`, `provider`, `model`, `language`, `audio_duration_ms`, `processing_ms`.
- **Billing/usage:** `usage` (`words_used/remaining/limit`, `plan` ∈ free|pro|business, `current_period_end`, `billing_interval`, `is_subscribed`), `subscriptions` (Stripe).

**Search** = hybrid semantic + full-text → **pgvector** (embeddings) + Postgres **FTS** (`tsvector`).
Generate embeddings server-side (Vertex AI text-embeddings or OpenAI). This replaces the desktop's
*local* Qdrant + MiniLM — the cloud path is independent.

---

## 6. Recommended GCP architecture

| Concern | GCP service | Notes |
|--------|-------------|-------|
| Compute (api / auth / mcp) | **Cloud Run** (containers) | Scales to zero, native custom-domain mapping, per-service or one multi-route service. |
| Database | **Cloud SQL for PostgreSQL 16** + `pgvector` | Better Auth + all content; enable `vector` + FTS. |
| Secrets | **Secret Manager** | LLM/STT provider keys, OAuth client secrets, Better Auth secret, Stripe keys. |
| Object storage | **Cloud Storage** | Audio if persisted; Cloud Run body cap ~32 MB → signed-URL upload for large audio. |
| Rate limiting | **Memorystore (Redis)** | Per-key minute/daily windows; or Postgres-based if you prefer no Redis. |
| DNS + TLS | **Cloud DNS** zone for `pyper.work` + **Cloud Run domain mappings** (or External HTTPS LB + serverless NEGs) | Google-managed certs for `api.` `auth.` `mcp.` `notes.` |
| Web + callback pages | **Vercel or Cloud Run** for `apps/web` | Must serve `/auth/desktop-callback`, `/reset-password`, `/terms`, `/privacy`, `/contact-sales`, `/download`. |
| Shared-note viewer | small SSR route/app at `notes.pyper.work` | Read-only note by share token. |
| Billing | **Stripe** | Plans free/pro/business; usage feeds `/usage` + `/api/transcribe` quota. |
| Observability | **Cloud Logging / Monitoring / Trace** | Client already emits latency telemetry fields. |
| IaC | **Terraform** | Recommended for repeatable envs (dev/staging/prod → matches the `*-dev`/`*-staging` channels). |

Pick a primary region near your users (e.g. `us-central1`); note enterprise data-residency needs.

---

## 7. Suggested build phases

1. **Auth + accounts** — Better Auth on Cloud Run + Cloud SQL; email/pw + Google OAuth; bearer sessions; `desktop-signin` shims; `/auth/desktop-callback` + `/reset-password` in `apps/web`. → desktop sign-in works.
2. **Content + sync + public API v1 + key mgmt** — notes/folders/transcriptions CRUD, envelopes, scopes, cursor pagination, rate limits, `api/v1/keys/*`. → sync + external API.
3. **Managed inference** — `/api/reason` + `/api/transcribe` with provider keys, quota metering, org policy. → cloud STT/LLM.
4. **MCP** — `mcp.pyper.work/mcp` Streamable HTTP exposing V1 as tools.
5. **Enterprise** — workspaces, spaces, SSO/SAML, SCIM, workspace keys, versioned org policy.
6. **Sharing + billing** — note share links + `notes.pyper.work` viewer; Stripe.

---

## 8. Non-goals — do NOT build (client-side / local)

- Local transcription (`whisper.cpp`, NVIDIA Parakeet), local LLM (`llama-server`), local vector DB (Qdrant + MiniLM) — all run **on-device**.
- BYOK inference — with the user's own keys the client calls providers **directly** (`api.openai.com`, `api.anthropic.com`, Google, Groq). No backend involvement.
- Calendar OAuth (Google/Microsoft) — client-side loopback-PKCE, direct to providers (`src/helpers/oauthLoopbackFlow.js`). Backend only needed if you want to host the OAuth **client credentials** centrally.
- Desktop auto-update — `electron-updater` against GitHub Releases (see `electron-builder.json` `publish`).

---

## 9. Open decisions (confirm with the team)

- **Domain:** confirm `pyper.work` ownership + who manages the DNS zone.
- **Auth stack:** self-hosted Better Auth (recommended — the client expects its cookie/bearer + SSO semantics) vs GCP Identity Platform (would require re-implementing the client's expected endpoints).
- **API-key prefixes:** SKILL.md still documents `owk_live_` / `ow_wks_live_` (OpenWhispr-era). Decide whether to keep them or rebrand (e.g. `pyk_live_`) — if rebranded, update SKILL.md too. The client only checks for a Bearer token, so the prefix is server-defined/cosmetic.
- **Providers:** which STT for `/api/transcribe` (Deepgram / OpenAI Whisper / Google STT / Groq) and which LLMs for `/api/reason`.
- **Plans & quotas:** word limits per plan + Stripe products.
- **Region / data residency**, especially for enterprise.

---

## 10. Source-of-truth pointers (this repo)

| What | Path |
|------|------|
| Full REST v1 spec | `apps/desktop/agent-skills/pyper-api/SKILL.md` |
| CLI (also uses the API) | `apps/desktop/agent-skills/pyper-cli/SKILL.md` |
| Auth client + sign-in flows | `apps/desktop/src/lib/auth.ts` |
| Account OAuth handshake (bridge/protocol) | `apps/desktop/main.js` (`startAuthBridgeServer`, protocol handler) |
| Cloud request mechanics + `/api/reason`, `/api/transcribe`, `getApiUrl/getAuthUrl` | `apps/desktop/src/helpers/ipcHandlers.js` |
| Cloud request helper | `apps/desktop/src/helpers/cloudApiRequest.js` |
| Origin/session header handling | `apps/desktop/src/helpers/sessionHeaders.js` |
| Managed-LLM provider (client side of `/api/reason`) | `apps/desktop/src/services/ai/inferenceProviders/pyper.ts` |
| Host/URL config | `apps/desktop/src/config/brand.js`, `src/config/constants.ts`, `apps/desktop/.env.example` |
| Outbound network allowlist | `apps/desktop/docs/network-allowlist.md` |

> The whole cloud contract is reverse-engineered from the **client**, which is authoritative. When
> in doubt about a shape, grep the client for the endpoint path and read the call site.
