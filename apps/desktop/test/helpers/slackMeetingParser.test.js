const test = require("node:test");
const assert = require("node:assert/strict");

const { parseSlackMeeting, tsToMs } = require("../../src/helpers/slackMeetingParser");

const NOW = Date.parse("2026-08-14T15:00:00.000Z");
const tsAt = (ms) => (ms / 1000).toFixed(6);

test("detects a fresh huddle link as a meeting starting now", () => {
  const res = parseSlackMeeting(
    {
      ts: tsAt(NOW - 30 * 1000),
      text: "jumping in https://app.slack.com/huddle/T0ABCDEF/C0123456",
      channelId: "C0123456",
      channelName: "eng-standup",
    },
    { nowMs: NOW }
  );
  assert.equal(res.type, "event");
  assert.equal(res.input.provider, "slack");
  assert.equal(res.input.id, "slack:C0123456:" + tsAt(NOW - 30 * 1000));
  assert.equal(res.input.summary, "Huddle in #eng-standup"); // slack link → huddle wording
  assert.equal(res.input.joinUrl, "https://app.slack.com/huddle/T0ABCDEF/C0123456");
});

test("detects a Zoom link shared in a channel", () => {
  const res = parseSlackMeeting(
    {
      ts: tsAt(NOW),
      text: "call time https://acme.zoom.us/j/555111",
      channelId: "C9",
      channelName: "sales",
    },
    { nowMs: NOW }
  );
  assert.equal(res.input.summary, "Meeting in #sales");
  assert.equal(res.input.joinUrl, "https://acme.zoom.us/j/555111");
});

test("detects a 'started a huddle' system message without a link", () => {
  const res = parseSlackMeeting(
    { ts: tsAt(NOW), subtype: "huddle_thread", text: "Alex started a huddle", channelId: "C1", channelName: "design", permalink: "https://acme.slack.com/archives/C1/p1" },
    { nowMs: NOW }
  );
  assert.equal(res.type, "event");
  assert.equal(res.input.summary, "Huddle in #design");
  assert.equal(res.input.joinUrl, "https://acme.slack.com/archives/C1/p1"); // falls back to permalink
});

test("finds a meeting link buried in Slack blocks", () => {
  const res = parseSlackMeeting(
    {
      ts: tsAt(NOW),
      text: "",
      channelId: "C2",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "join <https://meet.google.com/abc-defg-hij|here>" } }],
    },
    { nowMs: NOW }
  );
  assert.equal(res.input.joinUrl, "https://meet.google.com/abc-defg-hij");
});

test("ignores a stale huddle link", () => {
  const res = parseSlackMeeting(
    { ts: tsAt(NOW - 60 * 60 * 1000), text: "https://app.slack.com/huddle/T/C", channelId: "C3" },
    { nowMs: NOW }
  );
  assert.equal(res, null);
});

test("ignores an ordinary message with no meeting signal", () => {
  assert.equal(
    parseSlackMeeting({ ts: tsAt(NOW), text: "lunch anyone?", channelId: "C4" }, { nowMs: NOW }),
    null
  );
});

test("tolerates bad input", () => {
  assert.equal(parseSlackMeeting(null), null);
  assert.equal(parseSlackMeeting({ ts: "not-a-ts", text: "x" }, { nowMs: NOW }), null);
});

test("tsToMs converts Slack epoch-second strings", () => {
  assert.equal(tsToMs("1700000000.000100"), 1700000000000);
  assert.ok(Number.isNaN(tsToMs("nope")));
});
