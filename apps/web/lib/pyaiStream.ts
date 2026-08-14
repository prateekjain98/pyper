// Browser client for PyAI live streaming transcription — the SAME engine the
// desktop app uses, streamed live. Connects to the GCP proxy's WebSocket relay
// (services/pyai-proxy/server.js → WSS /transcribe/stream), which forwards 16 kHz
// mono PCM16 frames to PyAI Hear with the shared key in the subprotocol, so no key
// ever reaches the browser. PyAI returns { type: "partial" | "final" } JSON frames
// that we surface as live transcript updates; stop() commits and resolves the final.
//
// This restores the live word-by-word demo UX while keeping the STT engine in sync
// with the product (PyAI, not OpenAI Realtime). The proxy only advertises this
// relay in /health (transcription.streaming.available) once it's deployed with the
// relay; callers should gate on that and fall back to batch POST /transcribe.

// AudioWorklet: float32 mic frames -> 16-bit PCM, posted to the main thread.
const PCM_WORKLET = `
class PyaiPcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      const pcm = new Int16Array(ch.length);
      for (let i = 0; i < ch.length; i++) {
        const s = Math.max(-1, Math.min(1, ch[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      // structured-clone (no transfer) so buffering before the socket is open is safe
      this.port.postMessage(pcm.buffer);
    }
    return true;
  }
}
registerProcessor('pyai-pcm-processor', PyaiPcmProcessor);
`;

const SAMPLE_RATE = 16000;
const STOP_FLUSH_CEILING_MS = 2500;

export type PyaiStreamHandle = {
  /** Stop capture, commit, and resolve with the final transcript. */
  stop: () => Promise<string>;
  /** Abandon the session without waiting for a transcript. */
  cancel: () => void;
};

export type PyaiStreamOptions = {
  /** Proxy origin (http/https) — converted to ws/wss for the relay. */
  proxyUrl: string;
  model?: string;
  language?: string;
  onOpen?: () => void;
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
};

// PyAI Hear frames vary in field name across versions; pull the transcript text
// defensively so a schema tweak doesn't silently blank the demo.
function frameText(m: {
  text?: string;
  transcript?: string;
  delta?: string;
  channel?: { alternatives?: { transcript?: string }[] };
}): string {
  return (
    m.text ??
    m.transcript ??
    m.delta ??
    m.channel?.alternatives?.[0]?.transcript ??
    ""
  );
}

export async function startPyaiStream(opts: PyaiStreamOptions): Promise<PyaiStreamHandle> {
  const { proxyUrl, model = "pyai-hear", language = "en" } = opts;

  // 1. Mic capture at 16 kHz mono -> PCM worklet.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });
  const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const workletUrl = URL.createObjectURL(new Blob([PCM_WORKLET], { type: "application/javascript" }));
  await audioCtx.audioWorklet.addModule(workletUrl);
  const source = audioCtx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(audioCtx, "pyai-pcm-processor");

  // 2. Open the proxy relay WSS. The proxy holds the PyAI key; the browser sends none.
  const wsBase = proxyUrl.replace(/^http/, "ws").replace(/\/+$/, "");
  const q = new URLSearchParams({
    model,
    sample_rate: String(SAMPLE_RATE),
    encoding: "pcm16",
    language,
  });
  const ws = new WebSocket(`${wsBase}/transcribe/stream?${q.toString()}`);
  ws.binaryType = "arraybuffer";

  let committed = "";
  let partial = "";
  let currentUtt: string | undefined;
  let socketOpen = false;
  const pending: ArrayBuffer[] = [];
  let onCompleted: (() => void) | null = null;

  // PyAI marks in-progress hypotheses with a "partial"/"partial_stable" type and a
  // finished utterance with a "final"/"utterance_end" type. Match finals by pattern
  // (excluding anything "partial") so a naming tweak doesn't drop the commit.
  const isFinalType = (t?: string) =>
    !!t && /final|utterance_end|complete/i.test(t) && !/partial/i.test(t);

  node.port.onmessage = (e: MessageEvent) => {
    const buf = e.data as ArrayBuffer;
    if (socketOpen && ws.readyState === WebSocket.OPEN) ws.send(buf);
    else pending.push(buf);
  };

  ws.onopen = () => {
    socketOpen = true;
    opts.onOpen?.();
    for (const b of pending) ws.send(b);
    pending.length = 0;
  };

  ws.onmessage = (ev: MessageEvent) => {
    if (typeof ev.data !== "string") return; // ignore any binary echo
    let m: { type?: string; utterance_id?: string; message?: string } & Parameters<
      typeof frameText
    >[0];
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (m.type === "error") {
      opts.onError?.(m.message || frameText(m) || "pyai stream error");
      return;
    }
    const text = frameText(m).trim();
    // A new utterance id means the previous utterance is settled — bank its text so
    // multi-sentence dictation accumulates instead of the new partial overwriting it.
    if (m.utterance_id && currentUtt && m.utterance_id !== currentUtt && partial) {
      committed = `${committed} ${partial}`.trim();
      partial = "";
    }
    if (m.utterance_id) currentUtt = m.utterance_id;

    if (isFinalType(m.type)) {
      if (text) committed = `${committed} ${text}`.trim();
      partial = "";
      opts.onFinal?.(committed);
      onCompleted?.();
    } else {
      // partial / partial_stable / interim → the in-progress hypothesis
      partial = text;
      opts.onPartial?.(`${committed} ${partial}`.trim());
    }
  };
  ws.onerror = () => opts.onError?.("connection error");

  source.connect(node); // not connected to destination — no echo, worklet still runs

  const teardown = () => {
    try {
      node.port.onmessage = null;
      node.disconnect();
      source.disconnect();
    } catch {
      /* already gone */
    }
    stream.getTracks().forEach((t) => t.stop());
    audioCtx.close().catch(() => {});
    URL.revokeObjectURL(workletUrl);
  };

  return {
    cancel() {
      teardown();
      try {
        ws.close();
      } catch {
        /* noop */
      }
    },
    stop() {
      // Stop capturing immediately, ask the server to finalize the turn, then resolve
      // on the next final frame (or a short ceiling if none arrives).
      try {
        node.disconnect();
        source.disconnect();
      } catch {
        /* noop */
      }
      return new Promise<string>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          teardown();
          try {
            ws.close();
          } catch {
            /* noop */
          }
          resolve((`${committed} ${partial}`).trim());
        };
        onCompleted = finish;
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "commit" }));
          } catch {
            /* noop */
          }
        }
        setTimeout(finish, STOP_FLUSH_CEILING_MS);
      });
    },
  };
}
