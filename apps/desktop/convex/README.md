# Convex sync backend (replaces `pyper-api` data plane)

This directory reimplements Pyper's **cloud sync backend** on Convex. The
desktop app's **local SQLite stays** (offline + privacy-first intact); only the
remote sync target moves from `pyper-api` (REST) to Convex.

> Status: **foundation / proof-of-architecture.** `notes` is fully ported as the
> reference entity; the auth bridge and full schema are in place. Everything
> else is stubbed (HTTP 501) and tracked in the checklist below. **None of this
> has been run through `npx convex dev` yet** — do that first to generate
> `convex/_generated/` and typecheck.

## Architecture decision: HTTP actions that mirror the REST contract

The desktop already contains a sophisticated, battle-tested sync engine
(`src/services/SyncService.ts`, ~2,660 lines: cursor-delta pagination, atomic
snapshot acks, optimistic-concurrency conflict handling, tombstones, team
scoping). To avoid rewriting that, Convex exposes **HTTP actions on the exact
same paths and JSON shapes** as `pyper-api` (`/api/notes/create`, `/list`, …).
The desktop transport then only needs to (a) point sync paths at the Convex
`.convex.site` URL and (b) send a better-auth **JWT** instead of the opaque
bearer. The proven client logic is untouched.

Wire contract reproduced (from `src/helpers/cloudApiRequest.js`,
`src/services/cloudApi.ts`, `NotesService.ts`):

- Success → **bare** JSON body (`create`→`CloudNote`, `list`→`{notes:[]}`,
  `batch-create`→`{created:[]}`). The transport wraps it as `{success, data}`.
- Error → `{ error: { message }, code, data }`; `409` conflicts carry
  `{ code:"note_version_conflict", data:{ note } }`; any `401` → `AUTH_EXPIRED`.

## Auth bridge (better-auth → Convex)

better-auth stays the identity provider. Convex only **verifies** its JWTs via
JWKS. Three coordinated changes:

1. **`auth.pyper.work` server repo (NOT in this repo)** — enable the better-auth
   **JWT plugin**, and because Convex's `customJwt` only accepts **RS256/ES256**,
   override the EdDSA default:
   ```ts
   import { jwt } from "better-auth/plugins";
   jwt({
     jwks: { keyPairConfig: { alg: "ES256" } },
     jwt: { issuer: "https://auth.pyper.work", audience: "convex", expirationTime: "1h" },
   })
   ```
   This exposes `GET /api/auth/jwks` and `GET /api/auth/token` (session → signed JWT).

2. **`convex/auth.config.ts`** (here) — a `customJwt` provider pointing at that
   issuer + JWKS. Set as Convex **deployment** env vars:
   ```
   npx convex env set BETTER_AUTH_ISSUER https://auth.pyper.work
   # applicationID is hardcoded to "convex" in auth.config.ts (must match the
   # better-auth jwt.audience) — no extra env var needed.
   ```

3. **Desktop main process** — mint a JWT and attach it to Convex calls. The app
   holds an opaque better-auth session/bearer in `tokenStore.js`; exchange it for
   a JWT via `GET {AUTH_URL}/api/auth/token` (cache it; **15-min–1-h expiry**,
   re-mint on 401), then send it as `Authorization: Bearer <jwt>` to Convex.
   Convex populates `ctx.auth.getUserIdentity()` and `subject` = the user id.

## Runbook

From `apps/desktop/` (install already done: `convex@^1.43.0`):

```bash
# 1. Interactive: log in + create the DEV deployment, generate convex/_generated, typecheck.
npx convex dev

# 2. Point Convex at the better-auth JWKS (dev deployment).
npx convex env set BETTER_AUTH_ISSUER https://auth.pyper.work
npx convex env set CONVEX_AUTH_APPLICATION_ID convex

# 3. Desktop reads the deployment's HTTP URL from .env.local (VITE_CONVEX_URL);
#    the sync transport targets the sibling <deployment>.convex.site origin.
```

Production is the **last** step, never the first: `npx convex deploy` (driven by
`CONVEX_DEPLOY_KEY` set in your CI/dashboard, not pasted into code or chat).
Secrets (`BETTER_AUTH_SECRET`, deploy keys) live only in the Convex dashboard env.

## Desktop transport change (planned — not yet applied)

`src/helpers/cloudApiRequest.js` currently sends **every** `/api/*` call to
`PYPER_API_URL` with the opaque bearer. Only the **sync** paths move to Convex;
compute/billing (`/api/transcribe`, `/api/reason`, `/api/agent/*`, streaming
tokens, `/api/stripe/*`, `/api/usage`) **stay on `pyper-api`**. Plan: route by
path prefix — sync prefixes → `CONVEX_SITE_URL` + JWT; everything else unchanged.

## Entity checklist (parity with pyper-api data plane)

| Entity | Endpoints | Status |
|---|---|---|
| **notes** | create, batch-create, update, delete, delete-all, list, search | ✅ ported (search = 501 TODO) |
| folders | create, batch-create, update, delete, list | ⬜ 501 — replicate notes pattern (+ `folder_name_taken` 409) |
| transcriptions | create, batch-create, list, delete, batch-delete | ⬜ 501 |
| dictionary | batch-create, update, delete, list | ⬜ 501 |
| snippets | batch-create, update, delete, list | ⬜ 501 (trigger ≤ 100 chars) |
| conversations | create, update, delete, list, messages, search | ⬜ 501 (+ child messages table) |
| **teams/spaces** | `/api/me/spaces`, spaces/teams/members/workspaces/invitations/sharing | ⬜ empty roster stub — **large second phase** |

## Fidelity caveats — needs the `pyper-api` server source to verify

The wire *shapes* are reconstructed from the desktop client, but server
*business logic* is inferred and must be checked against the real `pyper-api`:

- Exact conflict trigger conditions and 409 body for `note_version_conflict` /
  `folder_name_taken`.
- `access_removed` redacted stubs + `previous_space_id` semantics on pull.
- Team/space ACL, roles, membership, invitations, note sharing — the whole
  second phase.
- `search` ranking/scoring.
- Pagination tie-breaker: the desktop sends `since_id`/`before_id` because SQLite
  timestamps are second-precision. Convex generates `updated_at` at **ms**
  precision, so collisions are ~nil and the current implementation ignores the
  id tie-breaker. Confirm this holds under bulk backfill before removing it.

**To close these, add the `pyper-api` repo to the workspace.** Without it, the
ported code is a faithful-as-possible approximation, not a verified match.
