// Meeting-link detection for loose text. Slack messages and Gmail
// subjects/bodies carry meeting links as plain URLs, not structured conference
// data, so detecting an upcoming meeting/huddle from those sources starts with
// spotting the link and naming the platform that hosts it.
//
// This is the main-process (CommonJS) counterpart to the renderer's
// `meetingJoinUrl.extractMeetingUrl` (ESM), extended to (a) name the hosting
// platform and (b) surface EVERY link in a blob — a calendar-invite email or a
// Slack digest can mention several. Keep the vendor list roughly in sync with
// `meetingJoinUrl.js` and the app-attribution table in `meetingApps.js` when a
// platform is added, so the overlay can render a matching icon (`key`).

// Ordered most-specific first. Each `pattern` is global (`g`) so `detectMeetingLinks`
// can walk every occurrence; callers must reset `lastIndex` before reuse (done
// below). `key` matches the overlay icon keys used elsewhere for meeting apps.
const MEETING_PLATFORMS = [
  {
    key: "zoom",
    name: "Zoom",
    // zoom.us/j/<id>, /my/<name>, /s/<id>, /w/<id>, /wc/join/<id>
    pattern: /https?:\/\/[a-z0-9.-]*zoom\.us\/(?:j|my|s|w|wc\/join)\/[^\s<>"'|)\]]+/gi,
  },
  {
    key: "meet",
    name: "Google Meet",
    pattern: /https?:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}[^\s<>"'|)\]]*/gi,
  },
  {
    key: "teams",
    name: "Microsoft Teams",
    pattern:
      /https?:\/\/teams\.(?:microsoft|live)\.com\/[^\s<>"'|)\]]*(?:meetup-join|meet\/)[^\s<>"'|)\]]*/gi,
  },
  {
    key: "webex",
    name: "Webex",
    pattern: /https?:\/\/[a-z0-9.-]*\.webex\.com\/[^\s<>"'|)\]]+/gi,
  },
  {
    key: "chime",
    name: "Amazon Chime",
    pattern: /https?:\/\/[a-z0-9.-]*chime\.aws\/[0-9][^\s<>"'|)\]]*/gi,
  },
  {
    key: "slack",
    name: "Slack",
    // A live huddle / Slack call opens at app.slack.com/huddle|call/<workspace>/<channel>.
    pattern: /https?:\/\/app\.slack\.com\/(?:huddle|call)\/[^\s<>"'|)\]]+/gi,
  },
];

// URLs sit inside prose ("Join here: <url>.") so a trailing sentence mark or a
// closing bracket is almost never part of the link — trim a run of them. The
// pipe is Slack's `<url|label>` delimiter (patterns already exclude it).
const TRAILING_PUNCT = /[),.;:!?'"\]|]+$/;

function cleanUrl(url) {
  return url.replace(TRAILING_PUNCT, "");
}

// Every meeting link in `text`, in the order they appear, de-duplicated by URL.
// Returns `[{ url, platform, platformName }]` (empty array for no match / bad
// input). `platform` is the stable icon key; `platformName` is display text.
function detectMeetingLinks(text) {
  if (!text || typeof text !== "string") return [];
  const found = [];
  const seen = new Set();
  for (const { key, name, pattern } of MEETING_PLATFORMS) {
    pattern.lastIndex = 0; // reused module-level regex — reset before each scan
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const url = cleanUrl(match[0]);
      if (seen.has(url)) continue;
      seen.add(url);
      found.push({ url, platform: key, platformName: name, index: match.index });
    }
  }
  found.sort((a, b) => a.index - b.index);
  return found.map(({ url, platform, platformName }) => ({ url, platform, platformName }));
}

// The first meeting link in `text`, or `null`.
function detectMeetingLink(text) {
  return detectMeetingLinks(text)[0] || null;
}

function hasMeetingLink(text) {
  return detectMeetingLink(text) !== null;
}

module.exports = {
  MEETING_PLATFORMS,
  detectMeetingLinks,
  detectMeetingLink,
  hasMeetingLink,
};
