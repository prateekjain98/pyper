const test = require("node:test");
const { afterEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const modulePath = require.resolve("../../src/helpers/frontmostApp");
const originalLoad = Module._load;
const originalPlatform = process.platform;

function setPlatform(platform) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

afterEach(() => setPlatform(originalPlatform));

function load() {
  delete require.cache[modulePath];
  Module._load = function loadWithMocks(request, parent, isMain) {
    if (request === "./debugLogger") {
      return { info() {}, warn() {}, debug() {}, error() {} };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

const { getFrontmostApp, parseFrontmostOutput } = load();

test("parseFrontmostOutput splits bundle id and name on the first newline", () => {
  assert.deepEqual(parseFrontmostOutput("com.tinyspeck.slackmacgap\nSlack"), {
    bundleId: "com.tinyspeck.slackmacgap",
    name: "Slack",
  });
});

test("parseFrontmostOutput tolerates a name with spaces", () => {
  assert.deepEqual(parseFrontmostOutput("com.google.Chrome\nGoogle Chrome"), {
    bundleId: "com.google.Chrome",
    name: "Google Chrome",
  });
});

test("parseFrontmostOutput returns null when no bundle id was reported", () => {
  assert.equal(parseFrontmostOutput(""), null);
  assert.equal(parseFrontmostOutput(null), null);
  assert.equal(parseFrontmostOutput("\nSome App"), null);
  assert.equal(parseFrontmostOutput("undefined\nundefined"), null);
});

test("parseFrontmostOutput yields an empty name when only a bundle id is present", () => {
  assert.deepEqual(parseFrontmostOutput("com.apple.Safari"), {
    bundleId: "com.apple.Safari",
    name: "",
  });
});

test("getFrontmostApp on darwin parses the osascript output", async () => {
  setPlatform("darwin");
  const calls = [];
  const execFileImpl = (command, args, options, cb) => {
    calls.push({ command, args, options });
    cb(null, "com.hnc.Discord\nDiscord\n");
  };

  const result = await getFrontmostApp({ execFileImpl });

  assert.deepEqual(result, { bundleId: "com.hnc.Discord", name: "Discord" });
  assert.equal(calls[0].command, "osascript");
  assert.deepEqual(calls[0].args.slice(0, 2), ["-l", "JavaScript"]);
});

test("getFrontmostApp resolves null when osascript errors", async () => {
  setPlatform("darwin");
  const execFileImpl = (command, args, options, cb) => cb(new Error("boom"));
  assert.equal(await getFrontmostApp({ execFileImpl }), null);
});

test("getFrontmostApp resolves null off darwin without spawning anything", async () => {
  setPlatform("win32");
  let spawned = false;
  const execFileImpl = () => {
    spawned = true;
  };
  assert.equal(await getFrontmostApp({ execFileImpl }), null);
  assert.equal(spawned, false, "no osascript on non-macOS platforms");
});
