// Local-only persistence for the DatabaseManager tables that have NO Convex
// backend (calendar tokens/events, speaker profiles/mappings/embeddings,
// actions, contacts, optimistic vector-purge journal, …). INERT: used only by
// the flag-gated ConvexDatabaseManager drop-in.
//
// The SQLite DatabaseManager stored these tables in the same on-disk database as
// the (now Convex-backed) notes/spaces/… tables. Since those moved to Convex,
// the non-Convex tables need a durable home that:
//   - carries NO native module (no native SQLite addon) — pure Node + JSON,
//   - reads/writes SYNCHRONOUSLY (main.js calls DatabaseManager methods
//     synchronously and expects the SQLite return shapes),
//   - loads under plain `node` / `node --test` where Electron's `app` is not
//     usable (so the module and its consumers stay node-checkable and testable).
//
// Each LocalStore owns one named table persisted to a single JSON file under
// `userData/convexdb-local/<name>.json`. Writes are atomic (write a temp file,
// then rename over the target). When Electron's `app` is unavailable (plain
// node, tests) the store runs in MEMORY-ONLY mode: it still behaves identically
// in-process, it just never touches disk — matching the task's "fall back to an
// in-memory-only mode when electron/app is unavailable" requirement.
//
// Buffer columns (speaker embeddings are stored as BLOBs / Node Buffers) survive
// the JSON round-trip: `JSON.stringify` renders a Buffer as
// `{ "type": "Buffer", "data": [...] }`, and load() reconstructs any such object
// back into a Buffer. Consumers therefore always see real Buffers, exactly like
// the native SQLite driver returned.

const fs = require("fs");
const path = require("path");

// Resolve the directory holding the per-table JSON files. Lazy + guarded so the
// module still loads when Electron is not present:
//   1. Electron `app.getPath("userData")` when running inside Electron.
//   2. otherwise MEMORY-ONLY (return null) — the task allows os.tmpdir OR
//      memory-only; memory-only keeps `node --test` runs from writing stray
//      files while preserving identical in-process behaviour.
let _baseDirResolved; // undefined = not resolved yet; string | null once resolved.
function resolveBaseDir() {
  if (_baseDirResolved !== undefined) return _baseDirResolved;
  _baseDirResolved = null;
  try {
    // eslint-disable-next-line global-require
    const { app } = require("electron");
    if (app && typeof app.getPath === "function") {
      const userData = app.getPath("userData");
      if (userData) {
        const dir = path.join(userData, "convexdb-local");
        try {
          fs.mkdirSync(dir, { recursive: true });
          _baseDirResolved = dir;
        } catch {
          _baseDirResolved = null;
        }
      }
    }
  } catch {
    // Electron not available (plain node / tests) → memory-only.
    _baseDirResolved = null;
  }
  return _baseDirResolved;
}

// Test/reset seam — force the next resolveBaseDir() to re-evaluate.
function _resetBaseDir() {
  _baseDirResolved = undefined;
}

// Revive Buffers that JSON.stringify flattened to { type: 'Buffer', data: [...] }.
function reviveBuffers(value) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = reviveBuffers(value[i]);
    return value;
  }
  if (value && typeof value === "object") {
    if (value.type === "Buffer" && Array.isArray(value.data)) {
      return Buffer.from(value.data);
    }
    for (const key of Object.keys(value)) value[key] = reviveBuffers(value[key]);
    return value;
  }
  return value;
}

class LocalStore {
  /**
   * @param {string} name Table name (also the JSON basename).
   */
  constructor(name) {
    this.name = name;
    this.rows = [];
    this._loaded = false;
  }

  _file() {
    const dir = resolveBaseDir();
    return dir ? path.join(dir, `${this.name}.json`) : null;
  }

  // Lazy load-on-first-use. Never throws: a missing/corrupt file yields [].
  _ensureLoaded() {
    if (this._loaded) return;
    this._loaded = true;
    const file = this._file();
    if (!file) return; // memory-only mode
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, "utf8");
        const parsed = raw ? JSON.parse(raw) : [];
        this.rows = Array.isArray(parsed) ? reviveBuffers(parsed) : [];
      }
    } catch {
      this.rows = [];
    }
  }

  // Atomic persist (temp file + rename). Best-effort: a write failure never
  // throws into a DB call path — the in-memory rows remain authoritative.
  _persist() {
    const file = this._file();
    if (!file) return; // memory-only mode
    try {
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.rows));
      fs.renameSync(tmp, file);
    } catch {
      // swallow — durability is best-effort, correctness is in-memory
    }
  }

  // ─── Synchronous table API (used by ConvexDatabaseManager) ──────────────────

  // Live row array (mutated in place by callers, then commit()ed). Reads that do
  // not mutate can use this directly; mutating callers must call commit().
  all() {
    this._ensureLoaded();
    return this.rows;
  }

  // Replace the entire row set and persist.
  replaceAll(rows) {
    this._ensureLoaded();
    this.rows = Array.isArray(rows) ? rows : [];
    this._persist();
    return this.rows;
  }

  // Persist the current in-memory rows (after in-place mutation via all()).
  commit() {
    this._ensureLoaded();
    this._persist();
  }
}

module.exports = { LocalStore, resolveBaseDir, reviveBuffers, _resetBaseDir };
