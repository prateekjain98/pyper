const { net } = require("electron");
const { runOAuthLoopbackFlow, OAuthFlowError } = require("./oauthLoopbackFlow");

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_SCOPE =
  "openid email https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/calendar.calendarlist.readonly";

// A credential counts as "set" only when it's a non-empty, non-placeholder
// string. `.env.example` ships literal placeholders (e.g. the .apps.google-
// usercontent.com hint below) — treat those as unset so a half-copied .env
// doesn't look configured.
function hasRealCredential(value) {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) return false;
  const lower = v.toLowerCase();
  return !lower.startsWith("your_") && !lower.endsWith("_here") && v !== "changeme";
}

class GoogleCalendarOAuth {
  constructor(databaseManager) {
    this.databaseManager = databaseManager;
  }

  getClientId() {
    return process.env.GOOGLE_CALENDAR_CLIENT_ID;
  }

  getClientSecret() {
    return process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  }

  // Both OAuth creds must be present for the flow to work. When they're missing
  // (local dev without a .env, or a release built without the CI secrets),
  // starting anyway just opened Google with `client_id=undefined` — the user
  // landed on Google's opaque "invalid_client / OAuth client was not found"
  // page while the loopback server hung for the full 2-minute timeout.
  isConfigured() {
    return hasRealCredential(this.getClientId()) && hasRealCredential(this.getClientSecret());
  }

  startOAuthFlow() {
    if (!this.isConfigured()) {
      return Promise.reject(
        new OAuthFlowError(
          "not_configured",
          "Google Calendar is not configured on this build. Set GOOGLE_CALENDAR_CLIENT_ID and " +
            "GOOGLE_CALENDAR_CLIENT_SECRET (from a Google Cloud 'Desktop app' OAuth client) in " +
            "apps/desktop/.env, then restart the app. See docs/google-calendar-oauth-setup.md."
        )
      );
    }
    return runOAuthLoopbackFlow({
      errorParam: "gcal_error",
      buildAuthUrl: (redirectUri, state, codeChallenge) => {
        const params = new URLSearchParams({
          client_id: this.getClientId(),
          redirect_uri: redirectUri,
          response_type: "code",
          scope: CALENDAR_SCOPE,
          access_type: "offline",
          prompt: "consent",
          state,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
        });
        return `${GOOGLE_AUTH_URL}?${params.toString()}`;
      },
      handleCallback: async (code, redirectUri, codeVerifier) => {
        const tokenData = await this.exchangeCodeForTokens(code, redirectUri, codeVerifier);

        if (tokenData.error) {
          throw new OAuthFlowError(
            "token_exchange_failed",
            `Token exchange failed: ${tokenData.error_description || tokenData.error}`
          );
        }

        let email = null;
        if (tokenData.id_token) {
          try {
            const payload = JSON.parse(
              Buffer.from(tokenData.id_token.split(".")[1], "base64url").toString()
            );
            email = payload.email;
          } catch {}
        }

        if (!email) {
          throw new OAuthFlowError(
            "no_email",
            "Could not extract email from Google OAuth response"
          );
        }

        this.databaseManager.saveGoogleTokens({
          google_email: email,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: Date.now() + tokenData.expires_in * 1000,
          scope: tokenData.scope || CALENDAR_SCOPE,
        });

        return { success: true, email };
      },
    });
  }

  async exchangeCodeForTokens(code, redirectUri, codeVerifier) {
    const body = new URLSearchParams({
      code,
      client_id: this.getClientId(),
      client_secret: this.getClientSecret(),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }).toString();

    return this._httpsPost(GOOGLE_TOKEN_URL, body);
  }

  async refreshAccessToken(refreshToken) {
    const body = new URLSearchParams({
      client_id: this.getClientId(),
      client_secret: this.getClientSecret(),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString();

    return this._httpsPost(GOOGLE_TOKEN_URL, body);
  }

  async getValidAccessToken(accountEmail = null) {
    const tokens = accountEmail
      ? this.databaseManager.getGoogleTokensByEmail(accountEmail)
      : this.databaseManager.getGoogleTokens();
    if (!tokens)
      throw new Error(`No Google tokens found${accountEmail ? ` for ${accountEmail}` : ""}`);

    const fiveMinutes = 5 * 60 * 1000;
    if (tokens.expires_at - fiveMinutes < Date.now()) {
      const refreshed = await this.refreshAccessToken(tokens.refresh_token);
      if (refreshed.error) {
        throw new Error(`Token refresh failed: ${refreshed.error_description || refreshed.error}`);
      }

      const newExpiresAt = Date.now() + refreshed.expires_in * 1000;
      this.databaseManager.saveGoogleTokens({
        google_email: tokens.google_email,
        access_token: refreshed.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: newExpiresAt,
        scope: tokens.scope,
      });

      return refreshed.access_token;
    }

    return tokens.access_token;
  }

  async revokeToken(token) {
    const body = new URLSearchParams({ token }).toString();
    try {
      await this._httpsPost("https://oauth2.googleapis.com/revoke", body);
    } catch {
      // Best-effort — token may already be revoked or network unavailable
    }
  }

  async _httpsPost(urlString, body) {
    const response = await net.fetch(urlString, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10000),
      useSessionCookies: false,
    });
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`);
    }
  }
}

module.exports = GoogleCalendarOAuth;
