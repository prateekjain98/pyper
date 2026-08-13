const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/helpers/transcriptionFallback.js");

test("signed-in Pyper Cloud falls back to cloud", async () => {
  const { resolveStreamingFallbackTarget } = await load();
  assert.equal(
    resolveStreamingFallbackTarget({
      useLocalWhisper: false,
      cloudTranscriptionMode: "pyper",
      isSignedIn: true,
    }),
    "cloud"
  );
});

test("signed-out Pyper Cloud still falls back to the auth-free cloud endpoint", async () => {
  const { resolveStreamingFallbackTarget } = await load();
  // The proxy /transcribe needs no sign-in, so a signed-out cloud session must
  // recover there instead of discarding already-recorded audio.
  assert.equal(
    resolveStreamingFallbackTarget({
      useLocalWhisper: false,
      cloudTranscriptionMode: "pyper",
      isSignedIn: false,
    }),
    "cloud"
  );
});

test("BYOK mode falls back to the user's own provider", async () => {
  const { resolveStreamingFallbackTarget } = await load();
  assert.equal(
    resolveStreamingFallbackTarget({
      useLocalWhisper: false,
      cloudTranscriptionMode: "byok",
      isSignedIn: false,
    }),
    "byok"
  );
});
