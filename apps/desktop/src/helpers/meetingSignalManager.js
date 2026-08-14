// Coordinates the non-calendar meeting-signal sources — Gmail and Slack — that
// feed the existing meeting pipeline. Both write detected meetings into
// `calendar_events` (provider="gmail"/"slack"), which the reminder scheduler,
// the detection overlay, and the Upcoming Meetings list already consume. This
// class just owns the shared poll cadence, exposes connect/enable passthroughs
// for IPC, and provides a dev trigger to exercise the whole pipeline without a
// live account.
const debugLogger = require("./debugLogger");
const { broadcastToWindows } = require("./windowBroadcast");
const GmailMeetingManager = require("./gmailMeetingManager");
const SlackMeetingDetector = require("./slackMeetingDetector");
const { buildSignalEvent } = require("./meetingSignalEvent");

const POLL_INTERVAL_MS = 2 * 60 * 1000;

class MeetingSignalManager {
  constructor({ databaseManager, reminderScheduler, meetingDetectionEngine, environmentManager }) {
    this.databaseManager = databaseManager;
    this.reminderScheduler = reminderScheduler;
    this.meetingDetectionEngine = meetingDetectionEngine;
    this.environmentManager = environmentManager;
    this.pollTimer = null;

    this.gmail = new GmailMeetingManager(databaseManager, reminderScheduler);
    this.slack = new SlackMeetingDetector(databaseManager, reminderScheduler, () =>
      environmentManager?.getSlackBotToken?.()
    );
  }

  start() {
    if (this.pollTimer) return;
    debugLogger.info("Meeting signal manager started", {}, "meeting");
    // Kick an immediate cycle, then poll on a fixed cadence. Each source
    // self-gates on whether it is connected/enabled, so this is cheap when idle.
    this.pollAll();
    this.pollTimer = setInterval(() => this.pollAll(), POLL_INTERVAL_MS);
    if (this.pollTimer.unref) this.pollTimer.unref();
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async pollAll() {
    await Promise.allSettled([this.gmail.poll(), this.slack.poll()]);
  }

  // Re-poll now (e.g. on window focus / wake) — best-effort.
  syncNow() {
    this.pollAll().catch(() => {});
  }

  // ── Gmail passthrough (OAuth-based connect) ──
  startGmailOAuth() {
    return this.gmail.startOAuth();
  }
  disconnectGmail() {
    return this.gmail.disconnect();
  }

  // ── Slack passthrough (token reused, detection opt-in) ──
  setSlackDetectionEnabled(enabled) {
    this.slack.setEnabled(enabled);
    return this.getStatus();
  }

  getStatus() {
    return { gmail: this.gmail.getStatus(), slack: this.slack.getStatus() };
  }

  // Dev/test trigger: inject a synthetic detected meeting so the full pipeline
  // (calendar_events → scheduler → overlay → note) can be exercised without a
  // connected Gmail/Slack account. `minutesUntilStart` 0 = a meeting happening
  // now (overlay fires immediately); a small positive value demos the
  // "starting soon" reminder path.
  injectTestMeeting(opts = {}) {
    const provider = opts.provider === "slack" ? "slack" : "gmail";
    const minutes = Number(opts.minutesUntilStart) || 0;
    const startMs = Date.now() + minutes * 60 * 1000;

    const row = buildSignalEvent({
      provider,
      id: `${provider}:test-${startMs}`,
      summary:
        opts.summary ||
        (provider === "slack" ? "Huddle in #demo (test)" : "Product sync (test invite)"),
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(startMs + 30 * 60 * 1000).toISOString(),
      joinUrl:
        provider === "slack"
          ? "https://app.slack.com/huddle/TESTWS/TESTCH"
          : "https://meet.google.com/tst-demo-cal",
    });
    if (!row) return { success: false, error: "could not build test event" };

    this.databaseManager.upsertCalendarEvents([row]);
    broadcastToWindows(`${provider}-events-synced`, {});

    // If it is happening now / within the reminder lead, show the overlay
    // straight away; otherwise let the scheduler arm it for its start time.
    const leadMs = 60 * 1000;
    if (startMs - Date.now() <= leadMs) {
      this.meetingDetectionEngine?.handleCalendarReminder(row);
    }
    this.reminderScheduler.scheduleNextMeeting();

    debugLogger.info("Injected test meeting", { provider, id: row.id, startMs }, "meeting");
    return { success: true, event: row };
  }
}

module.exports = MeetingSignalManager;
