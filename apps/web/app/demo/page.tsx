"use client";

// Live demo of Pyper's dictation pipeline — the EXACT same pipeline the desktop
// app (the main product) uses: stream mic audio to OpenAI Realtime as you speak
// (an ephemeral token is minted by the GCP proxy, so no key ever reaches the
// browser), then clean the final transcript with Groq/Llama via the same proxy
// /cleanup. Like the desktop, nothing is shown until you stop — the formatting
// pass needs the whole utterance. See apps/web/lib/realtimeDictation.ts (the
// browser client) and services/pyai-proxy/server.js (/realtime-token, /cleanup).
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Command,
  Mail,
  MessageSquare,
  Mic,
  MousePointerClick,
  NotebookPen,
  Sparkles,
  Wand2,
} from "lucide-react";
import { ThinkingOrb } from "@/components/ui/thinking-orbs";
import type { OrbState } from "@/components/ui/thinking-orbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/ui/header";
import {
  startRealtimeDictation,
  type RealtimeDictationHandle,
} from "@/lib/realtimeDictation";

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
// Base origin of the proxy — the streaming client mints its ephemeral OpenAI
// Realtime token at `${PROXY_BASE}/realtime-token`, the same proxy /cleanup uses.
const PROXY_BASE = TRANSCRIBE_URL.replace(/\/transcribe\/?$/, "");

type Stage = "idle" | "hover" | "recording" | "transcribing" | "formatting";

// Target app for the cleaned output — tunes the cleanup tone (the proxy /cleanup
// applies a matching style directive). "notes" is the neutral default.
type Channel = "notes" | "slack" | "gmail";

const CHANNELS: { key: Channel; label: string; icon: typeof Mic; hint: string }[] = [
  { key: "notes", label: "Notes", icon: NotebookPen, hint: "short & precise" },
  { key: "slack", label: "Slack", icon: MessageSquare, hint: "slightly informal" },
  { key: "gmail", label: "Gmail", icon: Mail, hint: "formal & respectful" },
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
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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

// Deterministic per-app formatting, applied client-side to the SAME cleaned text
// when the cleanup engine can't tone it itself (the Cloud Run proxy ignores the
// channel). Gives three visibly distinct renderings — casual / formal / concise —
// with no extra LLM call. When a tone-aware cleanup engine is configured (Groq via
// /api/cleanup), the LLM does the toning instead and this is bypassed.
const CONTRACTIONS: [RegExp, string][] = [
  [/\bI'm\b/g, "I am"],
  [/\blet's\b/gi, "let us"],
  [/\bcan't\b/gi, "cannot"],
  [/\bwon't\b/gi, "will not"],
  [/\bdon't\b/gi, "do not"],
  [/\bdoesn't\b/gi, "does not"],
  [/\bdidn't\b/gi, "did not"],
  [/\bisn't\b/gi, "is not"],
  [/\baren't\b/gi, "are not"],
  [/\bwasn't\b/gi, "was not"],
  [/\bit's\b/gi, "it is"],
  [/\bthat's\b/gi, "that is"],
  [/\b(\w+)'re\b/gi, "$1 are"],
  [/\b(\w+)'ll\b/gi, "$1 will"],
  [/\b(\w+)'ve\b/gi, "$1 have"],
  [/\bgonna\b/gi, "going to"],
  [/\bwanna\b/gi, "want to"],
];

// Casual → formal swaps for the Gmail rendering: contractions plus a few
// conversational phrasings nudged toward professional ones.
const FORMALIZE: [RegExp, string][] = [
  ...CONTRACTIONS,
  [/\bgetting pushed\b/gi, "being moved"],
  [/\bpushed back\b/gi, "postponed"],
  [/\bpushed to\b/gi, "moved to"],
  [/\bnothing too serious\b/gi, "nothing critical"],
  [/\bwe want to be safe\b/gi, "we would like to be cautious"],
  [/\bwant to be safe\b/gi, "prefer to be cautious"],
  [/\bwe want to\b/gi, "we would like to"],
  [/\bI want to\b/gi, "I would like to"],
  [/\bfigure out\b/gi, "determine"],
  [/\bheads up\b/gi, "please note"],
  [/\bASAP\b/g, "as soon as possible"],
  [/\bthanks\b/gi, "thank you"],
];

// Filler dropped for the concise Notes rendering.
const FILLER = /\b(um|uh|er|like|just|really|actually|basically|honestly|kind of|sort of|you know)\b/gi;

function capitalizeSentences(s: string): string {
  return s.replace(/(^\s*|[.!?]\s+)([a-z])/g, (_m, p: string, ch: string) => p + ch.toUpperCase());
}

function formatForChannel(text: string, channel: Channel): string {
  const body = text.trim();
  if (!body) return "";
  if (channel === "slack") {
    // Casual: relaxed and conversational — the cleaned text as dictated.
    return body;
  }
  if (channel === "gmail") {
    // Formal: professionalise the wording and frame it as a courteous email.
    const formal = capitalizeSentences(FORMALIZE.reduce((s, [re, rep]) => s.replace(re, rep), body));
    return `Hi,\n\n${formal}\n\nBest regards`;
  }
  // Notes — concise: drop filler + a leading greeting, split into short bullets.
  const trimmed = body
    .replace(/^(hi|hey|hello|thanks|thank you)[,!.\s]+/i, "")
    .replace(FILLER, "")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/\s{2,}/g, " ");
  const clauses = trimmed
    .replace(/\s*\n+\s*/g, " ")
    .split(/(?<=[.!?])\s+|\s*;\s*|\s*,\s+(?:but|and|so|because|which|while)\s+/i)
    .map((s) => s.replace(/^(but|and|so|because|which|while)\s+/i, "").replace(/[.!?,;]+\s*$/, "").trim())
    .filter(Boolean);
  return (clauses.length ? clauses : [trimmed]).map((s) => `• ${s}`).join("\n");
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
  const [stt, setStt] = useState<EngineStatus | null>(null);
  const [cleanup, setCleanup] = useState<EngineStatus | null>(null);

  const stageRef = useRef<Stage>("idle");
  const rtRef = useRef<RealtimeDictationHandle | null>(null);
  const pttRef = useRef(false);
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
        const h = await fetch(HEALTH_URL, { cache: "no-store" }).then((r) => r.json());
        if (!alive) return;
        // STT streams to OpenAI Realtime directly (token minted by the proxy) —
        // the same engine the desktop uses; not the proxy's batch /transcribe.
        setStt({
          available: true,
          provider: "openai realtime · streaming",
          model: "gpt-4o-mini-transcribe",
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
          const lc = await fetch("/api/cleanup", { cache: "no-store" }).then((r) => r.json());
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

  // Cancel any in-flight streaming session on unmount.
  useEffect(() => () => rtRef.current?.cancel(), []);

  const busy = stage === "transcribing" || stage === "formatting";

  // Clean a raw transcript into polished text for EVERY target app, shown side by
  // side. Ask the engine to tone each channel; if it actually does (Groq via
  // /api/cleanup, or a proxy redeployed with channel support), use that real
  // per-app output. If it returns the same text for every channel (the current
  // proxy ignores `channel`), differentiate deterministically client-side so the
  // three still read casual / formal / concise. Self-adjusts with no code change
  // the moment the engine gains real toning.
  const runCleanup = useCallback(async (raw: string) => {
    setStage("formatting");
    try {
      const url = cleanupUrlRef.current;

      const cleanOne = async (channel: Channel): Promise<string | null> => {
        const cr = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: raw, channel }),
        });
        const cj = await cr.json();
        if (!cr.ok) {
          if (cj.code === "CLEANUP_NOT_CONFIGURED" || cj.code === "CLEANUP_PROVIDER_UNKNOWN") {
            cleanupAvailRef.current = false;
            setCleanup((s) => (s ? { ...s, available: false } : s));
            return null; // cleanup unavailable
          }
          setNote(cj.error || "Cleanup failed — showing the raw transcript.");
          return raw; // transient failure — fall back to raw
        }
        return (cj.text || raw).trim();
      };

      const results = await Promise.all(
        CHANNELS.map((c) =>
          cleanOne(c.key).catch((e) => {
            setNote(`Cleanup error: ${(e as Error).message}`);
            return raw as string;
          }),
        ),
      );
      if (results.some((r) => r === null)) return; // cleanup off — leave cards empty

      const [notes, slack, gmail] = results as string[];
      const engineToned = !(notes === slack && slack === gmail);
      setCleaned(
        engineToned
          ? { notes, slack, gmail }
          : {
              // Engine ignored the channel — differentiate the shared cleaned text.
              notes: formatForChannel(notes, "notes"),
              slack: formatForChannel(notes, "slack"),
              gmail: formatForChannel(notes, "gmail"),
            },
      );
    } finally {
      setStage("idle");
    }
  }, []);

  // Finalize a streaming session: take the transcript that streamed in while the
  // user spoke, then run the SAME cleanup pass the desktop uses. Nothing is shown
  // until this point — mirroring the desktop / Wispr "format on stop" behavior.
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

  const startRecording = useCallback(async () => {
    if (stageRef.current === "transcribing" || stageRef.current === "formatting") return;
    setNote(null);
    setHeard("");
    setCleaned({ notes: "", slack: "", gmail: "" });
    try {
      // SAME pipeline as the desktop: stream mic audio to OpenAI Realtime with an
      // ephemeral token minted by the proxy. Recognition runs while you speak; the
      // transcript is held (not injected) until stop.
      const handle = await startRealtimeDictation({
        proxyUrl: PROXY_BASE,
        onPartial: (t) => setHeard(t),
        onFinal: (t) => setHeard(t),
        onError: (msg) => setNote(`Streaming error: ${msg}`),
      });
      rtRef.current = handle;
      setStage("recording");
    } catch (e) {
      setNote(
        (e as Error).name === "NotAllowedError"
          ? "Microphone access was blocked — allow it in the browser to dictate. (The in-app browser blocks the mic; open the page in a real browser tab.)"
          : `Couldn't start streaming: ${(e as Error).message}`,
      );
      setStage("idle");
    }
  }, []);

  const stop = useCallback(() => {
    const handle = rtRef.current;
    if (!handle) return;
    rtRef.current = null;
    setStage("transcribing"); // brief: flush the last partial into a final transcript
    void handle
      .stop()
      .then((raw) => finalize(raw.trim()))
      .catch((e) => {
        setNote(`Streaming error: ${(e as Error).message}`);
        setStage("idle");
      });
  }, [finalize]);

  const toggle = useCallback(() => {
    const s = stageRef.current;
    if (s === "recording") stop();
    else if (s === "idle" || s === "hover") void startRecording();
  }, [startRecording, stop]);

  // Global hotkeys (this tab focused): hold Space = push-to-talk; tap ` = toggle.
  useEffect(() => {
    const plain = (e: KeyboardEvent) => !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
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
    stage === "recording" ? "bg-sky-400" : busy ? "bg-violet-400" : "bg-white/40";

  const cleanupOn = cleanup?.available !== false; // treat unknown (null) as on
  const sttModel = stt?.model || "gpt-4o-mini-transcribe";
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
      <div className="fixed right-4 top-20 z-40">{pill(48, "[&_canvas]:!size-10")}</div>

      <div className="mx-auto max-w-3xl px-6 py-14">
        <Badge variant="brand" className="mb-4">
          <Sparkles className="h-3.5 w-3.5" />
          Live demo
        </Badge>
        <h1 className="text-3xl font-extrabold tracking-tight">Dictate with Pyper</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
          Hold <span className="text-ink">Space</span> and speak. Pyper captures your audio, then
          runs the real pipeline on its cloud engine — <b className="text-ink">transcribe</b> with
          PyAI, then <b className="text-ink">clean it up</b> into polished text. No browser speech
          API, no local server.
        </p>

        {/* Pipeline stage indicator. */}
        <div className="mt-8 flex items-center gap-2">
          {PIPELINE.map((step, i) => {
            const active = stage === step.key;
            const done =
              (step.key === "recording" && (stage === "transcribing" || stage === "formatting")) ||
              (step.key === "transcribing" && stage === "formatting");
            const offStep = step.key === "formatting" && !cleanupOn;
            return (
              <div key={step.key} className="flex items-center gap-2">
                <Badge variant={active ? "active" : done ? "brand" : "muted"} className={offStep ? "opacity-60" : ""}>
                  <step.icon className="h-3.5 w-3.5" />
                  {step.label}
                  {offStep && <span className="text-muted">· off</span>}
                </Badge>
                {i < PIPELINE.length - 1 && <span className="h-px w-5 bg-line" />}
              </div>
            );
          })}
        </div>

        {/* Stage + pill. */}
        <Card className="mt-6">
          <CardContent className="flex flex-col items-center gap-6 p-12">
            {pill(112, "[&_canvas]:!size-20")}
            <div className="flex items-center gap-2.5 rounded-full border border-line bg-white/5 px-4 py-2">
              <span className={`h-2 w-2 rounded-full ${dot} ${stage === "recording" || busy ? "animate-pulse" : ""}`} />
              <span className="text-sm font-medium capitalize text-ink">{stage}</span>
              <span className="text-sm text-muted">— {STATUS[stage]}</span>
            </div>
          </CardContent>
        </Card>

        {/* Raw transcript, then one cleaned version per target app — all at once. */}
        <div className="mt-6 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Heard (raw)</CardTitle>
              <Badge variant="muted">{sttModel}</Badge>
            </CardHeader>
            <CardContent>
              <p className="min-h-[72px] max-h-[220px] overflow-y-auto whitespace-pre-wrap pr-1 text-[15px] leading-relaxed text-muted">
                {heard || <span className="text-muted/50">The raw transcript appears here…</span>}
              </p>
            </CardContent>
          </Card>

          {cleanupOn ? (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-ink">Cleaned for each app</h2>
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
                      <p className="min-h-[180px] max-h-[320px] overflow-y-auto whitespace-pre-wrap pr-1 text-[15px] leading-relaxed text-ink/90">
                        {cleaned[c.key] || (
                          <span className="text-muted/50">
                            {stage === "formatting"
                              ? "Cleaning up…"
                              : `Polished for ${c.label} lands here…`}
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
                  <b className="text-ink/80">Transcription only.</b> The cleanup engine isn&apos;t
                  configured — PyAI is voice-only. Set{" "}
                  <code className="text-ink/80">CLEANUP_PROVIDER</code> + its key (e.g.{" "}
                  <code className="text-ink/80">OPENAI_API_KEY</code>) to turn the raw transcript into
                  polished text.
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* STT engine unreachable (proxy down / cold) — recording can't run. */}
        {stt && !stt.available && (
          <p className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-300/90">
            Transcription engine <span className="font-medium">{stt.provider}</span> is unavailable
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
            <MousePointerClick className="h-3.5 w-3.5" /> Click the pill to toggle
          </span>
        </div>

        <p className="mt-8 text-xs text-muted/70">
          Speech-to-text{cleanupOn ? " & cleanup" : ""} by{" "}
          <span className="text-muted">Pyper&apos;s cloud engines</span> — the same pipeline behind
          the desktop app (no browser speech API). Needs a microphone; the keys stay server-side in a
          Cloud Run proxy. Engines are swappable via <code className="text-muted">STT_PROVIDER</code>{" "}
          / <code className="text-muted">CLEANUP_PROVIDER</code>.
        </p>
      </div>
    </div>
  );
}
