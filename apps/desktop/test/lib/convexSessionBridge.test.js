const test = require("node:test");
const assert = require("node:assert/strict");

const {
  readBetterAuthSessionToken,
  bridgeConvexSessionToken,
  clearConvexSessionBridge,
} = require("../../src/lib/convexSessionBridge");

// A minimal localStorage-like double holding the crossDomain cookie blob.
function storageWith(cookieJson) {
  const map = new Map();
  if (cookieJson !== undefined) map.set("better-auth_cookie", cookieJson);
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
  };
}

// A fake main-process auth bridge whose token store starts at `initial` and
// records every authSetToken / authClearSession call.
function fakeApi(initial = { token: null, generation: 0 }) {
  const state = { ...initial };
  const calls = { setToken: [], clear: 0, getState: 0 };
  return {
    calls,
    state,
    authGetTokenState: async () => {
      calls.getState += 1;
      return { token: state.token, generation: state.generation };
    },
    authSetToken: async (token, expectedGeneration) => {
      calls.setToken.push({ token, expectedGeneration });
      if (expectedGeneration !== state.generation) {
        return {
          success: false,
          code: "AUTH_CONTEXT_CHANGED",
          token: state.token,
          generation: state.generation,
        };
      }
      state.token = token;
      state.generation += 1;
      return { success: true, token: state.token, generation: state.generation };
    },
    authClearSession: async () => {
      calls.clear += 1;
      state.token = null;
      state.generation += 1;
      return { success: true };
    },
  };
}

test("readBetterAuthSessionToken extracts the signed session token from storage", () => {
  const storage = storageWith(
    JSON.stringify({
      "better-auth.session_token": { value: "signed.token.value", expires: null },
      "better-auth.session_data": { value: "irrelevant", expires: null },
    })
  );
  assert.equal(readBetterAuthSessionToken(null, storage), "signed.token.value");
});

test("readBetterAuthSessionToken prefers the stored token over the session record", () => {
  const storage = storageWith(
    JSON.stringify({ "better-auth.session_token": { value: "stored", expires: null } })
  );
  const token = readBetterAuthSessionToken({ session: { token: "from-record" } }, storage);
  assert.equal(token, "stored");
});

test("readBetterAuthSessionToken falls back to the live session record token", () => {
  const token = readBetterAuthSessionToken({ session: { token: "raw-token" } }, storageWith());
  assert.equal(token, "raw-token");
});

test("readBetterAuthSessionToken returns null when nothing is available or JSON is junk", () => {
  assert.equal(readBetterAuthSessionToken(null, storageWith()), null);
  assert.equal(readBetterAuthSessionToken(null, storageWith("{not json")), null);
  // Only session_data present (no session_token) → no bearer.
  const onlyData = storageWith(
    JSON.stringify({ "better-auth.session_data": { value: "x", expires: null } })
  );
  assert.equal(readBetterAuthSessionToken(null, onlyData), null);
});

test("bridgeConvexSessionToken writes the session bearer into an empty store", async () => {
  const api = fakeApi();
  const ok = await bridgeConvexSessionToken("sess-1", api);
  assert.equal(ok, true);
  assert.deepEqual(api.calls.setToken, [{ token: "sess-1", expectedGeneration: 0 }]);
  assert.equal(api.state.token, "sess-1");
});

test("bridgeConvexSessionToken is idempotent when the store already holds the token", async () => {
  const api = fakeApi({ token: "sess-1", generation: 3 });
  const ok = await bridgeConvexSessionToken("sess-1", api);
  assert.equal(ok, true);
  assert.equal(api.calls.setToken.length, 0); // no churn — never re-writes
});

test("bridgeConvexSessionToken never bridges an empty/sign-out token", async () => {
  const api = fakeApi();
  assert.equal(await bridgeConvexSessionToken(null, api), false);
  assert.equal(await bridgeConvexSessionToken("", api), false);
  assert.equal(api.calls.setToken.length, 0);
});

test("bridgeConvexSessionToken retries once with the fresh generation after a race", async () => {
  const api = fakeApi({ token: null, generation: 0 });
  // Simulate a concurrent write bumping the generation between getState and set:
  // the first getState reports generation 0, but a racing writer advances it.
  const realGetState = api.authGetTokenState;
  let first = true;
  api.authGetTokenState = async () => {
    const s = await realGetState();
    if (first) {
      first = false;
      api.state.generation = 5; // a racing writer advanced the store
    }
    return s; // returns the STALE generation (0) the effect first observed
  };
  const ok = await bridgeConvexSessionToken("sess-1", api);
  assert.equal(ok, true);
  // First attempt uses stale gen 0 (rejected), retry uses the reported gen 5.
  assert.deepEqual(api.calls.setToken, [
    { token: "sess-1", expectedGeneration: 0 },
    { token: "sess-1", expectedGeneration: 5 },
  ]);
  assert.equal(api.state.token, "sess-1");
});

test("bridgeConvexSessionToken no-ops (no throw) when the IPC bridge is unavailable", async () => {
  assert.equal(await bridgeConvexSessionToken("sess-1", null), false);
  assert.equal(await bridgeConvexSessionToken("sess-1", {}), false);
});

test("clearConvexSessionBridge clears only when a token is present", async () => {
  const withToken = fakeApi({ token: "sess-1", generation: 2 });
  await clearConvexSessionBridge(withToken);
  assert.equal(withToken.calls.clear, 1);
  assert.equal(withToken.state.token, null);

  // Already empty → no clear call (avoids churning the store generation).
  const empty = fakeApi({ token: null, generation: 0 });
  await clearConvexSessionBridge(empty);
  assert.equal(empty.calls.clear, 0);
});
