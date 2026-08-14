const test = require("node:test");
const assert = require("node:assert");

const PyaiRealtimeStreaming = require("../../src/helpers/pyaiRealtimeStreaming");

// Exercises the frame-parsing / accumulation logic directly (no socket), which is
// the part that decides what transcript the user actually gets. Live socket
// behavior needs the running app + a mic and is verified there.

test("partials update the live transcript; finals commit and accumulate across utterances", () => {
  const s = new PyaiRealtimeStreaming();
  const partials = [];
  const finals = [];
  s.onPartialTranscript = (t) => partials.push(t);
  s.onFinalTranscript = (t) => finals.push(t);

  s.handleMessage(JSON.stringify({ type: "partial", text: "hello", utterance_id: "u1" }));
  s.handleMessage(JSON.stringify({ type: "partial_stable", text: "hello world", utterance_id: "u1" }));
  assert.equal(partials.at(-1), "hello world");

  s.handleMessage(JSON.stringify({ type: "final", text: "hello world.", utterance_id: "u1" }));
  assert.equal(finals.at(-1), "hello world.");
  assert.equal(s.getFullTranscript(), "hello world.");

  // A second utterance accumulates onto the first, not overwrites it.
  s.handleMessage(JSON.stringify({ type: "partial", text: "how are you", utterance_id: "u2" }));
  assert.equal(partials.at(-1), "hello world. how are you");
  s.handleMessage(JSON.stringify({ type: "final", text: "how are you?", utterance_id: "u2" }));
  assert.equal(finals.at(-1), "hello world. how are you?");
  assert.equal(s.getFullTranscript(), "hello world. how are you?");
});

test("a new utterance_id banks the previous partial when no final arrived", () => {
  const s = new PyaiRealtimeStreaming();
  s.handleMessage(JSON.stringify({ type: "partial", text: "first thought", utterance_id: "u1" }));
  s.handleMessage(JSON.stringify({ type: "partial", text: "second", utterance_id: "u2" }));
  assert.equal(s.getFullTranscript(), "first thought second");
});

test("error frames surface via onError, never as transcript", () => {
  const s = new PyaiRealtimeStreaming();
  let err = null;
  s.onError = (e) => {
    err = e;
  };
  s.handleMessage(JSON.stringify({ type: "error", message: "boom" }));
  assert.equal(err?.message, "boom");
  assert.equal(s.getFullTranscript(), "");
});

test("benign control-frame rejection (unknown type 'commit') is swallowed, not surfaced", () => {
  const s = new PyaiRealtimeStreaming();
  let err = null;
  s.onError = (e) => {
    err = e;
  };
  // PyAI answers our end-of-turn {type:"commit"} with this when it doesn't
  // support the control frame — must NOT become a user-facing Streaming Error.
  s.handleMessage(JSON.stringify({ type: "error", message: "unknown type 'commit'" }));
  assert.equal(err, null);
  // A genuine stream error still propagates.
  s.handleMessage(JSON.stringify({ type: "error", message: "internal server error" }));
  assert.equal(err?.message, "internal server error");
});

test("frameText reads transcript/delta field variants defensively", () => {
  const s = new PyaiRealtimeStreaming();
  const partials = [];
  s.onPartialTranscript = (t) => partials.push(t);
  s.handleMessage(JSON.stringify({ type: "partial", transcript: "via transcript field", utterance_id: "u1" }));
  assert.equal(partials.at(-1), "via transcript field");
  s.handleMessage(JSON.stringify({ type: "partial", delta: "via delta field", utterance_id: "u1" }));
  assert.equal(partials.at(-1), "via delta field");
});

test("relay URL is built from proxy origin with pcm16/16k params and language", () => {
  const s = new PyaiRealtimeStreaming();
  s.model = "pyai-hear";
  s.language = "hi";
  const url = s.buildRelayUrl("https://pyai-proxy.example.run.app");
  assert.match(url, /^wss:\/\/pyai-proxy\.example\.run\.app\/transcribe\/stream\?/);
  assert.match(url, /model=pyai-hear/);
  assert.match(url, /sample_rate=16000/);
  assert.match(url, /encoding=pcm16/);
  assert.match(url, /language=hi/);
});

test("relay URL omits language when auto/empty", () => {
  const s = new PyaiRealtimeStreaming();
  s.language = "auto";
  assert.doesNotMatch(s.buildRelayUrl("https://p.example.com"), /language=/);
  s.language = null;
  assert.doesNotMatch(s.buildRelayUrl("https://p.example.com"), /language=/);
});
