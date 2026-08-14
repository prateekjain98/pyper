const test = require("node:test");
const assert = require("node:assert/strict");

const { parseIcsEvent } = require("../../src/helpers/icsParser");

const wrap = (lines) =>
  ["BEGIN:VCALENDAR", "METHOD:REQUEST", "BEGIN:VEVENT", ...lines, "END:VEVENT", "END:VCALENDAR"].join(
    "\r\n"
  );

test("parses a UTC DTSTART to an exact instant", () => {
  const ev = parseIcsEvent(
    wrap(["UID:abc@google.com", "SUMMARY:Weekly Sync", "DTSTART:20260814T153000Z", "DTEND:20260814T160000Z"])
  );
  assert.equal(ev.summary, "Weekly Sync");
  assert.equal(ev.startIso, "2026-08-14T15:30:00.000Z");
  assert.equal(ev.endIso, "2026-08-14T16:00:00.000Z");
  assert.equal(ev.isAllDay, false);
  assert.equal(ev.status, "CONFIRMED");
  assert.equal(ev.uid, "abc@google.com");
});

test("resolves a TZID wall-clock time using the IANA database", () => {
  // 11:30 America/New_York in August (EDT, UTC-4) == 15:30 UTC — independent of
  // the machine's local timezone because we resolve TZID explicitly.
  const ev = parseIcsEvent(
    wrap(["SUMMARY:Design review", "DTSTART;TZID=America/New_York:20260814T113000", "DTEND;TZID=America/New_York:20260814T123000"])
  );
  assert.equal(ev.startIso, "2026-08-14T15:30:00.000Z");
  assert.equal(ev.endIso, "2026-08-14T16:30:00.000Z");
});

test("flags an all-day (VALUE=DATE) event", () => {
  const ev = parseIcsEvent(wrap(["SUMMARY:Company holiday", "DTSTART;VALUE=DATE:20260814"]));
  assert.equal(ev.isAllDay, true);
  assert.equal(ev.startIso, "2026-08-14");
});

test("parses a floating time without crashing (local interpretation)", () => {
  const ev = parseIcsEvent(wrap(["SUMMARY:Floating", "DTSTART:20260814T090000"]));
  assert.equal(ev.isAllDay, false);
  assert.ok(!Number.isNaN(Date.parse(ev.startIso)));
});

test("unescapes TEXT values and unfolds long lines", () => {
  const ev = parseIcsEvent(
    wrap([
      "SUMMARY:Budget\\, Q3 review",
      "DTSTART:20260814T153000Z",
      "LOCATION:Room 4\\nFloor 2",
      "DESCRIP",
    ])
  );
  assert.equal(ev.summary, "Budget, Q3 review");
  assert.equal(ev.location, "Room 4\nFloor 2");
});

test("marks a CANCEL method invite as cancelled", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "METHOD:CANCEL",
    "BEGIN:VEVENT",
    "SUMMARY:Cancelled meeting",
    "DTSTART:20260814T153000Z",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const ev = parseIcsEvent(ics);
  assert.equal(ev.status, "CANCELLED");
});

test("extracts organizer email from a mailto ORGANIZER", () => {
  const ev = parseIcsEvent(
    wrap(["SUMMARY:x", "DTSTART:20260814T153000Z", "ORGANIZER;CN=Jane:mailto:jane@acme.com"])
  );
  assert.equal(ev.organizer, "jane@acme.com");
});

test("returns null when there is no VEVENT / start", () => {
  assert.equal(parseIcsEvent("not an ics"), null);
  assert.equal(parseIcsEvent(""), null);
  assert.equal(parseIcsEvent(null), null);
  assert.equal(parseIcsEvent(wrap(["SUMMARY:no start"])), null);
});
