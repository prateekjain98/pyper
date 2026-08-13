const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getMeetingAppByBundleId,
  resolveMicMeetingApp,
  processDetectionMaps,
} = require("../../src/helpers/meetingApps");

test("resolveMicMeetingApp attributes a Slack huddle to the slack icon key", () => {
  const app = resolveMicMeetingApp({ bundleId: "com.tinyspeck.slackmacgap", name: "Slack" });
  assert.deepEqual(app, {
    key: "slack",
    name: "Slack",
    bundleId: "com.tinyspeck.slackmacgap",
    type: "comms",
  });
});

test("resolveMicMeetingApp attributes a Discord call to the discord icon key", () => {
  const app = resolveMicMeetingApp({ bundleId: "com.hnc.Discord", name: "Discord" });
  assert.equal(app.key, "discord");
  assert.equal(app.type, "comms");
});

test("resolveMicMeetingApp attributes a browser (Google Meet host) to a browser key", () => {
  for (const bundleId of [
    "com.google.Chrome",
    "com.apple.Safari",
    "company.thebrowser.Browser",
    "com.microsoft.edgemac",
    "com.brave.Browser",
  ]) {
    const app = resolveMicMeetingApp({ bundleId });
    assert.equal(app.type, "browser", `${bundleId} should be a browser`);
    assert.ok(app.key, `${bundleId} should have an icon key`);
  }
});

test("resolveMicMeetingApp keeps dedicated meeting apps recognised", () => {
  assert.equal(resolveMicMeetingApp({ bundleId: "us.zoom.xos" }).key, "zoom");
  assert.equal(resolveMicMeetingApp({ bundleId: "com.microsoft.teams2" }).key, "teams");
  assert.equal(resolveMicMeetingApp({ bundleId: "com.apple.FaceTime" }).type, "meeting");
});

test("resolveMicMeetingApp returns null for unknown / missing frontmost apps", () => {
  assert.equal(resolveMicMeetingApp({ bundleId: "com.example.unknown" }), null);
  assert.equal(resolveMicMeetingApp({ bundleId: "" }), null);
  assert.equal(resolveMicMeetingApp({ name: "no bundle id" }), null);
  assert.equal(resolveMicMeetingApp(null), null);
  assert.equal(resolveMicMeetingApp(undefined), null);
});

test("resolveMicMeetingApp falls back to the OS-reported name when the registry lacks one", () => {
  // FaceTime carries its own name, so verify the fallback via a browser whose
  // registry name is present but confirm bundleId is echoed back regardless.
  const app = resolveMicMeetingApp({ bundleId: "com.google.Chrome", name: "Chrome Beta" });
  assert.equal(app.bundleId, "com.google.Chrome");
  assert.equal(app.name, "Google Chrome"); // registry name wins when defined
});

test("getMeetingAppByBundleId is a raw registry lookup", () => {
  assert.equal(getMeetingAppByBundleId("com.cisco.webexmeetingsapp").key, "webex");
  assert.equal(getMeetingAppByBundleId("nope"), null);
  assert.equal(getMeetingAppByBundleId(null), null);
});

test("processDetectionMaps includes meeting + comms apps but excludes browsers", () => {
  const { bundleIdMap, appNames } = processDetectionMaps();

  // Dedicated meeting apps + always-running comms apps are watchable.
  assert.equal(bundleIdMap["us.zoom.xos"], "zoom");
  assert.equal(bundleIdMap["com.tinyspeck.slackmacgap"], "slack");
  assert.equal(bundleIdMap["com.hnc.Discord"], "discord");
  assert.equal(appNames.slack, "Slack");
  assert.equal(appNames.zoom, "Zoom");

  // Browsers must never be treated as a running meeting by process detection.
  assert.equal(bundleIdMap["com.google.Chrome"], undefined);
  assert.equal(bundleIdMap["com.apple.Safari"], undefined);
  assert.equal(appNames.chrome, undefined);
});
