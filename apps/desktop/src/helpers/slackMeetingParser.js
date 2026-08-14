// Turn a Slack message into a meeting signal. Pure + synchronous (the Web API
// calls live in slackMeetingDetector.js).
//
// Slack has no public "scheduled huddle" concept and no reliable huddle-started
// event for third-party apps, so the tractable signals (both opted into) are:
//   - a meeting/huddle link (Zoom/Meet/Teams/Webex or app.slack.com/huddle) in a
//     recent message, and
//   - a "started a huddle" system message / call block.
// A huddle is live, not scheduled, so a detected signal maps to a meeting
// starting *now* — surfaced immediately as an active meeting. Recency gating
// keeps yesterday's huddle link from re-firing.

const { detectMeetingLink } = require("./meetingLinks");

const DEFAULT_FRESHNESS_MS = 10 * 60 * 1000;

// Slack `ts` is a string of epoch-seconds with microseconds ("1699999999.000100").
function tsToMs(ts) {
  const f = parseFloat(ts);
  return Number.isFinite(f) ? Math.round(f * 1000) : NaN;
}

// message: { ts, text, subtype, permalink, channelId, channelName, blocks, attachments }
// opts:    { nowMs, freshnessMs }
// Returns null or { type: "event", input } (ready for buildSignalEvent()).
function parseSlackMeeting(message, opts = {}) {
  if (!message) return null;
  const nowMs = opts.nowMs ?? Date.now();
  const freshnessMs = opts.freshnessMs ?? DEFAULT_FRESHNESS_MS;

  const ms = tsToMs(message.ts);
  if (Number.isNaN(ms)) return null;
  // Only a message from roughly "now" indicates a live huddle.
  if (Math.abs(nowMs - ms) > freshnessMs) return null;

  const corpus = [message.text || ""];
  if (message.blocks) safePush(corpus, message.blocks);
  if (message.attachments) safePush(corpus, message.attachments);
  const text = corpus.join("\n");

  const link = detectMeetingLink(text);
  // A Slack-hosted link IS a huddle; system messages announce one without a link.
  const isHuddle =
    message.subtype === "huddle_thread" ||
    link?.platform === "slack" ||
    /started a huddle|huddle (?:is )?starting|joined the huddle/i.test(text);

  if (!link && !isHuddle) return null;

  const channelLabel = message.channelName
    ? `#${message.channelName}`
    : message.channelId
      ? "Slack"
      : "Slack";
  const summary = isHuddle
    ? `Huddle in ${channelLabel}`
    : message.channelName
      ? `Meeting in ${channelLabel}`
      : `${link.platformName} meeting`;

  return {
    type: "event",
    input: {
      provider: "slack",
      id: `slack:${message.channelId || "dm"}:${message.ts}`,
      summary,
      startIso: new Date(ms).toISOString(),
      endIso: null,
      joinUrl: link ? link.url : message.permalink || null,
      status: "confirmed",
    },
  };
}

function safePush(arr, value) {
  try {
    arr.push(JSON.stringify(value));
  } catch {
    /* circular / unserialisable — ignore */
  }
}

module.exports = { parseSlackMeeting, tsToMs };
