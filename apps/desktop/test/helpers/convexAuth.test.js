const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getConvexToken,
  ensureClientAuth,
  decodeJwtExpMs,
  decodeJwtSubject,
  getConvexSubject,
  resetConvexAuthState,
} = require("../../src/helpers/convexdb/convexAuth");

const SITE = "https://example.convex.site";
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
// A syntactically-valid JWT carrying only `exp` (seconds). Signature is ignored
// here — the helper only decodes exp to pace refresh; the server checks validity.
const makeJwt = (expSec) => `${b64url({ alg: "none" })}.${b64url({ exp: expSec })}.sig`;

// A fetch stub that records calls and returns a 200 { token } for each mint.
function stubFetch(tokenFor) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const token = typeof tokenFor === "function" ? tokenFor(calls.length) : tokenFor;
    return { ok: true, json: async () => ({ token }) };
  };
  fn.calls = calls;
  return fn;
}

const tokenStoreReturning = (value) => ({ get: () => (typeof value === "function" ? value() : value) });

test.beforeEach(() => resetConvexAuthState());

test("decodeJwtExpMs reads exp as ms epoch and tolerates junk", () => {
  assert.equal(decodeJwtExpMs(makeJwt(1_700_000_000)), 1_700_000_000_000);
  assert.equal(decodeJwtExpMs("not-a-jwt"), null);
  assert.equal(decodeJwtExpMs(""), null);
  assert.equal(decodeJwtExpMs(`${b64url({})}.${b64url({})}.s`), null); // no exp
});

test("no session token → no auth, and the token endpoint is never hit", async () => {
  const fetchImpl = stubFetch(makeJwt(9_999_999_999));
  const token = await getConvexToken({
    tokenStore: tokenStoreReturning(""),
    fetchImpl,
    now: () => 0,
    siteUrl: SITE,
  });
  assert.equal(token, null);
  assert.equal(fetchImpl.calls.length, 0);
});

test("mints a Convex JWT from the session bearer and caches it while valid", async () => {
  const now = 1_000_000;
  const jwt = makeJwt(Math.floor(now / 1000) + 600); // valid ~10 min
  const fetchImpl = stubFetch(jwt);
  const opts = {
    tokenStore: tokenStoreReturning("sess-1"),
    fetchImpl,
    now: () => now,
    siteUrl: SITE,
  };

  const first = await getConvexToken(opts);
  const second = await getConvexToken(opts);

  assert.equal(first, jwt);
  assert.equal(second, jwt);
  // Cached: only one round-trip for two reads within validity.
  assert.equal(fetchImpl.calls.length, 1);
  // Correct endpoint + session bearer.
  assert.equal(fetchImpl.calls[0].url, `${SITE}/api/auth/convex/token`);
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, "Bearer sess-1");
});

test("re-mints once the cached JWT is within the expiry skew", async () => {
  const t0 = 1_000_000;
  const jwt1 = makeJwt(Math.floor(t0 / 1000) + 600);
  const jwt2 = makeJwt(Math.floor(t0 / 1000) + 6000);
  let clock = t0;
  const fetchImpl = stubFetch((n) => (n === 1 ? jwt1 : jwt2));
  const opts = {
    tokenStore: tokenStoreReturning("sess-1"),
    fetchImpl,
    now: () => clock,
    siteUrl: SITE,
  };

  assert.equal(await getConvexToken(opts), jwt1);
  clock = t0 + 600_000; // jump past jwt1's exp
  assert.equal(await getConvexToken(opts), jwt2);
  assert.equal(fetchImpl.calls.length, 2);
});

test("a rotated session token forces a fresh mint with the new bearer", async () => {
  const now = 1_000_000;
  const jwt = makeJwt(Math.floor(now / 1000) + 600);
  let session = "sess-1";
  const fetchImpl = stubFetch(jwt);
  const opts = {
    tokenStore: tokenStoreReturning(() => session),
    fetchImpl,
    now: () => now,
    siteUrl: SITE,
  };

  await getConvexToken(opts);
  session = "sess-2"; // sign-out/in or refresh
  await getConvexToken(opts);

  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(fetchImpl.calls[1].init.headers.Authorization, "Bearer sess-2");
});

test("mint failures fall back to null without throwing (no regression)", async () => {
  const opts = (fetchImpl) => ({
    tokenStore: tokenStoreReturning("sess-1"),
    fetchImpl,
    now: () => 0,
    siteUrl: SITE,
  });

  // HTTP non-200
  const notOk = async () => ({ ok: false, json: async () => ({}) });
  assert.equal(await getConvexToken(opts(notOk)), null);

  // Network throw
  resetConvexAuthState();
  const throws = async () => {
    throw new Error("network down");
  };
  assert.equal(await getConvexToken(opts(throws)), null);

  // 200 but no token field
  resetConvexAuthState();
  const noToken = async () => ({ ok: true, json: async () => ({}) });
  assert.equal(await getConvexToken(opts(noToken)), null);
});

test("ensureClientAuth applies the token once, is idempotent, and clears on sign-out", async () => {
  const now = 1_000_000;
  const jwt = makeJwt(Math.floor(now / 1000) + 600);
  const fetchImpl = stubFetch(jwt);
  const client = {
    setAuthCalls: [],
    clearAuthCalls: 0,
    setAuth(v) {
      this.setAuthCalls.push(v);
    },
    clearAuth() {
      this.clearAuthCalls += 1;
    },
  };

  let session = "sess-1";
  const opts = {
    tokenStore: tokenStoreReturning(() => session),
    fetchImpl,
    now: () => now,
    siteUrl: SITE,
  };

  await ensureClientAuth(client, opts);
  await ensureClientAuth(client, opts); // cached + already applied → no-op

  assert.deepEqual(client.setAuthCalls, [jwt]); // applied exactly once
  assert.equal(client.clearAuthCalls, 0);

  session = ""; // signed out
  await ensureClientAuth(client, opts);
  assert.equal(client.clearAuthCalls, 1); // auth cleared exactly once
});

test("distinct bridged sessions mint distinct per-user JWTs (no shared identity)", async () => {
  const now = 1_000_000;
  // The mint endpoint returns a JWT derived from the presented session bearer, so
  // two users' sessions must yield two different tokens on the client.
  const jwtFor = { "sess-alice": makeJwt(Math.floor(now / 1000) + 600), "sess-bob": makeJwt(Math.floor(now / 1000) + 600) };
  let session = "sess-alice";
  const fetchImpl = async (url, init) => {
    const bearer = init.headers.Authorization.replace("Bearer ", "");
    return { ok: true, json: async () => ({ token: `${jwtFor[bearer]}#${bearer}` }) };
  };
  const client = {
    applied: null,
    setAuth(v) {
      this.applied = v;
    },
    clearAuth() {
      this.applied = null;
    },
  };
  const opts = {
    tokenStore: tokenStoreReturning(() => session),
    fetchImpl,
    now: () => now,
    siteUrl: SITE,
  };

  await ensureClientAuth(client, opts);
  const aliceToken = client.applied;
  assert.ok(aliceToken.endsWith("#sess-alice")); // minted from Alice's bearer

  session = "sess-bob"; // account switch
  await ensureClientAuth(client, opts);
  assert.ok(client.applied.endsWith("#sess-bob")); // re-minted from Bob's bearer
  assert.notEqual(client.applied, aliceToken); // never a shared token
});

test("signed out yields no token and applies no dev-user fallback", async () => {
  // No session → getConvexToken returns null and never hits the endpoint.
  const fetchImpl = stubFetch(makeJwt(9_999_999_999));
  const client = {
    setAuthCalls: 0,
    clearAuthCalls: 0,
    setAuth() {
      this.setAuthCalls += 1;
    },
    clearAuth() {
      this.clearAuthCalls += 1;
    },
  };
  await ensureClientAuth(client, {
    tokenStore: tokenStoreReturning(""),
    fetchImpl,
    now: () => 0,
    siteUrl: SITE,
  });
  // Nothing minted, nothing applied — the request goes out unauthenticated and
  // the server fails closed rather than falling back to a shared subject.
  assert.equal(client.setAuthCalls, 0);
  assert.equal(fetchImpl.calls.length, 0);
});

test("ensureClientAuth clears auth when a token cannot be minted", async () => {
  const failing = async () => ({ ok: false, json: async () => ({}) });
  const client = {
    setAuthCalls: 0,
    clearAuthCalls: 0,
    setAuth() {
      this.setAuthCalls += 1;
    },
    clearAuth() {
      this.clearAuthCalls += 1;
    },
  };
  await ensureClientAuth(client, {
    tokenStore: tokenStoreReturning("sess-1"),
    fetchImpl: failing,
    now: () => 0,
    siteUrl: SITE,
  });
  // Never applied a bad token; nothing to clear since none was applied.
  assert.equal(client.setAuthCalls, 0);
  assert.equal(client.clearAuthCalls, 0);
});

test("decodeJwtSubject reads the account identity and tolerates junk", () => {
  const withSub = (sub) => `${b64url({ alg: "none" })}.${b64url({ sub })}.sig`;
  assert.equal(decodeJwtSubject(withSub("user_abc")), "user_abc");
  // Providers that pack "<userId>|<sessionId>" must still resolve to the STABLE
  // user id, or a plain session refresh would look like a different account.
  assert.equal(decodeJwtSubject(withSub("user_abc|sess_999")), "user_abc");
  assert.equal(decodeJwtSubject("not-a-jwt"), null);
  assert.equal(decodeJwtSubject(`${b64url({})}.${b64url({})}.s`), null); // no sub
});

test("getConvexSubject resolves the signed-in account, null when signed out", async () => {
  const now = 1_000_000;
  const jwt = `${b64url({ alg: "none" })}.${b64url({
    sub: "user_alice",
    exp: Math.floor(now / 1000) + 600,
  })}.sig`;

  assert.equal(
    await getConvexSubject({
      tokenStore: tokenStoreReturning("sess-1"),
      fetchImpl: stubFetch(jwt),
      now: () => now,
      siteUrl: SITE,
    }),
    "user_alice"
  );

  resetConvexAuthState();
  assert.equal(
    await getConvexSubject({
      tokenStore: tokenStoreReturning(""),
      fetchImpl: stubFetch(jwt),
      now: () => now,
      siteUrl: SITE,
    }),
    null
  );
});

// Regression: the "already applied" bookkeeping used to be one module-global
// value. An account switch rebuilds the Convex client (resetConvexClient), so a
// token recorded as applied by the OLD client made the NEW client skip its own
// setAuth() and go out unauthenticated — the new user would see an empty app.
test("each client tracks its own applied token across a client rebuild", async () => {
  const now = 1_000_000;
  const jwt = makeJwt(Math.floor(now / 1000) + 600);
  const makeClient = () => ({
    setAuthCalls: [],
    setAuth(v) {
      this.setAuthCalls.push(v);
    },
    clearAuth() {},
  });
  const opts = {
    tokenStore: tokenStoreReturning("sess-1"),
    fetchImpl: stubFetch(jwt),
    now: () => now,
    siteUrl: SITE,
  };

  const oldClient = makeClient();
  await ensureClientAuth(oldClient, opts);
  assert.deepEqual(oldClient.setAuthCalls, [jwt]);

  // Same token, brand-new client (what an identity switch builds).
  const newClient = makeClient();
  await ensureClientAuth(newClient, opts);
  assert.deepEqual(
    newClient.setAuthCalls,
    [jwt],
    "the rebuilt client never got the token applied"
  );
});
