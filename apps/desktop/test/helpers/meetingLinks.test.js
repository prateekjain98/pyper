const test = require("node:test");
const assert = require("node:assert/strict");

const {
  detectMeetingLink,
  detectMeetingLinks,
  hasMeetingLink,
} = require("../../src/helpers/meetingLinks");

test("detects a Zoom join link and names the platform", () => {
  const link = detectMeetingLink("Standup: https://acme.zoom.us/j/9876543210?pwd=abc see you there");
  assert.deepEqual(link, {
    url: "https://acme.zoom.us/j/9876543210?pwd=abc",
    platform: "zoom",
    platformName: "Zoom",
  });
});

test("detects a Google Meet link", () => {
  const link = detectMeetingLink("Join here: https://meet.google.com/abc-defg-hij (passcode 42)");
  assert.deepEqual(link, {
    url: "https://meet.google.com/abc-defg-hij",
    platform: "meet",
    platformName: "Google Meet",
  });
});

test("detects a Microsoft Teams meetup-join link", () => {
  const link = detectMeetingLink(
    "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0?context=%7b%7d"
  );
  assert.equal(link.platform, "teams");
  assert.ok(link.url.startsWith("https://teams.microsoft.com/l/meetup-join/"));
});

test("detects a Webex link", () => {
  const link = detectMeetingLink("Dial in or click https://acme.webex.com/meet/jane.doe");
  assert.equal(link.platform, "webex");
  assert.equal(link.url, "https://acme.webex.com/meet/jane.doe");
});

test("detects a Slack huddle link", () => {
  const link = detectMeetingLink(
    "@here huddle starting https://app.slack.com/huddle/T0ABCDEF/C0123456 join in"
  );
  assert.equal(link.platform, "slack");
  assert.equal(link.url, "https://app.slack.com/huddle/T0ABCDEF/C0123456");
});

test("strips trailing sentence punctuation from a link", () => {
  const link = detectMeetingLink("Meeting is at https://meet.google.com/abc-defg-hij.");
  assert.equal(link.url, "https://meet.google.com/abc-defg-hij");
});

test("returns links in the order they appear across platforms", () => {
  const text = [
    "Primary: https://meet.google.com/aaa-bbbb-ccc",
    "Backup: https://acme.zoom.us/j/555",
  ].join("\n");
  const links = detectMeetingLinks(text);
  assert.equal(links.length, 2);
  assert.equal(links[0].platform, "meet");
  assert.equal(links[1].platform, "zoom");
});

test("de-duplicates a repeated link", () => {
  const url = "https://acme.zoom.us/j/9876543210";
  const links = detectMeetingLinks(`${url} ... reminder: ${url}`);
  assert.equal(links.length, 1);
});

test("ignores non-meeting links and plain text", () => {
  assert.equal(detectMeetingLink("See the doc at https://docs.google.com/document/d/xyz"), null);
  assert.equal(detectMeetingLink("Lunch at noon, no link here"), null);
  assert.equal(hasMeetingLink("just a normal sentence"), false);
});

test("tolerates empty / non-string input", () => {
  assert.deepEqual(detectMeetingLinks(""), []);
  assert.deepEqual(detectMeetingLinks(null), []);
  assert.deepEqual(detectMeetingLinks(undefined), []);
  assert.deepEqual(detectMeetingLinks(42), []);
  assert.equal(detectMeetingLink("   "), null);
});

test("does not leak regex lastIndex between calls", () => {
  const text = "https://acme.zoom.us/j/111 and https://acme.zoom.us/j/222";
  // Two calls in a row must return identical results (global-regex reset guard).
  assert.deepEqual(detectMeetingLinks(text), detectMeetingLinks(text));
});
