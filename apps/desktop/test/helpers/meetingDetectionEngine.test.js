const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { EventEmitter } = require("node:events");

const enginePath = require.resolve("../../src/helpers/meetingDetectionEngine");
const originalLoad = Module._load;

// Frontmost-app attribution is mocked per test; the real ./meetingApps maps the
// returned bundle id to an app descriptor, so these tests exercise the true
// bundle-id → icon-key mapping end to end.
let frontmostResult = null;

function loadEngine() {
  delete require.cache[enginePath];

  Module._load = function loadWithMocks(request, parent, isMain) {
    if (request === "electron") {
      return { shell: { openExternal: async () => {} } };
    }
    if (request === "./debugLogger") {
      return { info() {}, warn() {}, debug() {}, error() {} };
    }
    if (request === "./windowBroadcast") {
      return { broadcastToWindows() {} };
    }
    if (request === "./frontmostApp") {
      return { getFrontmostApp: async () => frontmostResult, parseFrontmostOutput: (s) => s };
    }
    // ESM module; the app loads it through a transpiling loader.
    if (request === "./meetingJoinUrl") {
      return { getMeetingJoinUrl: (event) => event?.hangout_link ?? null };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(enginePath);
  } finally {
    Module._load = originalLoad;
  }
}

// Lets the async audio handler (frontmost lookup → _handleDetection) settle.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function createEngine({ frontmost = null } = {}) {
  frontmostResult = frontmost;
  const MeetingDetectionEngine = loadEngine();

  const reminderScheduler = {
    getActiveMeetingState: () => ({ activeMeeting: null, activeEvents: [], upcomingEvents: [] }),
  };
  const processDetector = new EventEmitter();
  processDetector.start = () => {};
  processDetector.stop = () => {};

  const audioDetector = new EventEmitter();
  audioDetector.dismissals = 0;
  audioDetector.dismiss = () => audioDetector.dismissals++;
  audioDetector.resetPrompt = () => {};
  audioDetector.setUserRecording = () => {};
  audioDetector.setMicWarmHold = () => {};
  audioDetector.start = () => {};
  audioDetector.stop = () => {};

  const shown = [];
  const windowManager = {
    notificationPrefs: {},
    showMeetingNotification: (data) => shown.push(data),
    dismissMeetingNotification: () => {},
    queueMeetingNoteNavigation: async () => {},
  };

  const engine = new MeetingDetectionEngine(
    reminderScheduler,
    processDetector,
    audioDetector,
    windowManager,
    {}
  );

  return { engine, audioDetector, shown };
}

test("an unanswered audio prompt expires without cooling down the mic detector", async () => {
  const { engine, audioDetector, shown } = createEngine();

  audioDetector.emit("sustained-audio-detected", { durationMs: 2000, detectedAt: 0 });
  await flush();
  assert.equal(shown.length, 1, "the detection must reach the overlay");

  engine.handleNotificationTimeout();

  assert.equal(audioDetector.dismissals, 0, "a timeout is not a decline; no cooldown may start");
  assert.equal(engine.activeDetections.size, 0, "expired detections must be cleared");
});

test("explicitly dismissing an audio prompt still starts the mic cooldown", async () => {
  const { engine, audioDetector, shown } = createEngine();

  audioDetector.emit("sustained-audio-detected", { durationMs: 2000, detectedAt: 0 });
  await flush();
  await engine.handleNotificationResponse(shown[0].detectionId, "dismiss");

  assert.equal(audioDetector.dismissals, 1, "an explicit decline must keep its cooldown");
});

test("a Slack huddle (mic active + Slack frontmost) is attributed to Slack", async () => {
  const { audioDetector, shown } = createEngine({
    frontmost: { bundleId: "com.tinyspeck.slackmacgap", name: "Slack" },
  });

  audioDetector.emit("sustained-audio-detected", { durationMs: 2000, detectedAt: 0 });
  await flush();

  assert.equal(shown.length, 1, "the huddle must surface a prompt");
  assert.equal(shown[0].source, "audio");
  assert.equal(shown[0].variant, "detected", "an unscheduled huddle is a 'detected' meeting");
  assert.ok(shown[0].app, "the prompt must carry app attribution");
  assert.equal(shown[0].app.key, "slack", "so the overlay can render the Slack icon");
  assert.equal(shown[0].app.type, "comms");
});

test("a browser meeting (mic active + Chrome frontmost) is attributed to the browser", async () => {
  const { audioDetector, shown } = createEngine({
    frontmost: { bundleId: "com.google.Chrome", name: "Google Chrome" },
  });

  audioDetector.emit("sustained-audio-detected", { durationMs: 2000, detectedAt: 0 });
  await flush();

  assert.equal(shown.length, 1, "a Google Meet-style browser meeting must surface a prompt");
  assert.equal(shown[0].app.key, "chrome");
  assert.equal(shown[0].app.type, "browser");
});

test("an unrecognised frontmost app still fires a generic (unbranded) prompt", async () => {
  const { audioDetector, shown } = createEngine({
    frontmost: { bundleId: "com.example.unknown", name: "Some App" },
  });

  audioDetector.emit("sustained-audio-detected", { durationMs: 2000, detectedAt: 0 });
  await flush();

  assert.equal(shown.length, 1, "detection must not depend on recognising the app");
  assert.equal(shown[0].app, null, "an unknown app yields no branding, not a dropped prompt");
});

test("a failed frontmost lookup does not drop the detection", async () => {
  const { audioDetector, shown } = createEngine({ frontmost: null });

  audioDetector.emit("sustained-audio-detected", { durationMs: 2000, detectedAt: 0 });
  await flush();

  assert.equal(shown.length, 1, "no frontmost info still yields a generic prompt");
  assert.equal(shown[0].app, null);
});
