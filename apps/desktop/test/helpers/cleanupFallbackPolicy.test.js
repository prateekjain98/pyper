const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/helpers/cleanupFallbackPolicy.js");

test("isCleanupFalloverError: rate limit / out of credits / server faults fall over", async () => {
  const { isCleanupFalloverError } = await load();

  assert.equal(isCleanupFalloverError({ status: 429 }), true);
  assert.equal(isCleanupFalloverError({ status: 402 }), true);
  assert.equal(isCleanupFalloverError({ statusCode: 503 }), true);
  assert.equal(isCleanupFalloverError({ response: { status: 500 } }), true);
  assert.equal(isCleanupFalloverError({ code: "PROVIDER_RATE_LIMITED" }), true);
  assert.equal(isCleanupFalloverError({ code: "LIMIT_REACHED" }), true);
  assert.equal(
    isCleanupFalloverError(new Error("You exceeded your current quota, please check your billing")),
    true,
  );
  assert.equal(isCleanupFalloverError(new Error("Your credit balance is too low")), true);
});

test("isCleanupFalloverError: deterministic 4xx rejections do NOT fall over", async () => {
  const { isCleanupFalloverError } = await load();

  assert.equal(isCleanupFalloverError({ status: 400 }), false); // bad request
  assert.equal(isCleanupFalloverError({ status: 401 }), false); // bad key
  assert.equal(isCleanupFalloverError({ status: 403 }), false);
  assert.equal(isCleanupFalloverError({ status: 404 }), false); // wrong model id
  assert.equal(isCleanupFalloverError(null), false);
  assert.equal(isCleanupFalloverError(new Error("something unrelated broke")), false);
});

test("shouldTryCloudCleanupFallback: only cloud providers, never self-hosted/local/enterprise", async () => {
  const { shouldTryCloudCleanupFallback } = await load();

  // Cloud BYOK providers → allowed.
  for (const provider of ["openai", "anthropic", "gemini", "groq", "tinfoil", "corti", "openrouter"]) {
    assert.equal(shouldTryCloudCleanupFallback({ provider, mode: "providers" }), true, provider);
  }

  // Privacy/enterprise gates → never redirected to Pyper Cloud.
  assert.equal(shouldTryCloudCleanupFallback({ provider: "local", mode: "local" }), false);
  assert.equal(shouldTryCloudCleanupFallback({ provider: "custom", mode: "self-hosted" }), false);
  assert.equal(shouldTryCloudCleanupFallback({ provider: "bedrock", mode: "enterprise" }), false);
  assert.equal(shouldTryCloudCleanupFallback({ provider: "openai", mode: "self-hosted" }), false);
  assert.equal(
    shouldTryCloudCleanupFallback({ provider: "openai", mode: "providers", hasRemoteUrl: true }),
    false,
  );
  assert.equal(
    shouldTryCloudCleanupFallback({ provider: "openai", mode: "providers", enabled: false }),
    false,
  );
  assert.equal(shouldTryCloudCleanupFallback({ provider: "unknown", mode: "providers" }), false);
});
