// Detect live huddles / meetings from Slack. Slack exposes no reliable
// "huddle started" event to third-party apps, so the tractable signal is recent
// messages carrying a huddle/meeting link or a "started a huddle" system notice.
// Matches are written into `calendar_events` as provider="slack" rows starting
// "now", so the detection overlay and Upcoming Meetings list surface them
// immediately — reusing the same pipeline as calendars.
//
// Opt-in: it reuses the Slack token the user already connected for posting notes,
// but only polls when meeting detection is explicitly enabled (a Slack grant for
// outbound posting must not silently start reading the user's messages).
//
// search.messages requires a Slack *user* token (xoxp-). A bot token (xoxb-)
// cannot search; that limitation is surfaced once and then the detector idles.
const { net } = require("electron");
const debugLogger = require("./debugLogger");
const { broadcastToWindows } = require("./windowBroadcast");
const { parseSlackMeeting } = require("./slackMeetingParser");
const { buildSignalEvent } = require("./meetingSignalEvent");

const SEARCH_URL = "https://slack.com/api/search.messages";
const MAX_MATCHES = 20;

class SlackMeetingDetector {
  // getToken: () => string|null — reads the live Slack token from the env manager.
  constructor(databaseManager, reminderScheduler, getToken) {
    this.databaseManager = databaseManager;
    this.reminderScheduler = reminderScheduler;
    this.getToken = getToken;
    this.enabled = false;
    this._warnedTokenType = false;
  }

  setEnabled(enabled) {
    const next = !!enabled;
    if (next === this.enabled) return;
    this.enabled = next;
    debugLogger.info("Slack meeting detection toggled", { enabled: next }, "slack");
    if (next) {
      this.poll().catch(() => {});
    } else {
      // Disabling clears the provider's rows so nothing lingers in the UI.
      this.databaseManager.clearProviderCalendarEvents("slack");
      this.reminderScheduler.reset("slack");
      this.reminderScheduler.scheduleNextMeeting();
      broadcastToWindows("slack-events-synced", {});
    }
  }

  isConnected() {
    return this.enabled && !!this.getToken();
  }

  getStatus() {
    const token = this.getToken();
    return {
      enabled: this.enabled,
      hasToken: !!token,
      // Only a user token (xoxp-) can search; flag bot tokens so the UI can warn.
      canSearch: !!token && /^xoxp-/.test(token),
    };
  }

  // One detection cycle. Never throws.
  async poll() {
    if (!this.isConnected()) return { success: false, reason: "disabled" };
    const token = this.getToken();
    try {
      const after = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const query = `(zoom.us OR meet.google.com OR teams.microsoft.com OR webex.com OR huddle) after:${after}`;
      const url = `${SEARCH_URL}?query=${encodeURIComponent(query)}&count=${MAX_MATCHES}&sort=timestamp`;

      const response = await net.fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
        useSessionCookies: false,
      });
      const data = await response.json().catch(() => null);

      if (!data || !data.ok) {
        const error = data?.error || `HTTP ${response.status}`;
        if (error === "not_allowed_token_type" && !this._warnedTokenType) {
          this._warnedTokenType = true;
          debugLogger.warn(
            "Slack meeting detection needs a user token (xoxp-) with search:read — bot tokens can't search",
            {},
            "slack"
          );
        } else if (error !== "not_allowed_token_type") {
          debugLogger.error("Slack search failed", { error }, "slack");
        }
        return { success: false, error };
      }

      const now = Date.now();
      const matches = data.messages?.matches || [];
      const freshIds = [];
      const toUpsert = [];

      for (const match of matches) {
        const parsed = parseSlackMeeting(
          {
            ts: match.ts,
            text: match.text,
            permalink: match.permalink,
            channelId: match.channel?.id,
            channelName: match.channel?.name,
            blocks: match.blocks,
          },
          { nowMs: now }
        );
        if (!parsed) continue;
        const row = buildSignalEvent(parsed.input);
        if (row) {
          toUpsert.push(row);
          freshIds.push(row.id);
        }
      }

      if (toUpsert.length) this.databaseManager.upsertCalendarEvents(toUpsert);
      this.databaseManager.removeStaleCalendarEvents("slack", "slack", freshIds);

      debugLogger.info("Slack meeting sync", { found: toUpsert.length }, "slack");
      this.reminderScheduler.scheduleNextMeeting();
      broadcastToWindows("slack-events-synced", {});
      return { success: true, found: toUpsert.length };
    } catch (err) {
      debugLogger.error("Slack meeting poll failed", { error: err?.message }, "slack");
      return { success: false, error: err?.message };
    }
  }
}

module.exports = SlackMeetingDetector;
