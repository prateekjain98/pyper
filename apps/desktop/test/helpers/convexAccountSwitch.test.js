// The bug these tests lock down: the Convex-backed stores kept an in-memory
// cache that was seeded ONCE at construction and never re-seeded. After a
// sign-out and a sign-in as a DIFFERENT user, every synchronous read still
// served the FIRST user's rows out of memory — snippets, transcripts, notes —
// however correctly the server scoped them by `ownerSubject`.
//
// The contract asserted here: on an identity change every group-A cache is
// dropped and re-seeded for the new user, an in-flight load for the previous
// user can never land in the new user's cache, and a failed re-seed leaves the
// caches EMPTY rather than falling back to the previous account's rows.

const test = require("node:test");
const assert = require("node:assert/strict");

const { getFunctionName } = require("convex/server");

const ConvexDatabaseManager = require("../../src/helpers/convexDatabaseManager");
const { SnippetsStore } = require("../../src/helpers/convexdb/snippets");
const { TranscriptionsStore } = require("../../src/helpers/convexdb/transcriptions");
const { NotesStore } = require("../../src/helpers/convexdb/notes");

// A Convex client stub whose responses are keyed by the "signed-in user". Each
// query resolves from whatever `currentUser` is at CALL time, so a test can flip
// users between a query being issued and it settling.
function makeClient(datasets) {
  const state = { user: null, deferred: null, calls: [] };
  const client = {
    async query(ref, args) {
      // "snippets:list", "transcriptions:list", …
      const name = getFunctionName(ref);
      state.calls.push({ name, args, user: state.user });
      if (state.deferred) await state.deferred;
      const data = datasets[state.user] || {};
      for (const [key, rows] of Object.entries(data)) {
        if (name.includes(key)) return rows;
      }
      return [];
    },
    async mutation() {
      return null;
    },
    setAuth() {},
    clearAuth() {},
  };
  return { client, state };
}

const snippetRow = (id, trigger, replacement) => ({
  id,
  client_snippet_id: `cs-${id}`,
  trigger,
  replacement,
  deleted_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
});

const transcriptRow = (id, text) => ({
  id,
  client_transcription_id: `ct-${id}`,
  text,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
});

// ─── Store-level: a reset drops the previous user's rows ─────────────────────

test("SnippetsStore.resetCache drops the previous user's snippets", () => {
  const store = new SnippetsStore(null);
  store.upsertSnippetFromCloud(snippetRow("a1", "sig", "Alice signature"));
  assert.deepEqual(store.getSnippets(), [{ trigger: "sig", replacement: "Alice signature" }]);

  store.resetCache();
  assert.deepEqual(store.getSnippets(), [], "user A's snippet survived the reset");
});

test("TranscriptionsStore.resetCache drops the previous user's transcripts", () => {
  const store = new TranscriptionsStore(null);
  store.upsertTranscriptionFromCloud(transcriptRow("a1", "alice secret dictation"));
  assert.equal(store.getTranscriptions().length, 1);

  store.resetCache();
  assert.deepEqual(store.getTranscriptions(), [], "user A's transcript survived the reset");
});

test("a load() in flight for the previous user does not land in the new cache", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const store = new SnippetsStore({
    async query() {
      await gate;
      return [snippetRow("a1", "sig", "Alice signature")];
    },
    async mutation() {},
  });

  const inFlight = store.load(); // issued as user A
  store.resetCache(); // user switches to B while the query is outstanding
  release();
  await inFlight;

  assert.deepEqual(
    store.getSnippets(),
    [],
    "a response minted for user A was merged into user B's cache"
  );
});

test("NotesStore.resetCache clears notes and the id counter", () => {
  const store = new NotesStore(null);
  store.saveNote("Alice private note", "body", "note");
  assert.equal(store.getNotes().length, 1);

  store.resetCache();
  assert.deepEqual(store.getNotes(), []);
  assert.equal(store._nextId, 1);
});

// ─── Facade-level: the full user switch ──────────────────────────────────────

test("switching users replaces every cached row with the new user's data", async () => {
  const { client, state } = makeClient({
    alice: {
      snippets: [snippetRow("a1", "sig", "Alice signature")],
      transcriptions: [transcriptRow("a1", "alice dictation")],
    },
    bob: {
      snippets: [snippetRow("b1", "sig", "Bob signature")],
      transcriptions: [transcriptRow("b1", "bob dictation")],
    },
  });

  state.user = "alice";
  const db = new ConvexDatabaseManager({
    client,
    subscribeToAuth: false,
    resolveSubject: async () => null,
  });
  await db.whenReady();
  assert.deepEqual(db.getSnippets(), [{ trigger: "sig", replacement: "Alice signature" }]);
  assert.equal(db.getTranscriptions()[0].text, "alice dictation");

  state.user = "bob";
  await db.switchIdentity({ hasSession: true });

  assert.deepEqual(
    db.getSnippets(),
    [{ trigger: "sig", replacement: "Bob signature" }],
    "Bob was served Alice's snippet"
  );
  assert.equal(db.getTranscriptions().length, 1);
  assert.equal(
    db.getTranscriptions()[0].text,
    "bob dictation",
    "Bob was served Alice's transcript"
  );
});

test("sign-out clears every cache and loads nothing", async () => {
  const { client, state } = makeClient({
    alice: {
      snippets: [snippetRow("a1", "sig", "Alice signature")],
      transcriptions: [transcriptRow("a1", "alice dictation")],
    },
  });

  state.user = "alice";
  const db = new ConvexDatabaseManager({
    client,
    subscribeToAuth: false,
    resolveSubject: async () => null,
  });
  await db.whenReady();
  assert.equal(db.getSnippets().length, 1);

  const callsBefore = state.calls.length;
  await db.switchIdentity({ hasSession: false });

  assert.deepEqual(db.getSnippets(), [], "snippets survived sign-out");
  assert.deepEqual(db.getTranscriptions(), [], "transcripts survived sign-out");
  assert.deepEqual(db.getNotes(), []);
  assert.equal(
    state.calls.length,
    callsBefore,
    "a signed-out app must not query Convex for a new identity"
  );
});

test("a failed re-seed shows EMPTY, never the previous user's rows", async () => {
  const { client, state } = makeClient({
    alice: { snippets: [snippetRow("a1", "sig", "Alice signature")] },
  });

  state.user = "alice";
  const db = new ConvexDatabaseManager({
    client,
    subscribeToAuth: false,
    resolveSubject: async () => null,
  });
  await db.whenReady();
  assert.equal(db.getSnippets().length, 1);

  // Every query for the new user fails (offline, 401, whatever).
  client.query = async () => {
    throw new Error("unauthenticated");
  };
  await db.switchIdentity({ hasSession: true });

  assert.deepEqual(
    db.getSnippets(),
    [],
    "a failed load fell back to the previous user's cached rows"
  );
  // The private space is a per-install shell and must survive, or notes/folders
  // lose their default container.
  assert.ok(db.spacesStore.getPrivateSpaceId() != null);
  assert.equal(db.foldersStore.privateSpaceId, db.spacesStore.getPrivateSpaceId());
});

test("the token store's publish drives the switch (sign-in, then sign-out)", async () => {
  const { client, state } = makeClient({
    alice: { snippets: [snippetRow("a1", "sig", "Alice signature")] },
    bob: { snippets: [snippetRow("b1", "sig", "Bob signature")] },
  });

  // A stand-in for helpers/tokenStore: the real one publishes {token, generation}
  // to its subscribers on every set()/clear() that actually changes the value.
  const listeners = new Set();
  const tokenStore = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(token) {
      for (const listener of listeners) listener({ token, generation: 1 });
    },
  };

  state.user = "alice";
  const db = new ConvexDatabaseManager({ client, tokenStore, resolveSubject: async () => null });
  await db.whenReady();
  assert.equal(db.getSnippets()[0].replacement, "Alice signature");

  // Sign in as Bob — the renderer bridges his session bearer into the store.
  state.user = "bob";
  tokenStore.publish("bob-session-token");
  await db._identitySwitch;
  assert.equal(
    db.getSnippets()[0]?.replacement,
    "Bob signature",
    "Bob was served Alice's snippet after the bridged session changed"
  );

  // Sign out — the store clears its bearer. Reads are synchronous, so the caches
  // must be empty the instant publish() returns, not a microtask later.
  tokenStore.publish(null);
  assert.deepEqual(
    db.getSnippets(),
    [],
    "the previous user's snippets were still readable right after sign-out published"
  );
  await db._identitySwitch;
  assert.deepEqual(db.getSnippets(), []);
});

// ─── Group B: local JSON tables that have no server-side owner check ─────────

// Seed the account-owned local tables and return the manager.
function seedLocalAccountData(db) {
  db.googleTokensStore.replaceAll([{ id: 1, access_token: "alice-google-token" }]);
  db.contactsStore.replaceAll([{ id: 1, email: "friend-of-alice@example.com" }]);
  db.speakerProfilesStore.replaceAll([{ id: 1, name: "Alice" }]);
  db.calendarEventsStore.replaceAll([{ id: 1, title: "Alice 1:1" }]);
}

const localRowCounts = (db) => [
  db.googleTokensStore.all().length,
  db.contactsStore.all().length,
  db.speakerProfilesStore.all().length,
  db.calendarEventsStore.all().length,
];

test("signing in as a DIFFERENT account drops the local calendar/contact/voice tables", async () => {
  const { client } = makeClient({});
  let subject = "alice-subject";
  const db = new ConvexDatabaseManager({
    client,
    subscribeToAuth: false,
    resolveSubject: async () => subject,
  });
  await db.whenReady();

  // First switch records Alice as the owner of this machine's local rows.
  seedLocalAccountData(db);
  await db.switchIdentity({ hasSession: true });
  assert.deepEqual(localRowCounts(db), [1, 1, 1, 1], "Alice's own data was wiped");

  // Bob signs in on the same machine.
  subject = "bob-subject";
  await db.switchIdentity({ hasSession: true });
  assert.deepEqual(
    localRowCounts(db),
    [0, 0, 0, 0],
    "Bob inherited Alice's OAuth tokens / contacts / voice profiles"
  );
  // Alice's custom action goes too, but the built-in must come back.
  assert.equal(db.getActions().length, 1);
  assert.equal(db.getActions()[0].is_builtin, 1);
});

test("a session refresh for the SAME account never destroys local data", async () => {
  const { client } = makeClient({});
  const db = new ConvexDatabaseManager({
    client,
    subscribeToAuth: false,
    resolveSubject: async () => "alice-subject",
  });
  await db.whenReady();

  seedLocalAccountData(db);
  await db.switchIdentity({ hasSession: true }); // records Alice
  await db.switchIdentity({ hasSession: true }); // token rotated, same user
  await db.switchIdentity({ hasSession: true });

  assert.deepEqual(
    localRowCounts(db),
    [1, 1, 1, 1],
    "a same-user token rotation wiped the user's own calendar connection"
  );
});

test("an unresolvable subject leaves local data alone rather than guessing", async () => {
  const { client } = makeClient({});
  const db = new ConvexDatabaseManager({
    client,
    subscribeToAuth: false,
    resolveSubject: async () => null,
  });
  await db.whenReady();

  seedLocalAccountData(db);
  await db.switchIdentity({ hasSession: true });

  assert.deepEqual(localRowCounts(db), [1, 1, 1, 1]);
});

test("cleanup() drops group-A caches through the same reset path", async () => {
  const { client, state } = makeClient({
    alice: { snippets: [snippetRow("a1", "sig", "Alice signature")] },
  });

  state.user = "alice";
  const db = new ConvexDatabaseManager({
    client,
    subscribeToAuth: false,
    resolveSubject: async () => null,
  });
  await db.whenReady();
  assert.equal(db.getSnippets().length, 1);

  db.cleanup();
  assert.deepEqual(db.getSnippets(), []);
  assert.deepEqual(db.getTranscriptions(), []);
  // cleanup() re-seeds the built-in action and the private space.
  assert.ok(db.spacesStore.getPrivateSpaceId() != null);
  assert.equal(db.getActions().length, 1);
});
