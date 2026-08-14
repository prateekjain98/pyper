# Google Calendar OAuth setup

The **Connect Google Calendar** button (Settings → Integrations) fails with

> Access blocked: Authorization Error — The OAuth client was not found.
> Error 401: invalid_client

when the desktop app has no Google OAuth client configured. The code is correct;
this is purely configuration. This doc is the fix.

## Why it happens

`apps/desktop/src/helpers/googleCalendarOAuth.js` reads the client credentials
from the environment:

```js
getClientId()     => process.env.GOOGLE_CALENDAR_CLIENT_ID
getClientSecret() => process.env.GOOGLE_CALENDAR_CLIENT_SECRET
```

If those are unset, the flow now **fails fast** with a clear "not configured"
error instead of opening Google with `client_id=undefined` (which produced the
`invalid_client` page and hung the loopback server for 2 minutes). Set the two
vars and the exact same code path works.

## The two Google OAuth flows (don't confuse them)

Pyper has **two independent** Google integrations, each needing its own OAuth
client:

| Flow | Purpose | Client type | Redirect URI | Where creds go |
| --- | --- | --- | --- | --- |
| **Google Calendar** (this doc) | Read calendar events | **Desktop app** | `http://127.0.0.1:<random-port>` (loopback) | `apps/desktop/.env` → `GOOGLE_CALENDAR_CLIENT_ID` / `_SECRET` |
| **Google sign-in** (Better Auth via Convex) | Log into the app with Google | **Web application** | `https://chatty-penguin-848.eu-west-1.convex.site/api/auth/callback/google` | Convex deployment env → `npx convex env set GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (see `convex/auth.ts`) |

Both clients can live in the **same** Google Cloud project.

## Steps — Google Calendar (Desktop-app client)

1. Open <https://console.cloud.google.com/> and select the **`pyper-services`**
   project (number `772208668555`) — the same project that hosts the pyai-proxy
   Cloud Run service. Both Google OAuth clients can live here.
2. **APIs & Services → Library →** enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **Internal** if the project is in the `saaslabs.co` Workspace
     (simplest — only org users, no verification, no test-user list). Use
     **External** otherwise, and add each tester's Google address under
     **Test users** while the app is in "Testing".
   - Add scopes:
     `https://www.googleapis.com/auth/calendar.events.readonly` and
     `https://www.googleapis.com/auth/calendar.calendarlist.readonly`.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - **Application type: Desktop app** ← required. The app redirects to a
     random-port `http://127.0.0.1` loopback, which only Desktop-app clients
     accept. A Web-application client will reject the loopback redirect.
   - No redirect URI needs to be entered for a Desktop-app client (Google allows
     loopback automatically).
5. Copy the **Client ID** and **Client secret** into `apps/desktop/.env`:

   ```
   GOOGLE_CALENDAR_CLIENT_ID=<client id>.apps.googleusercontent.com
   GOOGLE_CALENDAR_CLIENT_SECRET=<client secret>
   ```

6. **Restart the app** — env vars are read once at main-process startup. In dev,
   stop and re-run `npm run desktop` (from the correct worktree/checkout dir).
7. Settings → Integrations → **Connect Google Calendar**. The consent screen now
   shows Pyper (not `invalid_client`); approve it and the loopback completes.

## Packaged / release builds

Release builds inject these from CI (`.github/workflows/release.yml` and
`apps/desktop/.github/workflows/build-and-notarize.yml` already write
`GOOGLE_CALENDAR_CLIENT_ID` / `_SECRET` into `.env` from repo secrets). Set the
two repository **Actions secrets** of the same names for shipped builds to have
working calendar connect. As of this writing those secrets are **not** set, so
release builds have the same unconfigured behavior as local dev.
