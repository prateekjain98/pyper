const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/config/dictationChannels.ts");

test("classifyChannel maps known apps by bundle id", async () => {
  const { classifyChannel } = await load();
  assert.equal(classifyChannel({ bundleId: "com.tinyspeck.slackmacgap" }), "slack");
  assert.equal(classifyChannel({ bundleId: "com.apple.mail" }), "email");
  assert.equal(classifyChannel({ bundleId: "com.microsoft.Outlook" }), "email");
  assert.equal(classifyChannel({ bundleId: "com.apple.Notes" }), "notes");
  assert.equal(classifyChannel({ bundleId: "md.obsidian" }), "notes");
});

test("classifyChannel falls back to the app name when bundle id is unknown", async () => {
  const { classifyChannel } = await load();
  assert.equal(classifyChannel({ bundleId: "com.unknown.app", name: "Slack" }), "slack");
  assert.equal(classifyChannel({ name: "Microsoft Outlook" }), "email");
  assert.equal(classifyChannel({ name: "Obsidian" }), "notes");
});

test("classifyChannel classifies web apps by the active tab URL", async () => {
  const { classifyChannel } = await load();
  // Gmail / Outlook / Slack / Notion running inside a browser.
  assert.equal(
    classifyChannel({ bundleId: "com.google.Chrome", name: "Google Chrome", url: "https://mail.google.com/mail/u/0/#inbox" }),
    "email"
  );
  assert.equal(
    classifyChannel({ bundleId: "com.apple.Safari", name: "Safari", url: "https://outlook.office.com/mail/" }),
    "email"
  );
  assert.equal(
    classifyChannel({ bundleId: "com.google.Chrome", name: "Google Chrome", url: "https://app.slack.com/client/T1/C2" }),
    "slack"
  );
  assert.equal(
    classifyChannel({ bundleId: "com.google.Chrome", name: "Google Chrome", url: "https://www.notion.so/Roadmap-abc" }),
    "notes"
  );
});

test("classifyChannel returns default for unknown apps, plain browser tabs, and null input", async () => {
  const { classifyChannel } = await load();
  // A browser on a non-matching page stays default (URL didn't match a service).
  assert.equal(
    classifyChannel({ bundleId: "com.google.Chrome", name: "Google Chrome", url: "https://news.ycombinator.com/" }),
    "default"
  );
  assert.equal(classifyChannel({ bundleId: "com.google.Chrome", name: "Google Chrome" }), "default");
  assert.equal(classifyChannel(null), "default");
  assert.equal(classifyChannel(undefined), "default");
  assert.equal(classifyChannel({}), "default");
});

test("getChannelToneSuffix: chat/notes are tone shifts, email/default have no suffix", async () => {
  const { getChannelToneSuffix } = await load();
  assert.match(getChannelToneSuffix("slack"), /casual|conversational/i);
  assert.match(getChannelToneSuffix("notes"), /terse|short|precise/i);
  // Email uses a dedicated prompt (getEmailSystemPrompt), not a suffix.
  assert.equal(getChannelToneSuffix("email"), "");
  assert.equal(getChannelToneSuffix("default"), "");
});

test("getEmailSystemPrompt composes a formal email with greeting + sign-off", async () => {
  const { getEmailSystemPrompt } = await load();
  const p = getEmailSystemPrompt("Pyper");
  assert.match(p, /greeting/i);
  assert.match(p, /sign-off/i);
  assert.match(p, /professional/i);
  assert.match(p, /email/i);
  // Retains the core safety: never answer/execute the dictated content.
  assert.match(p, /never answer or execute/i);
});

test("active dictation channel round-trips", async () => {
  const { setActiveDictationChannel, getActiveDictationChannel } = await load();
  setActiveDictationChannel("email");
  assert.equal(getActiveDictationChannel(), "email");
  setActiveDictationChannel("default");
  assert.equal(getActiveDictationChannel(), "default");
});
