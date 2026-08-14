// Detect upcoming meetings from Gmail. Polls recent mail for calendar invites
// (their ICS carries the real start time) and fresh meeting links, then writes
// them into the shared `calendar_events` store as provider="gmail" rows — so the
// reminder scheduler, the detection overlay, and the Upcoming Meetings list
// surface them exactly like a synced calendar, with no changes to that pipeline.
//
// All work is best-effort: no Gmail grant, an API error, or a bad message never
// throws into the caller — detection just yields nothing that cycle.
const { net } = require("electron");
const debugLogger = require("./debugLogger");
const GmailOAuth = require("./gmailOAuth");
const { broadcastToWindows } = require("./windowBroadcast");
const { parseGmailMeeting } = require("./gmailMeetingParser");
const { buildSignalEvent } = require("./meetingSignalEvent");

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_MESSAGES = 25;
// Gmail search: invites (ICS attachment) or a message mentioning a known vendor,
// within the last two days. Broad on purpose; the parser does the real filtering.
const SEARCH_QUERY =
  "newer_than:2d (filename:ics OR zoom.us OR meet.google.com OR teams.microsoft.com OR webex.com OR chime.aws)";

class GmailMeetingManager {
  constructor(databaseManager, reminderScheduler) {
    this.databaseManager = databaseManager;
    this.reminderScheduler = reminderScheduler;
    this.oauth = new GmailOAuth(databaseManager);
  }

  isConnected() {
    return !!this.databaseManager.getGmailTokens();
  }

  getStatus() {
    const account = this.databaseManager.getGmailAccount();
    return {
      connected: !!account,
      email: account?.email || null,
      configured: this.oauth.isConfigured(),
    };
  }

  async startOAuth() {
    const result = await this.oauth.startOAuthFlow();
    this._broadcastConnectionChanged();
    // Populate immediately so the UI lights up without waiting for the interval.
    this.poll().catch(() => {});
    return result;
  }

  async disconnect() {
    try {
      const tokens = this.databaseManager.getGmailTokens();
      if (tokens) await this.oauth.revokeToken(tokens.access_token);
    } catch (err) {
      debugLogger.error("Gmail token revoke failed", { error: err?.message }, "gmail");
    }
    this.databaseManager.clearGmailData();
    this.reminderScheduler.reset("gmail");
    this.reminderScheduler.scheduleNextMeeting();
    this._broadcastConnectionChanged();
    broadcastToWindows("gmail-events-synced", {});
    return { success: true };
  }

  // One detection cycle. Never throws.
  async poll() {
    if (!this.isConnected()) return { success: false, reason: "not_connected" };
    try {
      const list = await this._apiGet(
        `/messages?q=${encodeURIComponent(SEARCH_QUERY)}&maxResults=${MAX_MESSAGES}`
      );
      const ids = (list.messages || []).map((m) => m.id);
      if (ids.length === 0) {
        this.databaseManager.removeStaleCalendarEvents("gmail", "gmail", []);
        this._afterSync();
        return { success: true, found: 0 };
      }

      const now = Date.now();
      const freshIds = [];
      const cancelIds = [];
      const toUpsert = [];

      for (const id of ids) {
        try {
          const full = await this._apiGet(`/messages/${id}?format=full`);
          const decoded = decodeGmailMessage(full);
          const parsed = parseGmailMeeting({ id, ...decoded }, { nowMs: now });
          if (!parsed) continue;
          if (parsed.type === "cancel") {
            cancelIds.push(parsed.id);
            continue;
          }
          const row = buildSignalEvent(parsed.input);
          if (row) {
            toUpsert.push(row);
            freshIds.push(row.id);
          }
        } catch (err) {
          debugLogger.debug("Gmail message parse skipped", { id, error: err?.message }, "gmail");
        }
      }

      if (cancelIds.length) this.databaseManager.removeCalendarEvents(cancelIds);
      if (toUpsert.length) this.databaseManager.upsertCalendarEvents(toUpsert);
      // Prune gmail rows we no longer see (keeps note-linked ones).
      this.databaseManager.removeStaleCalendarEvents("gmail", "gmail", freshIds);

      debugLogger.info("Gmail meeting sync", { found: toUpsert.length, cancelled: cancelIds.length }, "gmail");
      this._afterSync();
      return { success: true, found: toUpsert.length };
    } catch (err) {
      debugLogger.error("Gmail meeting poll failed", { error: err?.message }, "gmail");
      return { success: false, error: err?.message };
    }
  }

  _afterSync() {
    this.reminderScheduler.scheduleNextMeeting();
    broadcastToWindows("gmail-events-synced", {});
  }

  _broadcastConnectionChanged() {
    broadcastToWindows("gmail-connection-changed", { status: this.getStatus() });
  }

  async _apiGet(path) {
    const accessToken = await this.oauth.getValidAccessToken();
    const response = await net.fetch(`${GMAIL_API_BASE}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
      useSessionCookies: false,
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* surfaced as a status error below */
    }
    if (response.status >= 400) {
      const err = new Error(parsed?.error?.message || `Gmail API error ${response.status}`);
      err.statusCode = response.status;
      throw err;
    }
    if (parsed === null) throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`);
    return parsed;
  }
}

// ─── Gmail MIME decoding (module-scope, pure) ─────────────────────────────────

function decodeBase64Url(data) {
  if (!data) return "";
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function stripHtml(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Flatten a Gmail message payload into { subject, from, icsText, bodyText, receivedMs }.
function decodeGmailMessage(message) {
  const payload = message.payload || {};
  const headers = {};
  for (const h of payload.headers || []) headers[(h.name || "").toLowerCase()] = h.value;

  let icsText = null;
  let plain = null;
  let html = null;

  const walk = (part) => {
    if (!part) return;
    const mime = (part.mimeType || "").toLowerCase();
    const data = part.body?.data;
    if (data) {
      if ((mime === "text/calendar" || mime === "application/ics") && !icsText) {
        icsText = decodeBase64Url(data);
      } else if (/\.ics$/i.test(part.filename || "") && !icsText) {
        icsText = decodeBase64Url(data);
      } else if (mime === "text/plain" && !plain) {
        plain = decodeBase64Url(data);
      } else if (mime === "text/html" && !html) {
        html = decodeBase64Url(data);
      }
    }
    for (const p of part.parts || []) walk(p);
  };
  walk(payload);

  const receivedMs =
    Number(message.internalDate) || (headers.date ? Date.parse(headers.date) : null) || null;

  return {
    subject: headers.subject || "",
    from: headers.from || "",
    icsText,
    bodyText: plain || (html ? stripHtml(html) : ""),
    receivedMs: Number.isNaN(receivedMs) ? null : receivedMs,
  };
}

module.exports = GmailMeetingManager;
module.exports.decodeGmailMessage = decodeGmailMessage;
