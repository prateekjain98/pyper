// Browser client for the SAME streaming dictation pipeline the desktop app uses.
//
// Mints an ephemeral OpenAI Realtime secret from the GCP proxy (POST
// /realtime-token — key held in Secret Manager), then streams 24 kHz PCM straight
// to OpenAI's realtime WSS and surfaces partial/final transcripts. This mirrors
// apps/desktop/src/helpers/openaiRealtimeStreaming.js: the desktop connects with
// an Authorization header (Node `ws`); a browser can't set WS headers, so it
// passes the same ephemeral key via the GA subprotocol instead. Same proxy, same
// OpenAI Realtime session, same events — only the runtime auth channel differs.

// AudioWorklet: float32 mic frames -> 16-bit PCM, posted to the main thread.
const PCM_WORKLET = `
class PcmDemoProcessor extends AudioWorkletProcessor {
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
registerProcessor('pcm-demo-processor', PcmDemoProcessor);
`;

const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime?intent=transcription";
const STOP_FLUSH_CEILING_MS = 2500;

export type RealtimeDictationHandle = {
  /** Stop capture, flush, and resolve with the final transcript. */
  stop: () => Promise<string>;
  /** Abandon the session without waiting for a transcript. */
  cancel: () => void;
};

export type RealtimeDictationOptions = {
  proxyUrl: string;
  model?: string;
  language?: string;
  onOpen?: () => void;
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
};

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export async function startRealtimeDictation(
  opts: RealtimeDictationOptions,
): Promise<RealtimeDictationHandle> {
  const { proxyUrl, model = "gpt-4o-mini-transcribe", language = "en" } = opts;

  // 1. Mint the ephemeral secret from the proxy (no key on the web host).
  const tokRes = await fetch(`${proxyUrl}/realtime-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, language }),
  });
  if (!tokRes.ok) {
    const detail = await tokRes.text().catch(() => "");
    throw new Error(`realtime-token failed (${tokRes.status}) ${detail.slice(0, 160)}`);
  }
  const { clientSecret } = (await tokRes.json()) as { clientSecret?: string };
  if (!clientSecret) throw new Error("proxy returned no clientSecret");

  // 2. Mic capture at 24 kHz mono -> PCM worklet.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });
  const audioCtx = new AudioContext({ sampleRate: 24000 });
  const workletUrl = URL.createObjectURL(new Blob([PCM_WORKLET], { type: "application/javascript" }));
  await audioCtx.audioWorklet.addModule(workletUrl);
  const source = audioCtx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(audioCtx, "pcm-demo-processor");

  // 3. OpenAI Realtime WSS with the ephemeral key in the GA subprotocol.
  const ws = new WebSocket(OPENAI_REALTIME_URL, [
    "realtime",
    `openai-insecure-api-key.${clientSecret}`,
  ]);

  let fullTranscript = "";
  let partialTranscript = "";
  let sessionReady = false;
  const pending: ArrayBuffer[] = [];
  let onCompleted: (() => void) | null = null;

  const sendPcm = (buf: ArrayBuffer) => {
    ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: bufToBase64(buf) }));
  };

  node.port.onmessage = (e: MessageEvent) => {
    const buf = e.data as ArrayBuffer;
    if (sessionReady && ws.readyState === WebSocket.OPEN) sendPcm(buf);
    else pending.push(buf);
  };

  ws.onmessage = (ev: MessageEvent) => {
    let m: { type?: string; delta?: string; transcript?: string; error?: { message?: string } };
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    switch (m.type) {
      case "session.created":
        sessionReady = true;
        opts.onOpen?.();
        for (const b of pending) sendPcm(b);
        pending.length = 0;
        break;
      case "conversation.item.input_audio_transcription.delta":
        partialTranscript += m.delta || "";
        opts.onPartial?.(`${fullTranscript} ${partialTranscript}`.trim());
        break;
      case "conversation.item.input_audio_transcription.completed":
        fullTranscript = `${fullTranscript} ${(m.transcript || "").trim()}`.trim();
        partialTranscript = "";
        opts.onFinal?.(fullTranscript);
        onCompleted?.();
        break;
      case "error":
        opts.onError?.(m.error?.message || "realtime error");
        break;
    }
  };
  ws.onerror = () => opts.onError?.("connection error");

  source.connect(node); // node is NOT connected to destination — no echo, worklet still runs

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
      // Stop capture immediately, nudge server-VAD with a little trailing silence,
      // then resolve on the next completed transcript (or a short ceiling).
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
          resolve(fullTranscript || partialTranscript);
        };
        onCompleted = finish;
        if (ws.readyState === WebSocket.OPEN) {
          try {
            // ~200ms of silence so VAD finalizes a turn the user cut short, then commit.
            ws.send(
              JSON.stringify({
                type: "input_audio_buffer.append",
                audio: bufToBase64(new Int16Array(4800).buffer),
              }),
            );
            ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
          } catch {
            /* noop */
          }
        }
        setTimeout(finish, STOP_FLUSH_CEILING_MS);
      });
    },
  };
}
