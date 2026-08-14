const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

// End-to-end against the REAL ConvexDatabaseManager (LocalStore runs in
// memory-only mode under node) to prove a Slack/Gmail-detected meeting, built by
// buildSignalEvent, actually passes the real getUpcomingEvents / getActiveEvents
// filters that the Upcoming Meetings UI and the reminder scheduler read. The
// Convex client is stubbed — only the local calendar_events table is exercised.
const dbPath = require.resolve("../../src/helpers/convexDatabaseManager");
const originalLoad = Module._load;

function loadDatabaseManager() {
  delete require.cache[dbPath];
  Module._load = function loadWithMocks(request, parent, isMain) {
    if (request === "./convexdb/client") {
      return { getConvexClient: () => ({ query: async () => [], mutation: async () => ({}) }) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(dbPath);
  } finally {
    Module._load = originalLoad;
  }
}

const { buildSignalEvent } = require("../../src/helpers/meetingSignalEvent");

test("gmail + slack signal rows surface through the real calendar_events queries", () => {
  const ConvexDatabaseManager = loadDatabaseManager();
  const db = new ConvexDatabaseManager();
  const now = Date.now();

  const upcomingGmail = buildSignalEvent({
    provider: "gmail",
    id: "gmail:int-1",
    summary: "Quarterly planning",
    startIso: new Date(now + 3 * 60 * 1000).toISOString(),
    endIso: new Date(now + 33 * 60 * 1000).toISOString(),
    joinUrl: "https://meet.google.com/abc-defg-hij",
  });
  const liveHuddle = buildSignalEvent({
    provider: "slack",
    id: "slack:int-2",
    summary: "Huddle in #eng",
    startIso: new Date(now - 60 * 1000).toISOString(),
    endIso: new Date(now + 30 * 60 * 1000).toISOString(),
  });

  db.upsertCalendarEvents([upcomingGmail, liveHuddle]);

  const upcomingIds = db.getUpcomingEvents(1440).map((e) => e.id);
  assert.ok(upcomingIds.includes("gmail:int-1"), "future gmail invite is upcoming");
  assert.ok(upcomingIds.includes("slack:int-2"), "live huddle is upcoming (underway)");

  const activeIds = db.getActiveEvents().map((e) => e.id);
  assert.deepEqual(activeIds, ["slack:int-2"], "only the now-huddle is active");

  // The overlay/Upcoming Join action reads hangout_link via getMeetingJoinUrl.
  assert.equal(
    db.getCalendarEventById("gmail:int-1").hangout_link,
    "https://meet.google.com/abc-defg-hij"
  );
});

test("removeStaleCalendarEvents prunes only the given provider", () => {
  const ConvexDatabaseManager = loadDatabaseManager();
  const db = new ConvexDatabaseManager();
  const now = Date.now();

  db.upsertCalendarEvents([
    buildSignalEvent({ provider: "gmail", id: "gmail:a", startIso: new Date(now + 60000).toISOString() }),
    buildSignalEvent({ provider: "slack", id: "slack:b", startIso: new Date(now - 1000).toISOString() }),
  ]);

  // A later poll returns no gmail rows → gmail pruned, slack untouched.
  db.removeStaleCalendarEvents("gmail", "gmail", []);
  const ids = db.getUpcomingEvents(1440).map((e) => e.id);
  assert.ok(!ids.includes("gmail:a"), "stale gmail row pruned");
  assert.ok(ids.includes("slack:b"), "slack row retained");
});

test("an all-day row would NOT surface (guards against bad signal rows)", () => {
  const ConvexDatabaseManager = loadDatabaseManager();
  const db = new ConvexDatabaseManager();
  const now = Date.now();
  // Directly write an all-day row (buildSignalEvent never does this) to confirm
  // the filter the pipeline relies on.
  db.upsertCalendarEvents([
    {
      id: "gmail:allday",
      calendar_id: "gmail",
      provider: "gmail",
      summary: "Holiday",
      start_time: new Date(now + 60000).toISOString(),
      end_time: new Date(now + 3600000).toISOString(),
      is_all_day: 1,
      status: "confirmed",
    },
  ]);
  assert.ok(!db.getUpcomingEvents(1440).some((e) => e.id === "gmail:allday"));
});
