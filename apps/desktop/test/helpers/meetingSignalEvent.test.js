const test = require("node:test");
const assert = require("node:assert/strict");

const { buildSignalEvent } = require("../../src/helpers/meetingSignalEvent");

test("builds a calendar_events row the DB + overlay expect", () => {
  const row = buildSignalEvent({
    provider: "gmail",
    id: "gmail:abc",
    summary: "Weekly Sync",
    startIso: "2026-08-14T15:30:00.000Z",
    endIso: "2026-08-14T16:00:00.000Z",
    joinUrl: "https://meet.google.com/abc-defg-hij",
    organizerEmail: "jane@acme.com",
    attendeesCount: 4,
  });
  assert.equal(row.id, "gmail:abc");
  assert.equal(row.calendar_id, "gmail");
  assert.equal(row.provider, "gmail");
  assert.equal(row.summary, "Weekly Sync");
  assert.equal(row.is_all_day, 0); // required so getUpcomingEvents includes it
  assert.equal(row.status, "confirmed"); // required for getUpcoming/active
  assert.equal(row.hangout_link, "https://meet.google.com/abc-defg-hij"); // getMeetingJoinUrl reads this
  assert.equal(row.start_time, "2026-08-14T15:30:00.000Z");
  assert.equal(row.end_time, "2026-08-14T16:00:00.000Z");
  assert.equal(row.organizer_email, "jane@acme.com");
  assert.equal(row.attendees_count, 4);
});

test("defaults a missing end to one hour after start", () => {
  const row = buildSignalEvent({
    provider: "slack",
    id: "slack:C1:1",
    startIso: "2026-08-14T15:30:00.000Z",
  });
  assert.equal(row.end_time, "2026-08-14T16:30:00.000Z");
  assert.equal(row.summary, "Slack huddle"); // provider default
});

test("clamps an end that is not after start to start + 1h", () => {
  const row = buildSignalEvent({
    provider: "gmail",
    id: "g:1",
    startIso: "2026-08-14T15:30:00.000Z",
    endIso: "2026-08-14T15:00:00.000Z", // before start
  });
  assert.equal(row.end_time, "2026-08-14T16:30:00.000Z");
});

test("lowercases status and preserves cancelled", () => {
  assert.equal(
    buildSignalEvent({ provider: "gmail", id: "g", startIso: "2026-08-14T15:30:00.000Z", status: "CONFIRMED" })
      .status,
    "confirmed"
  );
  assert.equal(
    buildSignalEvent({ provider: "gmail", id: "g", startIso: "2026-08-14T15:30:00.000Z", status: "CANCELLED" })
      .status,
    "cancelled"
  );
});

test("returns null for unusable input", () => {
  assert.equal(buildSignalEvent(), null);
  assert.equal(buildSignalEvent({ provider: "gmail", id: "x" }), null); // no start
  assert.equal(buildSignalEvent({ provider: "gmail", startIso: "2026-08-14T15:30:00Z" }), null); // no id
  assert.equal(buildSignalEvent({ id: "x", startIso: "2026-08-14T15:30:00Z" }), null); // no provider
  assert.equal(
    buildSignalEvent({ provider: "gmail", id: "x", startIso: "not-a-date" }),
    null
  );
});
