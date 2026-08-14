const WebSocket = require("ws");
const debugLogger = require("./debugLogger");

// PyAI Hear live streaming, via the GCP proxy relay (services/pyai-proxy/server.js
// → WSS /transcribe/stream). UNLIKE openaiRealtimeStreaming.js there is NO token
// mint and NO client key: the relay injects the shared PyAI key server-side, which
// is the whole reason it exists (Pyper Cloud has no PyAI key on the client). The
// client just opens the WSS, streams raw PCM16 (16 kHz mono), and sends a text
// {"type":"commit"} to force end-of-turn on key release. PyAI returns JSON frames
// { type: "partial" | "partial_stable" | "final", text/transcript, utterance_id }.
//
// Interface mirrors OpenAIRealtimeStreaming (the subset ipcHandlers.js drives):
// onPartialTranscript / onFinalTranscript / onError / onSessionEnd, beginConnecting(),
// connect(), sendAudio(), disconnect(), isConnected.

const WEBSOCKET_TIMEOUT_MS = 15000;
const COMMIT_TIMEOUT_MS = 2500;
const SAMPLE_RATE = 16000; // PyAI Hear streams at 16 kHz mono; capture is already 16 kHz.
const COLD_START_BUFFER_MAX = 3 * SAMPLE_RATE * 2; // 3s of 16-bit PCM
const KEEPALIVE_INTERVAL_MS = 15000;

// PyAI frames vary in field name across versions; pull the transcript text
// defensively so a schema tweak doesn't silently blank the transcript.
function frameText(m) {
  return (
    m.text ??
    m.transcript ??
    m.delta ??
    m.channel?.alternatives?.[0]?.transcript ??
    ""
  );
}

// PyAI marks in-progress hypotheses "partial"/"partial_stable" and a finished
// utterance "final"/"utterance_end". Match finals by pattern (excluding anything
// "partial") so a naming tweak doesn't drop the commit.
function isFinalType(t) {
  // Word-boundary anchored so "incomplete" can't read as final; still matches
  // final / utterance_end / complete / completed. The !partial guard keeps
  // partial_stable interim.
  return !!t && /\b(final|utterance_end|complete)/i.test(t) && !/partial/i.test(t);
}

class PyaiRealtimeStreaming {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.isDisconnecting = false;
    this.completedSegments = [];
    this.currentPartial = "";
    this.currentUtteranceId = null;
    this.onPartialTranscript = null;
    this.onFinalTranscript = null;
    this.onError = null;
    this.onSessionEnd = null;
    this.pendingResolve = null;
    this.pendingReject = null;
    this.connectionTimeout = null;
    this.audioBytesSent = 0;
    this.model = "pyai-hear";
    this.language = null;
    this.coldStartBuffer = [];
    this.coldStartBufferSize = 0;
    this.bufferingAudio = false;
    this.keepAliveInterval = null;
  }

  // Buffer audio immediately, before the socket exists — covers the handshake
  // window so sendAudio() doesn't drop the start of a recording.
  beginConnecting() {
    this.bufferingAudio = true;
    this.coldStartBuffer = [];
    this.coldStartBufferSize = 0;
  }

  getFullTranscript() {
    return [...this.completedSegments, this.currentPartial]
      .map((s) => (s || "").trim())
      .filter(Boolean)
      .join(" ");
  }

  buildRelayUrl(proxyUrl) {
    const wsBase = String(proxyUrl || "")
      .replace(/^http/, "ws")
      .replace(/\/+$/, "");
    const q = new URLSearchParams({
      model: this.model,
      sample_rate: String(SAMPLE_RATE),
      encoding: "pcm16",
      numerals: "true",
    });
    if (this.language && /^[a-z]{2,3}$/i.test(this.language) && this.language.toLowerCase() !== "auto") {
      q.set("language", this.language.toLowerCase());
    }
    return `${wsBase}/transcribe/stream?${q.toString()}`;
  }

  async connect(options = {}) {
    const { proxyUrl, model, language, createSocket } = options;
    if (this.isConnected || this.isConnecting) {
      debugLogger.debug("PyAI Realtime already connected/connecting");
      return;
    }
    if (!proxyUrl && !createSocket) throw new Error("PyAI proxy URL is required");
    if (!this.bufferingAudio) this.beginConnecting();

    this.isConnecting = true;
    this.model = model || "pyai-hear";
    this.language = language || null;
    this.completedSegments = [];
    this.currentPartial = "";
    this.currentUtteranceId = null;
    this.audioBytesSent = 0;

    const url = this.buildRelayUrl(proxyUrl);
    debugLogger.debug("PyAI Realtime connecting", { model: this.model, hasLanguage: !!this.language });

    let ws;
    try {
      // No key/token — the relay injects the shared PyAI key. Non-browser clients
      // send no Origin and are allowed by the relay's upgrade gate.
      ws = createSocket ? await createSocket() : new WebSocket(url);
    } catch (err) {
      this.isConnecting = false;
      this.cleanup();
      throw err;
    }

    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.connectionTimeout = setTimeout(() => {
        this.isConnecting = false;
        this.cleanup();
        reject(new Error("PyAI Realtime connection timeout"));
      }, WEBSOCKET_TIMEOUT_MS);

      this.ws = ws;

      this.ws.on("open", () => {
        debugLogger.debug("PyAI Realtime WebSocket opened");
        this._markConnected();
        this._flushColdStart();
      });

      this.ws.on("message", (data, isBinary) => {
        if (isBinary) return; // relay echoes only JSON text frames
        this.handleMessage(data);
      });

      this.ws.on("error", (error) => {
        const wasActive = this.isConnected;
        debugLogger.error("PyAI Realtime WebSocket error", { error: error.message });
        this.isConnecting = false;
        this.cleanup();
        if (this.pendingReject) {
          this.pendingReject(error);
          this.pendingReject = null;
          this.pendingResolve = null;
        } else if (wasActive && !this.isDisconnecting) {
          this.onError?.(error);
        }
      });

      this.ws.on("close", (code, reason) => {
        const wasActive = this.isConnected;
        this.isConnecting = false;
        debugLogger.debug("PyAI Realtime WebSocket closed", { code, reason: reason?.toString(), wasActive });
        if (this.pendingReject) {
          this.pendingReject(new Error(`PyAI stream closed before ready (code: ${code})`));
          this.pendingReject = null;
          this.pendingResolve = null;
        }
        this.cleanup();
        if (wasActive && !this.isDisconnecting) {
          this.onSessionEnd?.({ text: this.getFullTranscript() });
        }
      });
    });
  }

  handleMessage(data) {
    let m;
    try {
      m = JSON.parse(data.toString());
    } catch {
      return; // ignore non-JSON frames
    }
    if (m.type === "error") {
      const msg = m.message || frameText(m) || "PyAI stream error";
      // The end-of-turn nudge we send on key release is a text {type:"commit"}
      // control frame. Some PyAI Hear versions don't recognize it and answer with
      // an error frame ("unknown type 'commit'"). That's benign — commit is
      // best-effort (disconnect() still finalizes via the commit timeout / close),
      // so swallow an unknown-control-frame rejection instead of surfacing a
      // "Streaming Error" toast (which also aborts the dictation). Real stream
      // errors still propagate.
      if (/\b(unknown|unsupported)\b.*\btype\b/i.test(msg) || /['"]?commit['"]?/i.test(msg)) {
        debugLogger.debug("PyAI Realtime ignoring benign control-frame rejection", { message: msg });
        return;
      }
      debugLogger.error("PyAI Realtime error frame", { message: msg });
      this.onError?.(new Error(msg));
      return;
    }

    const text = frameText(m).trim();
    // A new utterance id means the previous utterance settled — bank its partial so
    // multi-sentence dictation accumulates instead of the new partial overwriting it.
    if (m.utterance_id && this.currentUtteranceId && m.utterance_id !== this.currentUtteranceId && this.currentPartial) {
      this.completedSegments.push(this.currentPartial.trim());
      this.currentPartial = "";
    }
    if (m.utterance_id) this.currentUtteranceId = m.utterance_id;

    if (isFinalType(m.type)) {
      if (text) this.completedSegments.push(text);
      this.currentPartial = "";
      const full = this.getFullTranscript();
      if (text) this.onFinalTranscript?.(full, Date.now());
    } else {
      // partial / partial_stable / interim → the in-progress hypothesis
      this.currentPartial = text;
      this.onPartialTranscript?.(this.getFullTranscript());
    }
  }

  _markConnected() {
    if (this.isConnected) return;
    this.isConnected = true;
    this.isConnecting = false;
    clearTimeout(this.connectionTimeout);
    this.startKeepAlive();
    if (this.pendingResolve) {
      this.pendingResolve();
      this.pendingResolve = null;
      this.pendingReject = null;
    }
  }

  _flushColdStart() {
    if (!this.coldStartBuffer.length) return;
    debugLogger.debug("PyAI Realtime flushing cold-start buffer", {
      chunks: this.coldStartBuffer.length,
      bytes: this.coldStartBufferSize,
    });
    for (const buf of this.coldStartBuffer) {
      try {
        this.ws.send(buf);
        this.audioBytesSent += buf.length;
      } catch {
        /* socket died mid-flush */
      }
    }
    this.coldStartBuffer = [];
    this.coldStartBufferSize = 0;
  }

  // Warm connections sit idle for up to 5 minutes; a silent path death (sleep/wake,
  // VPN toggle) leaves isConnected stuck true. Ping to detect and terminate.
  startKeepAlive() {
    this.stopKeepAlive();
    const socket = this.ws;
    if (!socket) return;
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });
    this.keepAliveInterval = setInterval(() => {
      if (socket !== this.ws || socket.readyState !== WebSocket.OPEN) {
        this.stopKeepAlive();
        return;
      }
      if (socket.isAlive === false) {
        debugLogger.debug("PyAI Realtime keep-alive missed pong, terminating stale connection");
        socket.terminate();
        return;
      }
      socket.isAlive = false;
      try {
        socket.ping();
      } catch {
        socket.terminate();
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  stopKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  sendAudio(pcmBuffer) {
    const isOpen = this.ws?.readyState === WebSocket.OPEN;
    if (!isOpen) {
      if (this.bufferingAudio && this.coldStartBufferSize < COLD_START_BUFFER_MAX) {
        const copy = Buffer.from(pcmBuffer);
        this.coldStartBuffer.push(copy);
        this.coldStartBufferSize += copy.length;
      }
      return false;
    }
    try {
      this.ws.send(Buffer.from(pcmBuffer)); // raw binary PCM16 frame
      this.audioBytesSent += pcmBuffer.length;
      return true;
    } catch {
      return false;
    }
  }

  async disconnect({ commit = true } = {}) {
    debugLogger.debug("PyAI Realtime disconnect", {
      audioBytesSent: this.audioBytesSent,
      segments: this.completedSegments.length,
      textLength: this.getFullTranscript().length,
      readyState: this.ws?.readyState,
    });

    if (!this.ws) return { text: this.getFullTranscript() };
    this.isDisconnecting = true;

    if (this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.once("open", () => this.ws?.close());
      const result = { text: this.getFullTranscript() };
      this.isDisconnecting = false;
      return result;
    }

    if (this.ws.readyState === WebSocket.OPEN && commit && this.audioBytesSent > 0) {
      // Force end-of-turn and resolve on the next final frame (or a short ceiling).
      const prevOnFinal = this.onFinalTranscript;
      const prevOnError = this.onError;
      await new Promise((resolve) => {
        const tid = setTimeout(() => {
          debugLogger.debug("PyAI Realtime commit timeout, using accumulated text");
          resolve();
        }, COMMIT_TIMEOUT_MS);
        const done = () => {
          clearTimeout(tid);
          this.onFinalTranscript = prevOnFinal;
          this.onError = prevOnError;
          resolve();
        };
        this.onFinalTranscript = (text, ts) => {
          prevOnFinal?.(text, ts);
          done();
        };
        this.onError = (err) => {
          prevOnError?.(err);
          done();
        };
        try {
          this.ws.send(JSON.stringify({ type: "commit" }));
        } catch {
          done();
        }
      });
    }

    try {
      this.ws?.close();
    } catch {
      /* noop */
    }
    const result = { text: this.getFullTranscript() };
    this.cleanup();
    this.isDisconnecting = false;
    return result;
  }

  cleanup() {
    clearTimeout(this.connectionTimeout);
    this.connectionTimeout = null;
    this.stopKeepAlive();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* noop */
      }
      this.ws = null;
    }
    this.isConnected = false;
    this.isConnecting = false;
    this.bufferingAudio = false;
  }
}

module.exports = PyaiRealtimeStreaming;
