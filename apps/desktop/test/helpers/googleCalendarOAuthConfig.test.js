const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const oauthModulePath = require.resolve("../../src/helpers/googleCalendarOAuth.js");
const originalLoad = Module._load;

// googleCalendarOAuth.js (and the oauthLoopbackFlow it pulls in) require
// "electron" at load time. The guard we're testing rejects before touching
// net/shell, so a bare stub is enough.
function loadOAuthModule() {
  delete require.cache[oauthModulePath];
  Module._load = function loadWithElectronMock(request, parent, isMain) {
    if (request === "electron") {
      return { net: {}, shell: { openExternal: () => {} } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(oauthModulePath);
  } finally {
    Module._load = originalLoad;
  }
}

function withEnv(clientId, clientSecret, fn) {
  const prevId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const prevSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const set = (key, value) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  set("GOOGLE_CALENDAR_CLIENT_ID", clientId);
  set("GOOGLE_CALENDAR_CLIENT_SECRET", clientSecret);
  try {
    return fn();
  } finally {
    set("GOOGLE_CALENDAR_CLIENT_ID", prevId);
    set("GOOGLE_CALENDAR_CLIENT_SECRET", prevSecret);
  }
}

test("isConfigured is false when creds are unset", () => {
  const GoogleCalendarOAuth = loadOAuthModule();
  withEnv(undefined, undefined, () => {
    assert.equal(new GoogleCalendarOAuth({}).isConfigured(), false);
  });
});

test("isConfigured is false for .env.example placeholders", () => {
  const GoogleCalendarOAuth = loadOAuthModule();
  withEnv("your_google_calendar_client_id_here", "your_google_calendar_client_secret_here", () => {
    assert.equal(new GoogleCalendarOAuth({}).isConfigured(), false);
  });
});

test("isConfigured is false when only one cred is set", () => {
  const GoogleCalendarOAuth = loadOAuthModule();
  withEnv("123.apps.googleusercontent.com", undefined, () => {
    assert.equal(new GoogleCalendarOAuth({}).isConfigured(), false);
  });
});

test("isConfigured is true when both creds are real values", () => {
  const GoogleCalendarOAuth = loadOAuthModule();
  withEnv("123.apps.googleusercontent.com", "GOCSPX-realsecret", () => {
    assert.equal(new GoogleCalendarOAuth({}).isConfigured(), true);
  });
});

test("startOAuthFlow rejects with not_configured before opening the browser", async () => {
  const GoogleCalendarOAuth = loadOAuthModule();
  await withEnv(undefined, undefined, async () => {
    await assert.rejects(new GoogleCalendarOAuth({}).startOAuthFlow(), (err) => {
      assert.equal(err.redirectCode, "not_configured");
      assert.match(err.message, /GOOGLE_CALENDAR_CLIENT_ID/);
      return true;
    });
  });
});
