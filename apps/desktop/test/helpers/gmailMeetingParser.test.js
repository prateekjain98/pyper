const test = require("node:test");
const assert = require("node:assert/strict");

const { parseGmailMeeting, extractEmail } = require("../../src/helpers/gmailMeetingParser");

// Fixed clock so recency/horizon checks are deterministic.
const NOW = Date.parse("2026-08-14T15:00:00.000Z");
const icsInvite = (dtstart, extra = []) =>
  [
    "BEGIN:VCALENDAR",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    "UID:evt-123@google.com",
    "SUMMARY:Quarterly planning",
    `DTSTART:${dtstart}`,
    "DTEND:20260814T163000Z",
    "ORGANIZER;CN=Jane:mailto:jane@acme.com",
    ...extra,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

test("parses a future calendar invite into an upcoming meeting event", () => {
  const res = parseGmailMeeting(
    { id: "m1", subject: "Invitation: Quarterly planning", from: "Jane <jane@acme.com>", icsText: icsInvite("20260814T160000Z") },
    { nowMs: NOW }
  );
  assert.equal(res.type, "event");
  assert.equal(res.input.provider, "gmail");
  assert.equal(res.input.id, "gmail:evt-123@google.com"); // stable on the invite UID
  assert.equal(res.input.summary, "Quarterly planning");
  assert.equal(res.input.startIso, "2026-08-14T16:00:00.000Z");
  assert.equal(res.input.organizerEmail, "jane@acme.com");
});

test("pulls the Meet link out of the invite description as the join url", () => {
  const res = parseGmailMeeting(
    {
      id: "m2",
      subject: "Invite",
      icsText: icsInvite("20260814T160000Z", ["DESCRIPTION:Join: https://meet.google.com/abc-defg-hij"]),
    },
    { nowMs: NOW }
  );
  assert.equal(res.input.joinUrl, "https://meet.google.com/abc-defg-hij");
});

test("signals a cancel for a CANCEL invite so the manager can prune it", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "METHOD:CANCEL",
    "BEGIN:VEVENT",
    "UID:evt-123@google.com",
    "SUMMARY:Quarterly planning",
    "DTSTART:20260814T160000Z",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const res = parseGmailMeeting({ id: "m3", icsText: ics }, { nowMs: NOW });
  assert.deepEqual(res, { type: "cancel", id: "gmail:evt-123@google.com" });
});

test("skips an invite whose meeting is already over", () => {
  const pastInvite = [
    "BEGIN:VCALENDAR",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    "UID:old@google.com",
    "SUMMARY:Last week",
    "DTSTART:20260810T160000Z",
    "DTEND:20260810T170000Z", // ended days before NOW
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const res = parseGmailMeeting({ id: "m4", icsText: pastInvite }, { nowMs: NOW });
  assert.equal(res, null);
});

test("skips an all-day invite", () => {
  const ics = icsInvite("20260814T160000Z").replace("DTSTART:20260814T160000Z", "DTSTART;VALUE=DATE:20260814");
  const res = parseGmailMeeting({ id: "m5", icsText: ics }, { nowMs: NOW });
  assert.equal(res, null);
});

test("treats a fresh bare meeting link (no ICS) as a meeting starting now", () => {
  const res = parseGmailMeeting(
    {
      id: "m6",
      subject: "Jumping on Zoom now",
      from: "bob@acme.com",
      bodyText: "Come join https://acme.zoom.us/j/9876543210",
      receivedMs: NOW - 60 * 1000, // one minute ago
    },
    { nowMs: NOW }
  );
  assert.equal(res.type, "event");
  assert.equal(res.input.id, "gmail:m6");
  assert.equal(res.input.joinUrl, "https://acme.zoom.us/j/9876543210");
  assert.equal(res.input.startIso, new Date(NOW).toISOString());
});

test("ignores a stale bare link email", () => {
  const res = parseGmailMeeting(
    {
      id: "m7",
      subject: "Notes from last week's zoom",
      bodyText: "recording at https://acme.zoom.us/j/9876543210",
      receivedMs: NOW - 3 * 60 * 60 * 1000, // three hours ago
    },
    { nowMs: NOW }
  );
  assert.equal(res, null);
});

test("returns null for a non-meeting email", () => {
  assert.equal(parseGmailMeeting({ id: "m8", subject: "Lunch?", bodyText: "no link" }, { nowMs: NOW }), null);
  assert.equal(parseGmailMeeting(null), null);
});

test("extractEmail handles name + angle-bracket and bare forms", () => {
  assert.equal(extractEmail("Jane Doe <jane@acme.com>"), "jane@acme.com");
  assert.equal(extractEmail("bob@acme.com"), "bob@acme.com");
  assert.equal(extractEmail("no address here"), null);
  assert.equal(extractEmail(null), null);
});
