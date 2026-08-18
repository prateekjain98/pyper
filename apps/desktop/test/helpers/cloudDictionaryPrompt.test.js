// The bug these tests lock down: a word the user added in the Dictionary UI never
// reached transcription on Pyper Cloud — the DEFAULT transcription mode. The
// renderer computed the hint correctly, but the two main-process Pyper Cloud
// handlers dropped it on the floor: "cloud-transcribe" forwarded only
// opts.language to the PyAI proxy, and "cloud-reason" (promptMode "cleanup")
// posted only { text, channel, translateTo }. Local Whisper and BYOK OpenAI
// always forwarded it, which is why the feature looked half-working.
//
// The contract asserted here is the WHOLE chain the UI actually walks:
//   DictionaryView.updateCustomDictionary
//     -> IPC db-apply-dictionary-changes -> DictionaryStore.applyDictionaryChanges
//     -> DictionaryStore.getDictionary()            (renderer customDictionary)
//     -> getDictionaryHintWords()                   (audioManager.getWhisperPrompt)
//     -> buildCloudTranscribeHeaders / buildCloudCleanupBody   (what leaves the box)

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { DictionaryStore } = require("../../src/helpers/convexdb/dictionary");
const { getDictionaryHintWords } = require("../../src/utils/snippets.ts");
const {
  CLOUD_PROMPT_HEADER,
  buildCloudTranscribeHeaders,
  buildCloudCleanupBody,
  readCloudTranscribePrompt,
  truncateCloudPrompt,
} = require("../../src/helpers/cloudDictionaryPrompt");

// Exactly what ipcMain "db-apply-dictionary-changes" does with the UI's payload.
function addViaUi(store, words) {
  return store.applyDictionaryChanges({ add: words });
}

// Exactly what audioManager.getWhisperPrompt hands to the cloud-transcribe IPC.
function hintPromptFor(store, snippets = []) {
  const words = getDictionaryHintWords({
    customDictionary: store.getDictionary(),
    snippets,
  });
  return words.length > 0 ? words.join(", ") : null;
}

// ─── The regression: UI word -> STT prompt ───────────────────────────────────

test("a word added in the Dictionary UI reaches the Pyper Cloud STT prompt", () => {
  const store = new DictionaryStore(null);
  addViaUi(store, ["Prateek", "Saaslabs", "Pyper"]);

  const headers = buildCloudTranscribeHeaders(hintPromptFor(store));
  const sent = readCloudTranscribePrompt(headers);

  assert.match(sent, /Prateek/, "the UI-added word never reached the STT prompt");
  assert.match(sent, /Saaslabs/);
  assert.equal(sent, "Prateek, Saaslabs, Pyper");
});

test("snippet triggers ride along with dictionary words, as the renderer merges them", () => {
  const store = new DictionaryStore(null);
  addViaUi(store, ["Prateek"]);

  const prompt = hintPromptFor(store, [{ trigger: "investor ask", replacement: "..." }]);
  const sent = readCloudTranscribePrompt(buildCloudTranscribeHeaders(prompt));

  assert.match(sent, /Prateek/);
  assert.match(sent, /investor ask/);
});

test("a non-ASCII word survives the header transport", () => {
  // A raw (non-base64) header value would make fetch throw on these, which is
  // why the transport encodes: header values are ISO-8859-1 only.
  const store = new DictionaryStore(null);
  addViaUi(store, ["प्रतीक", "Ünal", "北京"]);

  const headers = buildCloudTranscribeHeaders(hintPromptFor(store));
  assert.match(headers[CLOUD_PROMPT_HEADER], /^[A-Za-z0-9+/=]+$/, "header value is not ASCII-safe");
  assert.equal(readCloudTranscribePrompt(headers), "प्रतीक, Ünal, 北京");
});

test("a word removed in the UI stops being sent", () => {
  const store = new DictionaryStore(null);
  addViaUi(store, ["Prateek", "Saaslabs"]);
  store.applyDictionaryChanges({ remove: ["Saaslabs"] });

  const sent = readCloudTranscribePrompt(buildCloudTranscribeHeaders(hintPromptFor(store)));
  assert.match(sent, /Prateek/);
  assert.doesNotMatch(sent, /Saaslabs/, "a deleted word was still biasing transcription");
});

// ─── The cleanup leg (second place Pyper Cloud dropped it) ───────────────────

test("a word added in the Dictionary UI reaches the Pyper Cloud cleanup prompt", () => {
  const store = new DictionaryStore(null);
  addViaUi(store, ["Prateek"]);

  const body = buildCloudCleanupBody({
    text: "hi pratik here",
    channel: "slack",
    customDictionary: getDictionaryHintWords({
      customDictionary: store.getDictionary(),
      snippets: [],
    }),
  });

  assert.deepEqual(body.dictionary, ["Prateek"]);
  assert.equal(body.text, "hi pratik here");
  assert.equal(body.channel, "slack", "the channel tone must still be forwarded");
});

test("an empty dictionary leaves both cloud requests in their original shape", () => {
  const store = new DictionaryStore(null);

  const headers = buildCloudTranscribeHeaders(hintPromptFor(store));
  assert.deepEqual(headers, { "content-type": "audio/wav" });

  const body = buildCloudCleanupBody({ text: "hello", channel: null, translateTo: null });
  assert.equal("dictionary" in body, false);
});

// ─── User scoping: the account-switch guard must still hold ──────────────────

test("after an account switch no previous user's word is sent to the cloud", () => {
  const store = new DictionaryStore(null);
  addViaUi(store, ["AliceSecretClient"]);
  assert.match(
    readCloudTranscribePrompt(buildCloudTranscribeHeaders(hintPromptFor(store))),
    /AliceSecretClient/
  );

  store.resetCache();

  const headers = buildCloudTranscribeHeaders(hintPromptFor(store));
  assert.equal(
    readCloudTranscribePrompt(headers),
    "",
    "user A's dictionary leaked into user B's transcription prompt"
  );
  assert.equal(CLOUD_PROMPT_HEADER in headers, false);

  addViaUi(store, ["BobTerm"]);
  const afterSwitch = readCloudTranscribePrompt(buildCloudTranscribeHeaders(hintPromptFor(store)));
  assert.equal(afterSwitch, "BobTerm");
});

// ─── Engine ceiling ──────────────────────────────────────────────────────────

test("an oversized dictionary is trimmed on a comma boundary, never mid-word", () => {
  const words = Array.from({ length: 300 }, (_, i) => `Term${i}`);
  const trimmed = truncateCloudPrompt(words.join(", "));

  assert.ok(trimmed.length <= 890, `prompt was ${trimmed.length} chars`);
  assert.doesNotMatch(trimmed, /,\s*$/, "trailing separator left behind");
  // Groq rejects an over-long prompt outright, so the cap must hold, and every
  // surviving entry must still be a whole word.
  for (const term of trimmed.split(", ")) {
    assert.match(term, /^Term\d+$/, `"${term}" was sliced in half`);
  }
  assert.match(trimmed, /^Term0, Term1, /);
});

test("a dictionary under the ceiling is sent verbatim", () => {
  assert.equal(truncateCloudPrompt("Prateek, Saaslabs"), "Prateek, Saaslabs");
});

test("a malformed prompt header never throws", () => {
  assert.equal(readCloudTranscribePrompt(undefined), "");
  assert.equal(readCloudTranscribePrompt({}), "");
  assert.equal(readCloudTranscribePrompt({ [CLOUD_PROMPT_HEADER]: "" }), "");
  assert.equal(truncateCloudPrompt(null), "");
  assert.equal(truncateCloudPrompt(undefined), "");
});

// ─── The wiring itself (these handlers are why the words went missing) ───────

const ipcSource = fs.readFileSync(
  path.join(__dirname, "../../src/helpers/ipcHandlers.js"),
  "utf8"
);

test("cloud-transcribe forwards the dictionary prompt to the proxy", () => {
  const handler = ipcSource.slice(
    ipcSource.indexOf('ipcMain.handle("cloud-transcribe"'),
    ipcSource.indexOf('ipcMain.handle("cloud-health-check"')
  );
  assert.ok(handler.length > 0, "cloud-transcribe handler not found");
  assert.match(
    handler,
    /buildCloudTranscribeHeaders\(opts\.prompt\)/,
    "cloud-transcribe is dropping opts.prompt again"
  );
  assert.doesNotMatch(
    handler,
    /headers:\s*\{\s*"content-type":\s*"audio\/wav"\s*\}/,
    "the hard-coded header object is back, which discards the dictionary"
  );
});

test("cloud-reason cleanup forwards the custom dictionary to the proxy", () => {
  const handler = ipcSource.slice(ipcSource.indexOf('ipcMain.handle("cloud-reason"'));
  assert.match(
    handler,
    /buildCloudCleanupBody\(\{[\s\S]{0,200}?customDictionary:\s*opts\.customDictionary/,
    "the /cleanup body is dropping opts.customDictionary again"
  );
});

test("dictionary writes broadcast to every window, not just the writer", () => {
  // The Dictionary UI and the dictation panel are separate BrowserWindows with
  // separate in-memory stores; without the broadcast a new word only took effect
  // after an app restart.
  for (const channel of ["db-set-dictionary", "db-apply-dictionary-changes"]) {
    const start = ipcSource.indexOf(`ipcMain.handle("${channel}"`);
    assert.ok(start > 0, `${channel} handler not found`);
    const handler = ipcSource.slice(start, start + 800);
    assert.match(
      handler,
      /broadcastToWindows\("dictionary-updated"/,
      `${channel} no longer tells the dictation window about the change`
    );
  }
});
