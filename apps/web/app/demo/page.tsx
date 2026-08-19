"use client";

// Live demo of Pyper's dictation pipeline — the EXACT same engine the desktop app
// (the main product) uses: transcribe with PyAI on the GCP proxy, then clean the
// transcript per target app via the same proxy /cleanup. STT prefers PyAI's live
// streaming relay (WSS /transcribe/stream — words appear as you speak) and falls
// back to record-then-transcribe (POST /transcribe → pyai-hear, Whisper fallback)
// when the proxy doesn't offer streaming. The cleaned output only appears on stop —
// the formatting pass needs the whole utterance. See services/pyai-proxy/server.js
// (/transcribe, /transcribe/stream, /cleanup) and apps/web/lib/pyaiStream.ts.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  AudioLines,
  Code2,
  Command,
  Database,
  FileText,
  Mail,
  MessageSquare,
  Mic,
  MousePointerClick,
  NotebookPen,
  Sparkles,
  Type,
  Wand2,
} from "lucide-react";
import { ThinkingOrb } from "@/components/ui/thinking-orbs";
import type { OrbState } from "@/components/ui/thinking-orbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/ui/header";
import { startPyaiStream, type PyaiStreamHandle } from "@/lib/pyaiStream";
import { DATASET_EXAMPLES, type ExampleChannel } from "./examples";

// Transcription goes through Pyper's own PyAI engine via a Cloud Run proxy that
// holds the key (GCP Secret Manager), so the web host (Vercel) needs NO secret.
// The URL is PUBLIC and the proxy is CORS- + key-gated, so it's safe to ship as
// the default — production works with zero env config. Override per-env (e.g.
// local dev) with NEXT_PUBLIC_TRANSCRIBE_URL.
const TRANSCRIBE_URL =
  process.env.NEXT_PUBLIC_TRANSCRIBE_URL ||
  "https://pyai-proxy-772208668555.us-central1.run.app/transcribe";
// The same proxy serves /health and /cleanup — so the full transcribe → clean-up
// pipeline runs through Pyper's engines with NO secret on the web host.
const HEALTH_URL = TRANSCRIBE_URL.replace(/\/transcribe\/?$/, "/health");
const CLEANUP_URL = TRANSCRIBE_URL.replace(/\/transcribe\/?$/, "/cleanup");
// Proxy origin — the PyAI live-streaming relay lives at `${PROXY_ORIGIN}/transcribe/stream`.
const PROXY_ORIGIN = TRANSCRIBE_URL.replace(/\/transcribe\/?$/, "");

type Stage = "idle" | "hover" | "recording" | "transcribing" | "formatting";

// Target app for the cleaned output — tunes the cleanup tone (the proxy /cleanup
// applies a matching style directive). "notes" is the neutral default.
type Channel = "notes" | "slack" | "gmail";

// Result of cleaning one channel. A discriminated union so a transient engine
// failure (e.g. 429 rate-limit) is never silently treated as a successful clean:
// "failed" is surfaced honestly instead of being dressed up as formatted text.
type CleanOutcome =
  | { status: "ok"; text: string }
  | { status: "unavailable" }
  | { status: "failed"; message: string };

const CHANNELS: {
  key: Channel;
  label: string;
  icon: typeof Mic;
  hint: string;
}[] = [
  { key: "notes", label: "Notes", icon: NotebookPen, hint: "short & precise" },
  {
    key: "slack",
    label: "Slack",
    icon: MessageSquare,
    hint: "slightly informal",
  },
  { key: "gmail", label: "Gmail", icon: Mail, hint: "formal & respectful" },
];

// Presentation meta for the reference-dataset gallery below (see ./examples.ts).
// One entry per resolved channel style the cloud pipeline can produce.
const EXAMPLE_CHANNEL_META: Record<
  ExampleChannel,
  { label: string; icon: typeof Mic; hint: string }
> = {
  gmail: { label: "Email", icon: Mail, hint: "formal · greeting + sign-off" },
  slack: { label: "Slack", icon: MessageSquare, hint: "casual · no sign-off" },
  notes: { label: "Notes", icon: NotebookPen, hint: "terse · bullets" },
  docs: { label: "Docs", icon: FileText, hint: "clean prose" },
  code: { label: "Code", icon: Code2, hint: "technical · imperative" },
  default: { label: "Default", icon: Type, hint: "plain cleanup" },
};

// Filter chips for the gallery — "all" plus every channel that has an example.
const EXAMPLE_FILTERS: (ExampleChannel | "all")[] = [
  "all",
  ...(Array.from(
    new Set(DATASET_EXAMPLES.map((e) => e.channel)),
  ) as ExampleChannel[]),
];

type EngineStatus = {
  available: boolean;
  provider: string;
  model: string | null;
  apiKeyEnv: string | null;
  reason?: string | null;
};

const ORB: Record<Stage, OrbState> = {
  idle: "breathing",
  hover: "searching",
  recording: "listening",
  transcribing: "working",
  formatting: "solving",
};

/**
 * A real worked example shown until the visitor records their own. Without it
 * the page opens as four empty boxes and reads as broken. The three variants
 * mirror the actual rules in services/pyai-proxy/channelStyles.js — notes are
 * terse fragments, Slack is casual with no greeting, Gmail gains a greeting and
 * sign-off on their own lines. Clearly labelled "sample" so it is never mistaken
 * for the visitor's own transcript.
 */
const SAMPLE = {
  raw: "um so I looked at the numbers again and I think the— the pricing page is uh the issue, can we maybe move the review to like Thursday afternoon if that works",
  notes:
    "• Pricing page — main issue (per the numbers)\n• Move review → Thursday afternoon",
  slack:
    "Numbers say the pricing page is the problem — can we move the review to Thursday afternoon?",
  gmail:
    "Hi,\n\nLooking at the numbers again, the pricing page appears to be the issue. Could we move the review to Thursday afternoon?\n\nThanks,",
} as const;

const STATUS: Record<Stage, string> = {
  idle: "Ready — hold Space or tap ` to dictate",
  hover: "Ready — hold Space or tap ` to dictate",
  recording: "Listening… speak now, release / tap to stop",
  transcribing: "Finishing transcript…",
  formatting: "Cleaning up…",
};

const PIPELINE: { key: Stage; label: string; icon: typeof Mic }[] = [
  { key: "recording", label: "Record", icon: Mic },
  { key: "transcribing", label: "Transcribe", icon: AudioLines },
  { key: "formatting", label: "Clean up", icon: Wand2 },
];

// pyai-hear (and most cloud STT) accept WAV, not the webm/opus MediaRecorder
// produces (PyAI 400s on webm). Decode the recording and re-encode it as
// 16 kHz mono 16-bit PCM WAV in the browser before upload.
async function blobToWav16k(blob: Blob): Promise<Blob> {
  const AC: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new AC({ sampleRate: 16000 });
  let audio: AudioBuffer;
  try {
    audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    void ctx.close();
  }
  const n = audio.length;
  const mono = new Float32Array(n);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += data[i] / audio.numberOfChannels;
  }
  const rate = 16000;
  const out = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  out.setUint32(4, 36 + n * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true); // PCM
  out.setUint16(22, 1, true); // mono
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  str(36, "data");
  out.setUint32(40, n * 2, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    out.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([out.buffer], { type: "audio/wav" });
}

export default function Demo() {
  const [stage, setStage] = useState<Stage>("idle");
  const [heard, setHeard] = useState(""); // raw engine transcript
  // Polished output for every target app — all shown side by side.
  const [cleaned, setCleaned] = useState<Record<Channel, string>>({
    notes: "",
    slack: "",
    gmail: "",
  });
  const [note, setNote] = useState<string | null>(null);
  // Set only when the cleanup engine actually failed on this attempt (429/502/etc.).
  // Drives an honest "couldn't format" state instead of fabricated card content.
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const [stt, setStt] = useState<EngineStatus | null>(null);
  const [cleanup, setCleanup] = useState<EngineStatus | null>(null);
  // Which channel the reference-dataset gallery is filtered to ("all" = show every case).
  const [exampleFilter, setExampleFilter] = useState<ExampleChannel | "all">(
    "all",
  );

  const stageRef = useRef<Stage>("idle");
  // Two PyAI capture paths, both the SAME engine the desktop uses:
  //  • Live streaming via the proxy WSS relay (/transcribe/stream) — preferred when
  //    the proxy advertises it in /health; shows words as you speak.
  //  • Record-then-transcribe via MediaRecorder + POST /transcribe on stop — the
  //    fallback when streaming isn't available (older proxy). Nothing shown until stop.
  const streamingAvailRef = useRef(false);
  const pyaiStreamRef = useRef<PyaiStreamHandle | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const pttRef = useRef(false);
  // True while a capture is being set up (before `stage` flips to "recording"),
  // so a second click / Space-press during the async getUserMedia + WS handshake
  // can't open a SECOND, orphaned mic stream that never stops — the cause of the
  // browser "still hearing" after you stop.
  const startingRef = useRef(false);
  // Last transcript surfaced live by the stream — used as a fallback when the
  // server's final commit frame comes back empty, so we clean what was actually
  // heard instead of wiping it and falsely reporting "didn't catch any speech".
  const lastHeardRef = useRef("");
  const cleanupAvailRef = useRef<boolean | null>(null);
  // Cleanup endpoint: prefer the app's own tone-aware /api/cleanup route when it's
  // configured (its key lives in the web host env, e.g. Vercel) — it applies the
  // per-app tone directive. Otherwise fall back to the Cloud Run proxy.
  const cleanupUrlRef = useRef<string>(CLEANUP_URL);

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  // Probe which engines are wired (no upstream calls) so the UI reflects the
  // real provider/model and shows honest hints before any recording.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // One probe to the Cloud Run proxy reports BOTH engines' status.
        const h = await fetch(HEALTH_URL, { cache: "no-store" }).then((r) =>
          r.json(),
        );
        if (!alive) return;
        // STT is the proxy's transcription engine — PyAI (pyai-hear) by default,
        // the SAME engine the desktop app uses; Whisper engines stand behind it as
        // automatic fallback. Reported live by /health so the badge stays honest.
        const tx = h?.transcription;
        // Prefer the live PyAI streaming relay when the proxy advertises it.
        streamingAvailRef.current = Boolean(tx?.streaming?.available);
        setStt({
          available: tx?.configured !== false,
          provider: `${tx?.provider ?? "pyai"} · cloud run`,
          model: tx?.model ?? "pyai-hear",
          apiKeyEnv: null,
        });
        const cu = h?.cleanup;
        setCleanup({
          available: !!cu?.configured,
          provider: `${cu?.provider ?? "openai"} · cloud run`,
          model: cu?.model ?? null,
          apiKeyEnv: null,
        });
        cleanupAvailRef.current = !!cu?.configured;

        // Also check the app's OWN cleanup route. If it's configured (its key in
        // the web host env), prefer it — it applies the per-app tone directive, so
        // Notes/Slack/Gmail come out in distinct tones without redeploying the proxy.
        try {
          const lc = await fetch("/api/cleanup", { cache: "no-store" }).then(
            (r) => r.json(),
          );
          if (alive && lc?.available) {
            cleanupUrlRef.current = "/api/cleanup";
            cleanupAvailRef.current = true;
            setCleanup({
              available: true,
              provider: `${lc.provider ?? "openai"} · web`,
              model: lc.model ?? null,
              apiKeyEnv: lc.apiKeyEnv ?? null,
            });
          }
        } catch {
          /* local route optional; the Cloud Run proxy stays the default */
        }
      } catch {
        /* status is best-effort; the pipeline still reports per-request errors */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Release the mic on unmount if a capture is still in flight (either path).
  useEffect(
    () => () => {
      try {
        pyaiStreamRef.current?.cancel();
      } catch {
        /* already gone */
      }
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        /* already stopped */
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const busy = stage === "transcribing" || stage === "formatting";

  // Clean a raw transcript into polished text for EVERY target app, shown side by
  // side — the SAME way the desktop app does it: the cleanup ENGINE tones each
  // channel via its channel-aware system prompt (POST { text, channel }). Whatever
  // the engine returns per channel is what we show — no cosmetic client-side
  // rewriting. This keeps the demo honest and consistent with the product: if the
  // engine isn't channel-aware yet (e.g. a stale Cloud Run proxy that ignores
  // `channel`), the cards will read alike rather than being faked into looking
  // different. The channel-aware path is the app's own /api/cleanup route (and the
  // proxy once redeployed with channelStyles.js).
  const runCleanup = useCallback(async (raw: string) => {
    setStage("formatting");
    setCleanupError(null);
    try {
      const url = cleanupUrlRef.current;

      const cleanOne = async (channel: Channel): Promise<CleanOutcome> => {
        try {
          const cr = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: raw, channel }),
          });
          const cj = await cr.json();
          if (!cr.ok) {
            if (
              cj.code === "CLEANUP_NOT_CONFIGURED" ||
              cj.code === "CLEANUP_PROVIDER_UNKNOWN"
            ) {
              cleanupAvailRef.current = false;
              setCleanup((s) => (s ? { ...s, available: false } : s));
              return { status: "unavailable" };
            }
            return {
              status: "failed",
              message:
                cj.error || "Cleanup failed — the engine returned an error.",
            };
          }
          return { status: "ok", text: (cj.text || raw).trim() };
        } catch (e) {
          return {
            status: "failed",
            message: `Cleanup error: ${(e as Error).message}`,
          };
        }
      };

      const results = await Promise.all(CHANNELS.map((c) => cleanOne(c.key)));

      if (results.some((r) => r.status === "unavailable")) return; // cleanup off — leave cards empty

      // The engine actually failed (e.g. 429 rate-limit) — be honest about it.
      // Do NOT fall back to cosmetic client-side formatting of the raw text: that
      // would render fabricated card content that looks like a successful cleanup
      // while the request in fact failed. Surface a clear "couldn't format" state
      // and leave the raw transcript above as the truthful record instead.
      const failure = results.find((r) => r.status === "failed");
      if (failure && failure.status === "failed") {
        setCleaned({ notes: "", slack: "", gmail: "" });
        setCleanupError(failure.message);
        return;
      }

      // Every channel came back cleaned — show the engine's per-channel output
      // verbatim, exactly as the desktop app pastes it. No cosmetic rewriting.
      const [notes, slack, gmail] = (
        results as Extract<CleanOutcome, { status: "ok" }>[]
      ).map((r) => r.text);
      setCleaned({ notes, slack, gmail });
    } finally {
      setStage("idle");
    }
  }, []);

  // Finalize a recording: take the raw PyAI transcript, then run the SAME cleanup
  // pass the desktop uses. Nothing is shown until this point — mirroring the
  // desktop / Wispr "format on stop" behavior.
  const finalize = useCallback(
    async (raw: string) => {
      setHeard(raw);
      if (!raw) {
        setNote("Didn't catch any speech — try again.");
        setStage("idle");
        return;
      }
      if (cleanupAvailRef.current === false) {
        setStage("idle");
        return;
      }
      await runCleanup(raw);
    },
    [runCleanup],
  );

  // Transcribe the recorded utterance with the proxy's PyAI engine — the EXACT
  // transcription step the desktop app runs in cloud mode (PyAI → Whisper
  // fallback) — then hand the raw transcript to finalize() for cleanup.
  const transcribeBlob = useCallback(
    async (blob: Blob) => {
      if (!blob.size) {
        setNote("Didn't catch any audio — try again.");
        setStage("idle");
        return;
      }
      try {
        // The proxy /transcribe takes raw WAV bytes (audio/wav) and returns { text }.
        const wav = await blobToWav16k(blob);
        const res = await fetch(`${TRANSCRIBE_URL}?language=en`, {
          method: "POST",
          headers: { "Content-Type": "audio/wav" },
          body: wav,
        });
        if (!res.ok) {
          setNote(
            `Transcription engine returned ${res.status} — please try again in a moment.`,
          );
          setStage("idle");
          return;
        }
        const data = (await res.json()) as { text?: string };
        await finalize((data?.text || "").trim());
      } catch (e) {
        setNote(`Transcription error: ${(e as Error).message}`);
        setStage("idle");
      }
    },
    [finalize],
  );

  const startRecording = useCallback(async () => {
    const s = stageRef.current;
    // Never stack a second capture on top of a live/finishing one — that would
    // orphan the first mic stream so the browser "keeps hearing" after you stop.
    if (s === "recording" || s === "transcribing" || s === "formatting") return;
    if (startingRef.current) return;
    startingRef.current = true;
    setNote(null);
    setCleanupError(null);
    setHeard("");
    lastHeardRef.current = "";
    setCleaned({ notes: "", slack: "", gmail: "" });
    try {
      // SAME engine as the desktop (PyAI). Prefer the live streaming relay when the
      // proxy offers it — words appear as you speak; otherwise record and transcribe
      // the whole utterance on stop. Either way nothing is injected until you stop.
      if (streamingAvailRef.current) {
        pyaiStreamRef.current = await startPyaiStream({
          proxyUrl: PROXY_ORIGIN,
          onPartial: (t) => {
            lastHeardRef.current = t;
            setHeard(t);
          },
          onFinal: (t) => {
            lastHeardRef.current = t;
            setHeard(t);
          },
          onError: (msg) => setNote(`Streaming error: ${msg}`),
        });
        setStage("recording");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorderRef.current = rec;
      rec.start();
      setStage("recording");
    } catch (e) {
      setNote(
        (e as Error).name === "NotAllowedError"
          ? "Microphone access was blocked — allow it in the browser to dictate. (The in-app browser blocks the mic; open the page in a real browser tab.)"
          : `Couldn't start recording: ${(e as Error).message}`,
      );
      setStage("idle");
    } finally {
      startingRef.current = false;
    }
  }, []);

  const stop = useCallback(() => {
    // Live streaming path: commit and finalize the streamed transcript.
    const streamHandle = pyaiStreamRef.current;
    if (streamHandle) {
      pyaiStreamRef.current = null;
      setStage("transcribing");
      void streamHandle
        .stop()
        // Fall back to the last streamed transcript if the final commit frame
        // comes back empty — otherwise a transcript already shown to the user
        // gets discarded and wrongly reported as "didn't catch any speech".
        .then((raw) => finalize((raw || lastHeardRef.current).trim()))
        .catch((e) => {
          setNote(`Streaming error: ${(e as Error).message}`);
          setStage("idle");
        });
      return;
    }
    // Batch path: stop the recorder, then transcribe the recording with PyAI.
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state === "inactive") return;
    mediaRecorderRef.current = null;
    setStage("transcribing");
    rec.onstop = () => {
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
      const blob = new Blob(chunksRef.current, {
        type: rec.mimeType || "audio/webm",
      });
      chunksRef.current = [];
      void transcribeBlob(blob);
    };
    rec.stop();
  }, [finalize, transcribeBlob]);

  const toggle = useCallback(() => {
    const s = stageRef.current;
    if (s === "recording") stop();
    else if (s === "idle" || s === "hover") void startRecording();
  }, [startRecording, stop]);

  // Global hotkeys (this tab focused): hold Space = push-to-talk; tap ` = toggle.
  useEffect(() => {
    const plain = (e: KeyboardEvent) =>
      !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) return;
      if (e.code === "Backquote" && plain(e)) {
        e.preventDefault();
        toggle();
      } else if (e.code === "Space" && plain(e)) {
        e.preventDefault();
        pttRef.current = true;
        void startRecording();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && pttRef.current) {
        pttRef.current = false;
        stop();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [toggle, startRecording, stop]);

  const pill = (px: number, orbClass: string) => (
    <button
      type="button"
      onMouseEnter={() => setStage((s) => (s === "idle" ? "hover" : s))}
      onMouseLeave={() => setStage((s) => (s === "hover" ? "idle" : s))}
      onClick={toggle}
      aria-label={STATUS[stage]}
      style={{ width: px, height: px }}
      className={`relative grid cursor-pointer place-items-center rounded-full border-2 border-white/70 bg-neutral-900/90 outline-none transition-transform active:scale-95 ${orbClass}`}
    >
      <ThinkingOrb state={ORB[stage]} size={64} theme="dark" />
      {stage === "recording" && (
        <span className="pointer-events-none absolute inset-0 animate-pulse rounded-full border-2 border-sky-400/60" />
      )}
    </button>
  );

  const dot =
    stage === "recording"
      ? "bg-sky-400"
      : busy
        ? "bg-violet-400"
        : "bg-white/40";

  const cleanupOn = cleanup?.available !== false; // treat unknown (null) as on
  const sttModel = stt?.model || "pyai-hear";
  /* Nothing captured yet — the panels are showing SAMPLE, not the visitor's audio. */
  const showingSample = !heard && !Object.values(cleaned).some(Boolean);

  const cleanupBadge = cleanup
    ? cleanup.available
      ? cleanup.model || cleanup.provider
      : "off"
    : "PyAI";

  return (
    <div className="min-h-screen bg-paper text-ink">
      {/* Shared site nav, same as the rest of the site. */}
      <Header />
      {/* Live pill pinned top-right, like Siri on macOS — dropped below the nav
          (top-20) so the floating pill and the header never collide. */}
      <div className="fixed right-4 top-20 z-40">
        {pill(48, "[&_canvas]:!size-10")}
      </div>

      <div className="mx-auto max-w-3xl px-6 py-14">
        <Badge variant="brand" className="mb-4">
          <Sparkles className="h-3.5 w-3.5" />
          Live demo
        </Badge>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Dictate with Pyper
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
          Hold <span className="text-ink">Space</span> and speak. Pyper captures
          your audio, then runs the real pipeline on its cloud engine —{" "}
          <b className="text-ink">transcribe</b> with PyAI, then{" "}
          <b className="text-ink">clean it up</b> into polished text. No browser
          speech API, no local server.
        </p>

        {/* Pipeline stage indicator. */}
        <div className="mt-8 flex items-center gap-2">
          {PIPELINE.map((step, i) => {
            const active = stage === step.key;
            const done =
              (step.key === "recording" &&
                (stage === "transcribing" || stage === "formatting")) ||
              (step.key === "transcribing" && stage === "formatting");
            const offStep = step.key === "formatting" && !cleanupOn;
            return (
              <div key={step.key} className="flex items-center gap-2">
                <Badge
                  variant={active ? "active" : done ? "brand" : "muted"}
                  className={offStep ? "opacity-60" : ""}
                >
                  <step.icon className="h-3.5 w-3.5" />
                  {step.label}
                  {offStep && <span className="text-muted">· off</span>}
                </Badge>
                {i < PIPELINE.length - 1 && (
                  <span className="h-px w-5 bg-line" />
                )}
              </div>
            );
          })}
        </div>

        {/* Stage + pill. */}
        <Card className="mt-6">
          <CardContent className="flex flex-col items-center gap-6 p-12">
            {pill(112, "[&_canvas]:!size-20")}
            <div className="flex items-center gap-2.5 rounded-full border border-line bg-white/5 px-4 py-2">
              <span
                className={`h-2 w-2 rounded-full ${dot} ${stage === "recording" || busy ? "animate-pulse" : ""}`}
              />
              <span className="text-sm font-medium capitalize text-ink">
                {stage}
              </span>
              <span className="text-sm text-muted">— {STATUS[stage]}</span>
            </div>
          </CardContent>
        </Card>

        {/* Raw transcript, then one cleaned version per target app — all at once. */}
        <div className="mt-6 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Heard (raw)</CardTitle>
              {showingSample ? <Badge variant="muted">sample</Badge> : null}
              <Badge variant="muted">{sttModel}</Badge>
            </CardHeader>
            <CardContent>
              <p className="max-h-[220px] min-h-[64px] overflow-y-auto whitespace-pre-wrap pr-1 text-[15px] leading-relaxed text-muted">
                {heard || <span className="text-muted/45">{SAMPLE.raw}</span>}
              </p>
            </CardContent>
          </Card>

          {cleanupOn && cleanupError ? (
            // Honest failure state: the cleanup engine errored on this attempt, so
            // there is no formatted output to show. Say so plainly and point back to
            // the unchanged raw transcript — never fabricate card content.
            <Card>
              <CardHeader>
                <CardTitle>Cleaned</CardTitle>
                <Badge variant="muted">couldn&apos;t format</Badge>
              </CardHeader>
              <CardContent>
                <div className="min-h-[72px] rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-[13px] leading-relaxed text-amber-300/90">
                  <b className="text-amber-200">{cleanupError}</b> The cleanup
                  engine didn&apos;t return formatted text this time, so
                  there&apos;s nothing to show here — the{" "}
                  <span className="text-amber-200">Heard (raw)</span> transcript
                  above is exactly what was captured, with no formatting
                  applied. Try again in a moment.
                </div>
              </CardContent>
            </Card>
          ) : cleanupOn ? (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-ink">
                    Cleaned for each app
                  </h2>
                  {showingSample ? <Badge variant="muted">sample</Badge> : null}
                  <Badge variant="brand">{cleanupBadge}</Badge>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!heard && !Object.values(cleaned).some(Boolean)}
                  onClick={() => {
                    setHeard("");
                    setCleaned({ notes: "", slack: "", gmail: "" });
                    setNote(null);
                    setCleanupError(null);
                  }}
                >
                  Clear
                </Button>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                {CHANNELS.map((c) => (
                  <Card key={c.key} className="border-brand/30">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-brand">
                        <c.icon className="h-4 w-4" />
                        {c.label}
                      </CardTitle>
                      <Badge variant="muted">{c.hint}</Badge>
                    </CardHeader>
                    <CardContent>
                      <p className="max-h-[320px] min-h-[104px] overflow-y-auto whitespace-pre-wrap pr-1 text-[15px] leading-relaxed text-ink/90">
                        {cleaned[c.key] || (
                          <span className="text-muted/45">
                            {stage === "formatting"
                              ? "Cleaning up…"
                              : SAMPLE[c.key as keyof typeof SAMPLE]}
                          </span>
                        )}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Cleaned</CardTitle>
                <Badge variant="muted">{cleanupBadge}</Badge>
              </CardHeader>
              <CardContent>
                <div className="min-h-[72px] rounded-xl border border-dashed border-line bg-white/[0.02] px-4 py-3 text-[13px] leading-relaxed text-muted">
                  <b className="text-ink/80">Transcription only.</b> The cleanup
                  engine isn&apos;t configured — PyAI is voice-only. Set{" "}
                  <code className="text-ink/80">CLEANUP_PROVIDER</code> + its
                  key (e.g. <code className="text-ink/80">OPENAI_API_KEY</code>)
                  to turn the raw transcript into polished text.
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* STT engine unreachable (proxy down / cold) — recording can't run. */}
        {stt && !stt.available && (
          <p className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-300/90">
            Transcription engine{" "}
            <span className="font-medium">{stt.provider}</span> is unavailable
            right now — please try again in a moment.
          </p>
        )}

        {note && (
          <p className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-300/90">
            {note}
          </p>
        )}

        {/* Shortcuts. */}
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
          <span className="inline-flex items-center gap-2 text-sm text-muted">
            <kbd className="rounded-md border border-line bg-white/5 px-2 py-1 font-mono text-xs text-ink/80">
              Hold Space
            </kbd>
            Push-to-talk
          </span>
          <span className="inline-flex items-center gap-2 text-sm text-muted">
            <kbd className="rounded-md border border-line bg-white/5 px-2 py-1 font-mono text-xs text-ink/80">
              `
            </kbd>
            <Command className="h-3.5 w-3.5" /> Toggle
          </span>
          <span className="inline-flex items-center gap-2 text-sm text-muted">
            <MousePointerClick className="h-3.5 w-3.5" /> Click the pill to
            toggle
          </span>
        </div>

        {/* Reference dataset — the channel-aware cleanup cases the cloud pipeline
            is eval'd against, so you can see what Pyper does per app without
            dictating. Mirrors services/pyai-proxy/eval/dataset.json (./examples.ts). */}
        <div className="mt-14 border-t border-line pt-10">
          <Badge variant="brand" className="mb-4">
            <Database className="h-3.5 w-3.5" />
            Reference dataset
          </Badge>
          <h2 className="text-2xl font-extrabold tracking-tight">
            Reads the room, per app
          </h2>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
            The same raw words land differently depending on where they&apos;re
            going. These are the cases Pyper&apos;s cloud pipeline is tested
            against — the exact set behind{" "}
            <code className="text-ink/80">/cleanup</code> — each a real speech
            transcript and the polished output for its target app.
          </p>

          {/* Channel filter chips. */}
          <div className="mt-6 flex flex-wrap gap-2">
            {EXAMPLE_FILTERS.map((key) => {
              const active = exampleFilter === key;
              const meta = key === "all" ? null : EXAMPLE_CHANNEL_META[key];
              const Icon = meta?.icon;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setExampleFilter(key)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                    active
                      ? "border-brand/40 bg-brand/10 text-brand"
                      : "border-line bg-white/[0.02] text-muted hover:text-ink"
                  }`}
                >
                  {Icon && <Icon className="h-3.5 w-3.5" />}
                  {key === "all" ? "All" : meta?.label}
                </button>
              );
            })}
          </div>

          {/* Example cards: raw transcript → polished-for-app output. */}
          <div className="mt-6 space-y-4">
            {DATASET_EXAMPLES.filter(
              (ex) => exampleFilter === "all" || ex.channel === exampleFilter,
            ).map((ex) => {
              const meta = EXAMPLE_CHANNEL_META[ex.channel];
              const Icon = meta.icon;
              return (
                <Card key={ex.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-brand">
                      <Icon className="h-4 w-4" />
                      {meta.label}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="muted">{ex.app}</Badge>
                      <Badge variant="muted">{meta.hint}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="mb-3 text-xs text-muted/70">{ex.useCase}</p>
                    <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
                      <div className="rounded-xl border border-dashed border-line bg-white/[0.02] px-4 py-3">
                        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                          Heard (raw)
                        </span>
                        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-muted">
                          {ex.raw}
                        </p>
                      </div>
                      <div className="flex items-center justify-center text-muted/50">
                        <ArrowRight className="hidden h-5 w-5 md:block" />
                        <span className="text-xs md:hidden">
                          ↓ polished for {meta.label}
                        </span>
                      </div>
                      <div className="rounded-xl border border-brand/25 bg-brand/[0.04] px-4 py-3">
                        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-brand/70">
                          Polished · {meta.label}
                        </span>
                        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink/90">
                          {ex.expected}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        <p className="mt-8 text-xs text-muted/70">
          Speech-to-text{cleanupOn ? " & cleanup" : ""} by{" "}
          <span className="text-muted">Pyper&apos;s cloud engines</span> — the
          same pipeline behind the desktop app (no browser speech API). Needs a
          microphone; the keys stay server-side in a Cloud Run proxy. Engines
          are swappable via <code className="text-muted">STT_PROVIDER</code> /{" "}
          <code className="text-muted">CLEANUP_PROVIDER</code>.
        </p>
      </div>
    </div>
  );
}
