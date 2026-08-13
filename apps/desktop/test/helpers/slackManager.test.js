const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const managerModulePath = require.resolve("../../src/helpers/slackManager.js");
const originalLoad = Module._load;

// slackManager requires("electron") for net.fetch at module scope. Outside an
// Electron runtime that would resolve to the binary path string; mock it so the
// module loads cleanly. Every test injects its own fetch, so net is never used.
function loadManager() {
  delete require.cache[managerModulePath];
  Module._load = function loadWithElectronMock(request, parent, isMain) {
    if (request === "electron") return { net: { fetch: () => {} } };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(managerModulePath);
  } finally {
    Module._load = originalLoad;
  }
}

const slackManager = loadManager();

test("validateWebhookUrl accepts only https hooks.slack.com URLs", () => {
  assert.equal(slackManager.validateWebhookUrl("https://hooks.slack.com/services/T/B/xyz"), true);
  assert.equal(slackManager.validateWebhookUrl("http://hooks.slack.com/services/T/B/xyz"), false);
  assert.equal(slackManager.validateWebhookUrl("https://evil.example.com/services/x"), false);
  assert.equal(slackManager.validateWebhookUrl("not a url"), false);
  assert.equal(slackManager.validateWebhookUrl(""), false);
  assert.equal(slackManager.validateWebhookUrl(null), false);
});

test("validateBotToken accepts xoxb-/xoxp- prefixes", () => {
  assert.equal(slackManager.validateBotToken("xoxb-123-abc"), true);
  assert.equal(slackManager.validateBotToken("xoxp-123-abc"), true);
  assert.equal(slackManager.validateBotToken("xapp-123"), false);
  assert.equal(slackManager.validateBotToken(""), false);
});

test("getStatus reports webhook / token / disconnected without leaking creds", () => {
  assert.deepEqual(slackManager.getStatus({ webhookUrl: "https://hooks.slack.com/x" }), {
    connected: true,
    method: "webhook",
    channel: "",
  });
  assert.deepEqual(slackManager.getStatus({ botToken: "xoxb-1", channel: "#general" }), {
    connected: true,
    method: "token",
    channel: "#general",
  });
  assert.deepEqual(slackManager.getStatus({}), {
    connected: false,
    method: null,
    channel: "",
  });
});

test("postMessage POSTs { text } to the webhook and resolves on 'ok'", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => "ok" };
  };
  const result = await slackManager.postMessage(
    { webhookUrl: "https://hooks.slack.com/services/T/B/xyz", text: "hello" },
    fakeFetch
  );
  assert.deepEqual(result, { success: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://hooks.slack.com/services/T/B/xyz");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { text: "hello" });
});

test("postMessage rejects when the webhook does not return 'ok'", async () => {
  const fakeFetch = async () => ({ ok: false, status: 404, text: async () => "no_service" });
  await assert.rejects(
    slackManager.postMessage(
      { webhookUrl: "https://hooks.slack.com/services/bad", text: "hi" },
      fakeFetch
    ),
    /no_service/
  );
});

test("postMessage uses chat.postMessage with the bot token + channel", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ ok: true, ts: "1.2", channel: "C1" }) };
  };
  const result = await slackManager.postMessage(
    { botToken: "xoxb-123", channel: "#general", text: "hi there" },
    fakeFetch
  );
  assert.equal(result.success, true);
  assert.equal(calls[0].url, slackManager.CHAT_POST_MESSAGE_URL);
  assert.equal(calls[0].init.headers.Authorization, "Bearer xoxb-123");
  assert.deepEqual(JSON.parse(calls[0].init.body), { channel: "#general", text: "hi there" });
});

test("postMessage surfaces Slack API errors (data.ok === false)", async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: false, error: "channel_not_found" }),
  });
  await assert.rejects(
    slackManager.postMessage({ botToken: "xoxb-1", channel: "#nope", text: "x" }, fakeFetch),
    /channel_not_found/
  );
});

test("postMessage refuses empty text and missing connection", async () => {
  await assert.rejects(slackManager.postMessage({ webhookUrl: "https://hooks.slack.com/x", text: "  " }));
  await assert.rejects(slackManager.postMessage({ text: "hello" }), /not connected/);
  await assert.rejects(
    slackManager.postMessage({ botToken: "xoxb-1", text: "hello" }),
    /channel is required/
  );
});
