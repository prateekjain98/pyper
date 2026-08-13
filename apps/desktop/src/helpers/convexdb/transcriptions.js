// Transcriptions domain, migrated off SQLite onto Convex.
//
// The Electron main process still calls these methods SYNCHRONOUSLY and expects
// the exact same return shapes the SQLite DatabaseManager produced. We satisfy
// that by keeping an in-memory cache of the `transcriptions` rows: reads are
// served synchronously from memory, writes mutate memory synchronously (so a
// read-after-write is consistent) and additionally fire a best-effort async
// Convex mutation that is never awaited and never allowed to throw.
//
// Field/return-shape parity is with apps/desktop/src/helpers/database.js — the
// transcription surface of DatabaseManager:
//   saveTranscription / getTranscriptions / clearTranscriptions /
//   deleteTranscriptionsExpiredBefore / deleteTranscription /
//   updateTranscriptionAudio / updateTranscriptionText /
//   updateTranscriptionStatus / getTranscriptionById / clearAudioFlags /
//   getPendingTranscriptions / getPendingTranscriptionDeletes /
//   hardDeleteTranscription / getTranscriptionByClientId /
//   upsertTranscriptionFromCloud / markTranscriptionSynced
// and the `transcriptions` table layout declared there. Every row is a flat
// object whose keys mirror the SQLite columns, in `SELECT *` order:
//   id, text, timestamp, created_at, raw_text, has_audio, audio_duration_ms,
//   provider, model, status, error_message, error_code, route_kind,
//   client_transcription_id, cloud_id, sync_status, deleted_at
//
// Convex mapping (convex/transcriptions.ts):
//   - list   -> query,    seeds the cache in load() (newest-first, excludes
//                         tombstones); each cloud doc is folded in through the
//                         inbound-mirror path (upsertTranscriptionFromCloud) so
//                         load() and a later sync pull agree.
//   - create -> mutation, an UPSERT keyed on client_transcription_id. It is the
//                         write-through for saveTranscription AND for the
//                         update* methods (there is deliberately no dedicated
//                         Convex "update" — the backend is "append-mostly"), so
//                         each field-update re-pushes a full row snapshot
//                         (_toCloudInput) which patches the matching cloud doc.
//   - remove -> mutation, a SOFT-DELETE keyed on the Convex `_id`. It is the
//                         write-through for the tombstone branch of
//                         deleteTranscription / clearTranscriptions /
//                         deleteTranscriptionsExpiredBefore. It can only fire
//                         for rows whose cloud `_id` we already hold locally
//                         (`cloud_id`, populated by load()/upsertFromCloud/
//                         markTranscriptionSynced) — exactly the rows SQLite
//                         tombstones (`WHERE cloud_id IS NOT NULL`). Local-only
//                         rows are evicted from memory, matching the SQLite
//                         `DELETE ... WHERE cloud_id IS NULL` branch.
//
// The Convex `_id` of a freshly saved row is NOT captured here: create() is
// fire-and-forget (never awaited), so — exactly like the SQLite + sync-layer
// split — `cloud_id` stays null until a later load()/upsertTranscriptionFromCloud
// mirrors it back, or the sync orchestrator calls markTranscriptionSynced().
//
// GAPs — columns/methods with NO Convex equivalent (memory-only, called out
// again at each site):
//   - Columns has_audio, error_message, error_code, route_kind are not part of
//     the Convex schema (see toCloudTranscription), so they never propagate:
//     clearAudioFlags is entirely memory-only, and updateTranscriptionAudio /
//     updateTranscriptionStatus propagate only their cloud-modeled fields
//     (audio_duration_ms/provider/model, resp. status) via the create upsert.
//   - hardDeleteTranscription and markTranscriptionSynced are local cache
//     bookkeeping (the cloud soft-delete / id-capture they pair with is driven
//     by the sync orchestrator, not re-issued here).
//   - getPendingTranscriptions / getPendingTranscriptionDeletes expose the
//     local sync queue; Convex has no `sync_status` column, so they read purely
//     from memory.

const { randomUUID } = require("crypto");
const { anyApi } = require("convex/server");

// SQLite CURRENT_TIMESTAMP / datetime('now') render UTC as "YYYY-MM-DD HH:MM:SS"
// (no 'T', no millis, no zone). Reproduce that so `timestamp`/`created_at`
// string ordering and cutoff comparisons behave exactly like the DB.
function _formatSqliteTs(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}
function _sqliteNow() {
  return _formatSqliteTs(new Date());
}

class TranscriptionsStore {
  /**
   * @param {import("convex/browser").ConvexHttpClient | null} client Shared
   *   Convex HTTP client (created in ./client.js). May be null — then the store
   *   operates purely in-memory and never touches Convex.
   */
  constructor(client) {
    this.client = client || null;
    // local numeric id (SQLite AUTOINCREMENT analog) -> full row object
    this.transcriptions = new Map();
    this._nextId = 1;
  }

  // ─── Cache load ────────────────────────────────────────────────────────────

  // Populate the cache from Convex. Safe to call more than once (rows are
  // matched by client_transcription_id, so repeats update in place). Requests
  // the API's max page (server clamps to 500) to seed as much history as allowed.
  async load() {
    if (!this.client) return;
    let cloudRows;
    try {
      cloudRows = await this.client.query(anyApi.transcriptions.list, { limit: 500 });
    } catch (err) {
      console.warn(
        "[TranscriptionsStore] load: transcriptions.list query failed:",
        err?.message || err
      );
      return;
    }
    if (!Array.isArray(cloudRows)) return;
    for (const cloud of cloudRows) {
      // Reuse the inbound-mirror path so load() and a later sync pull agree.
      this.upsertTranscriptionFromCloud(cloud);
    }
  }

  // ─── Public API (parity with database.js) ──────────────────────────────────

  saveTranscription(
    text,
    rawText = null,
    {
      status = "completed",
      errorMessage = null,
      errorCode = null,
      routeKind = null,
      clientTranscriptionId = randomUUID(),
    } = {}
  ) {
    const id = this._allocId();
    const now = _sqliteNow();
    // Write-through: memory first (sync, consistent read-after-write) …
    const row = this._newRow({
      id,
      text,
      timestamp: now,
      created_at: now,
      raw_text: rawText,
      status,
      error_message: errorMessage,
      error_code: errorCode,
      route_kind: routeKind,
      client_transcription_id: clientTranscriptionId,
      sync_status: "pending", // SQLite column default on INSERT
    });
    this.transcriptions.set(id, row);
    // … then a best-effort Convex upsert (keyed on client_transcription_id).
    this._fireMutation(
      anyApi.transcriptions.create,
      { input: this._toCloudInput(row) },
      "saveTranscription"
    );
    return { id, success: true, transcription: this._clone(row) };
  }

  getTranscriptions(limit = 50, { includeDiscarded = false } = {}) {
    let rows = [...this.transcriptions.values()].filter((r) => r.deleted_at == null);
    if (!includeDiscarded) rows = rows.filter((r) => r.status !== "discarded");
    // Mirrors: ORDER BY timestamp DESC. Tie-break by id DESC (higher AUTOINCREMENT
    // id == more recent) so same-second inserts stay deterministically newest-first.
    rows.sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? 1 : -1;
      return b.id - a.id;
    });
    if (typeof limit === "number" && limit >= 0) rows = rows.slice(0, limit);
    return rows.map((r) => this._clone(r));
  }

  clearTranscriptions() {
    let cleared = 0;
    const now = _sqliteNow();
    for (const row of [...this.transcriptions.values()]) {
      if (row.cloud_id == null) {
        // Local-only rows: hard delete (DELETE ... WHERE cloud_id IS NULL).
        this.transcriptions.delete(row.id);
        cleared++;
      } else if (row.deleted_at == null) {
        // Cloud-backed rows: tombstone + queue for delete sync.
        row.deleted_at = now;
        row.sync_status = "pending";
        this._fireMutation(
          anyApi.transcriptions.remove,
          { id: row.cloud_id },
          "clearTranscriptions"
        );
        cleared++;
      }
    }
    return { cleared, success: true };
  }

  /** Purges transcriptions older than the retention window. Returns the affected ids so
   *  callers can drop the matching audio files. */
  deleteTranscriptionsExpiredBefore(retentionDays) {
    const cutoff = _formatSqliteTs(new Date(Date.now() - retentionDays * 86400000));
    // Resolve the id set once (deleted_at IS NULL AND created_at < cutoff) so the
    // ids we report are exactly the rows we purge. created_at is compared as a
    // string, mirroring SQLite's text comparison against datetime('now', ?).
    const expired = [];
    for (const row of this.transcriptions.values()) {
      if (row.deleted_at == null && String(row.created_at) < cutoff) expired.push(row.id);
    }
    if (expired.length === 0) return { ids: [] };

    const now = _sqliteNow();
    for (const id of expired) {
      const row = this.transcriptions.get(id);
      if (!row) continue;
      if (row.cloud_id == null) {
        this.transcriptions.delete(id);
      } else {
        row.deleted_at = now;
        row.sync_status = "pending";
        this._fireMutation(
          anyApi.transcriptions.remove,
          { id: row.cloud_id },
          "deleteTranscriptionsExpiredBefore"
        );
      }
    }
    return { ids: expired };
  }

  deleteTranscription(id) {
    const row = this._get(id);
    if (!row || row.deleted_at) return { success: false, id };
    if (row.cloud_id != null) {
      // Cloud-backed: tombstone (sync will propagate the delete via remove).
      row.deleted_at = _sqliteNow();
      row.sync_status = "pending";
      this._fireMutation(
        anyApi.transcriptions.remove,
        { id: row.cloud_id },
        "deleteTranscription"
      );
    } else {
      // Local-only: hard delete.
      this.transcriptions.delete(row.id);
    }
    return { success: true, id };
  }

  updateTranscriptionAudio(id, { hasAudio, audioDurationMs, provider, model } = {}) {
    const row = this._get(id);
    if (row) {
      row.has_audio = hasAudio; // GAP: has_audio has no Convex column — memory-only.
      row.audio_duration_ms = audioDurationMs;
      row.provider = provider;
      row.model = model;
      // Propagate the cloud-modeled fields (audio_duration_ms/provider/model)
      // via the create upsert; has_audio stays local.
      if (!row.deleted_at) {
        this._fireMutation(
          anyApi.transcriptions.create,
          { input: this._toCloudInput(row) },
          "updateTranscriptionAudio"
        );
      }
    }
    return { success: true };
  }

  updateTranscriptionText(id, text, rawText) {
    const row = this._get(id);
    if (row) {
      row.text = text;
      row.raw_text = rawText;
      if (!row.deleted_at) {
        this._fireMutation(
          anyApi.transcriptions.create,
          { input: this._toCloudInput(row) },
          "updateTranscriptionText"
        );
      }
    }
    return { success: true };
  }

  updateTranscriptionStatus(id, status, errorMessage = null, errorCode = null) {
    const row = this._get(id);
    if (row) {
      row.status = status;
      // GAP: error_message/error_code have no Convex column — memory-only.
      row.error_message = errorMessage;
      row.error_code = errorCode;
      // Only `status` is cloud-modeled; it rides the create upsert.
      if (!row.deleted_at) {
        this._fireMutation(
          anyApi.transcriptions.create,
          { input: this._toCloudInput(row) },
          "updateTranscriptionStatus"
        );
      }
    }
    return { success: true };
  }

  getTranscriptionById(id) {
    // NOTE: like SQLite, this does NOT filter deleted_at — a soft-deleted row is
    // still returned by id.
    const row = this._get(id);
    return row ? this._clone(row) : null;
  }

  clearAudioFlags(ids) {
    if (!ids || ids.length === 0) return { success: true };
    // GAP: has_audio has no Convex column — this is memory-only, no write-through.
    for (const id of ids) {
      const row = this._get(id);
      if (row) row.has_audio = 0;
    }
    return { success: true };
  }

  getPendingTranscriptions() {
    // Local sync queue — Convex has no `sync_status`, so this reads from memory.
    return [...this.transcriptions.values()]
      .filter((r) => r.sync_status === "pending" && r.deleted_at == null)
      .map((r) => this._clone(r));
  }

  getPendingTranscriptionDeletes() {
    // Local sync queue — memory-only for the same reason as above.
    return [...this.transcriptions.values()]
      .filter(
        (r) => r.deleted_at != null && r.cloud_id != null && r.sync_status === "pending"
      )
      .map((r) => this._clone(r));
  }

  hardDeleteTranscription(id) {
    // Local cache eviction only. In the sync flow this pairs with an already-
    // issued cloud remove(); re-firing it here would be redundant, so — like
    // purgeSpace in spaces.js — this is memory-only.
    const row = this._get(id);
    const existed = !!row;
    if (row) this.transcriptions.delete(row.id);
    return { success: existed, id };
  }

  getTranscriptionByClientId(clientId) {
    // NOTE: like SQLite, no deleted_at filter here.
    for (const row of this.transcriptions.values()) {
      if (row.client_transcription_id === clientId) return this._clone(row);
    }
    return null;
  }

  // Inbound mirror: cloud transcription -> local cache. The data already lives
  // in Convex (this is called from load() and from a sync pull), so this is
  // memory-only — writing it back would be circular. Reproduces the SQLite
  // upsert's SUBSET semantics exactly: only client_transcription_id/cloud_id/
  // text/raw_text/status/sync_status/created_at participate; provider, model,
  // audio_duration_ms, has_audio, etc. are NOT part of the sync contract and
  // keep their defaults (insert) or existing values (conflict update).
  upsertTranscriptionFromCloud(cloudTranscription) {
    const text = cloudTranscription.text ?? "";
    const rawText = cloudTranscription.raw_text || null;
    const status = cloudTranscription.status || "completed";
    const cloudId = cloudTranscription.id;
    const clientId = cloudTranscription.client_transcription_id;

    let existing = null;
    for (const row of this.transcriptions.values()) {
      if (row.client_transcription_id === clientId) {
        existing = row;
        break;
      }
    }
    if (existing) {
      // ON CONFLICT(client_transcription_id) DO UPDATE SET (5 columns only) —
      // timestamp/created_at/has_audio/provider/... are intentionally untouched.
      existing.cloud_id = cloudId;
      existing.text = text;
      existing.raw_text = rawText;
      existing.status = status;
      existing.sync_status = "synced";
      return this._clone(existing);
    }

    const id = this._allocId();
    const row = this._newRow({
      id,
      text,
      // INSERT sets created_at from the cloud row but leaves `timestamp` to its
      // CURRENT_TIMESTAMP default (= now), so a mirrored row sorts by mirror time.
      timestamp: _sqliteNow(),
      created_at: cloudTranscription.created_at,
      raw_text: rawText,
      status,
      client_transcription_id: clientId,
      cloud_id: cloudId,
      sync_status: "synced",
    });
    this.transcriptions.set(id, row);
    return this._clone(row);
  }

  markTranscriptionSynced(id, cloudId) {
    // Local bookkeeping: records the cloud `_id` after a push so later
    // updates/deletes can reference it. Convex has no `sync_status`, and the
    // push already happened, so this is memory-only (cf. setSpaceSyncStatus).
    const row = this._get(id);
    if (row) {
      row.sync_status = "synced";
      row.cloud_id = cloudId;
    }
    return { success: true };
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  _allocId() {
    const id = this._nextId;
    this._nextId = id + 1;
    return id;
  }

  // Build a full row with every SQLite column present (in SELECT * order) and
  // defaults applied, overridden by `overrides`. Keeps the object shape byte-for-
  // byte parallel to a SQLite `SELECT *` result.
  _newRow(overrides) {
    return {
      id: overrides.id,
      text: overrides.text ?? "",
      timestamp: overrides.timestamp,
      created_at: overrides.created_at,
      raw_text: overrides.raw_text ?? null,
      has_audio: overrides.has_audio ?? 0,
      audio_duration_ms: overrides.audio_duration_ms ?? null,
      provider: overrides.provider ?? null,
      model: overrides.model ?? null,
      status: overrides.status ?? "completed",
      error_message: overrides.error_message ?? null,
      error_code: overrides.error_code ?? null,
      route_kind: overrides.route_kind ?? null,
      client_transcription_id: overrides.client_transcription_id ?? null,
      cloud_id: overrides.cloud_id ?? null,
      sync_status: overrides.sync_status ?? "pending",
      deleted_at: overrides.deleted_at ?? null,
    };
  }

  // Map a cached row -> Convex `create` input. Only cloud-modeled fields are
  // sent; language/word_count/source are absent locally, so they're omitted and
  // left to their Convex defaults (null on insert, unchanged on patch).
  _toCloudInput(row) {
    return {
      client_transcription_id: row.client_transcription_id,
      text: row.text ?? "",
      raw_text: row.raw_text ?? null,
      provider: row.provider ?? null,
      model: row.model ?? null,
      audio_duration_ms: row.audio_duration_ms ?? null,
      status: row.status ?? null,
      created_at: row.created_at,
    };
  }

  // Look up by numeric id, tolerating a numeric-string id from IPC callers.
  _get(id) {
    if (this.transcriptions.has(id)) return this.transcriptions.get(id);
    const n = Number(id);
    if (!Number.isNaN(n) && this.transcriptions.has(n)) return this.transcriptions.get(n);
    return null;
  }

  // Defensive copy so callers can't mutate the cache. Rows are flat (all
  // primitive columns), so a shallow spread is sufficient.
  _clone(row) {
    return { ...row };
  }

  // Fire a Convex mutation without awaiting; never throw from a write path just
  // because Convex is unavailable.
  _fireMutation(fnRef, args, label) {
    if (!this.client) return;
    try {
      const p = this.client.mutation(fnRef, args);
      if (p && typeof p.catch === "function") {
        p.catch((err) =>
          console.warn(
            `[TranscriptionsStore] ${label} write-through failed:`,
            err?.message || err
          )
        );
      }
    } catch (err) {
      console.warn(
        `[TranscriptionsStore] ${label} write-through threw:`,
        err?.message || err
      );
    }
  }
}

module.exports = { TranscriptionsStore };
