const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const mgrPath = require.resolve("../../src/helpers/meetingSignalManager");
const originalLoad = Module._load;

const broadcasts = [];

function loadManager() {
  delete require.cache[mgrPath];
  Module._load = function loadWithMocks(request, parent, isMain) {
    if (request === "electron") return {};
    if (request === "./debugLogger") return { info() {}, warn() {}, debug() {}, error() {} };
    if (request === "./windowBroadcast") {
      return { broadcastToWindows: (channel, data) => broadcasts.push({ channel, data }) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(mgrPath);
  } finally {
    Module._load = originalLoad;
  }
}

function makeManager() {
  broadcasts.length = 0;
  const upserted = [];
  const scheduleCalls = { count: 0 };
  const reminders = [];

  const databaseManager = {
    getGmailTokens: () => null, // gmail not connected → poll() self-gates
    getGmailAccount: () => null,
    upsertCalendarEvents: (rows) => upserted.push(...rows),
    removeStaleCalendarEvents: () => {},
    removeCalendarEvents: () => {},
    clearProviderCalendarEvents: () => {},
  };
  const reminderScheduler = {
    scheduleNextMeeting: () => scheduleCalls.count++,
    reset: () => {},
  };
  const meetingDetectionEngine = {
    handleCalendarReminder: (event) => reminders.push(event),
  };
  const environmentManager = { getSlackBotToken: () => null };

  const MeetingSignalManager = loadManager();
  const mgr = new MeetingSignalManager({
    databaseManager,
    reminderScheduler,
    meetingDetectionEngine,
    environmentManager,
  });
  return { mgr, upserted, scheduleCalls, reminders };
}

test("injectTestMeeting('slack') writes an active huddle row and fires the overlay", () => {
  const { mgr, upserted, scheduleCalls, reminders } = makeManager();
  const res = mgr.injectTestMeeting({ provider: "slack" });

  assert.equal(res.success, true);
  assert.equal(upserted.length, 1);
  const row = upserted[0];
  assert.equal(row.provider, "slack");
  assert.equal(row.calendar_id, "slack");
  assert.equal(row.is_all_day, 0);
  assert.equal(row.status, "confirmed");
  assert.ok(row.hangout_link.startsWith("https://app.slack.com/huddle/"));

  // Happening now → overlay fired directly + scheduler armed + UI notified.
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].id, row.id);
  assert.equal(scheduleCalls.count, 1);
  assert.ok(broadcasts.some((b) => b.channel === "slack-events-synced"));
});

test("injectTestMeeting with a future start arms the scheduler but does not fire immediately", () => {
  const { mgr, upserted, scheduleCalls, reminders } = makeManager();
  const res = mgr.injectTestMeeting({ provider: "gmail", minutesUntilStart: 10 });

  assert.equal(res.success, true);
  assert.equal(upserted[0].provider, "gmail");
  assert.equal(reminders.length, 0); // 10 min out → not within the 60s reminder lead
  assert.equal(scheduleCalls.count, 1); // scheduler still (re)armed
  assert.ok(broadcasts.some((b) => b.channel === "gmail-events-synced"));
});

test("getStatus reports gmail + slack sub-states", () => {
  const { mgr } = makeManager();
  const status = mgr.getStatus();
  assert.equal(status.gmail.connected, false);
  assert.equal(status.slack.enabled, false);
  assert.equal(status.slack.hasToken, false);
});

test("setSlackDetectionEnabled toggles the detector", () => {
  const { mgr } = makeManager();
  const status = mgr.setSlackDetectionEnabled(true);
  assert.equal(status.slack.enabled, true);
});
