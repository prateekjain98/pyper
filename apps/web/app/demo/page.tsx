"use client";

// Live demo of Pyper's dictation pipeline, powered by the SAME cloud engine the
// desktop app uses (PyAI on GCP) — never the browser's speech API. Audio is
// captured, then transcribed (pyai-hear) and, when a cleanup engine is
// configured, cleaned up into polished text via server-side proxy routes
// (/api/transcribe, /api/cleanup). Text only appears after processing.
//
// The engine is an env-driven adapter (see apps/web/lib/engines.ts): STT_PROVIDER
// and CLEANUP_PROVIDER select OpenAI-compatible engines. PyAI is voice-only, so
// with the default CLEANUP_PROVIDER=pyai the demo transcribes and honestly
// reports cleanup as not configured (rather than faking it) — point
// CLEANUP_PROVIDER at a chat engine (e.g. openai) to enable the cleanup stage.
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Command, Mic, MousePointerClick, Sparkles, Wand2 } from "lucide-react";
import { ThinkingOrb } from "@/components/ui/thinking-orbs";
import type { OrbState } from "@/components/ui/thinking-orbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/ui/header";

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

type Stage = "idle" | "hover" | "recording" | "transcribing" | "formatting";

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
  transcribing: "Transcribing with PyAI…",
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

export default function Demo() {
  const [stage, setStage] = useState<Stage>("idle");
  const [heard, setHeard] = useState(""); // raw engine transcript
  const [cleaned, setCleaned] = useState(""); // polished output
  const [note, setNote] = useState<string | null>(null);
  const [stt, setStt] = useState<EngineStatus | null>(null);
  const [cleanup, setCleanup] = useState<EngineStatus | null>(null);

  const stageRef = useRef<Stage>("idle");
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const pttRef = useRef(false);
  const cleanupAvailRef = useRef<boolean | null>(null);

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
        setStt({
          available: !!h?.configured,
          provider: `${h?.provider ?? "pyai"} · cloud run`,
          model: h?.model ?? "pyai-hear",
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
      } catch {
        /* status is best-effort; the pipeline still reports per-request errors */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };
  useEffect(() => () => stopStream(), []);

  const busy = stage === "transcribing" || stage === "formatting";

  const runPipeline = useCallback(async (blob: Blob) => {
    setStage("transcribing");
    try {
      const wav = await blobToWav16k(blob);
      // Browser → Cloud Run proxy (holds the PyAI key via GCP Secret Manager) →
      // PyAI. No secret on the web host.
      const tr = await fetch(TRANSCRIBE_URL, {
        method: "POST",
        headers: { "content-type": "audio/wav" },
        body: wav,
      });
      const tj = await tr.json();
      if (!tr.ok) {
        setNote(tj.error || "Transcription failed.");
        setStage("idle");
        return;
      }
      const raw = (tj.text || "").trim();
      setHeard(raw);
      if (!raw) {
        setNote("Didn't catch any speech — try again.");
        setStage("idle");
        return;
      }

      // Transcription-only mode: cleanup engine not configured (PyAI is
      // voice-only). Show the raw transcript honestly, never fake a "cleaned"
      // version.
      if (cleanupAvailRef.current === false) {
        setStage("idle");
        return;
      }

      setStage("formatting");
      const cr = await fetch(CLEANUP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: raw }),
      });
      const cj = await cr.json();
      if (!cr.ok) {
        // Config problem (voice-only / missing key): switch to transcription-only
        // and don't present the raw text as if it were cleaned.
        if (cj.code === "CLEANUP_NOT_CONFIGURED" || cj.code === "CLEANUP_PROVIDER_UNKNOWN") {
          cleanupAvailRef.current = false;
          setCleanup((c) => (c ? { ...c, available: false } : c));
        } else {
          // Transient upstream failure — keep the raw text as a labelled fallback.
          setNote(cj.error || "Cleanup failed — showing the raw transcript.");
          setCleaned(raw);
        }
      } else {
        setCleaned((cj.text || raw).trim());
      }
      setStage("idle");
    } catch (e) {
      setNote(`Pipeline error: ${(e as Error).message}`);
      setStage("idle");
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (stageRef.current === "transcribing" || stageRef.current === "formatting") return;
    setNote(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        stopStream();
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (blob.size > 0) void runPipeline(blob);
        else setStage("idle");
      };
      mediaRef.current = mr;
      mr.start();
      setStage("recording");
    } catch (e) {
      setNote(
        (e as Error).name === "NotAllowedError"
          ? "Microphone access was blocked — allow it in the browser to dictate. (The in-app browser blocks the mic; open the page in a real browser tab.)"
          : `Microphone error: ${(e as Error).message}`,
      );
      setStage("idle");
    }
  }, [runPipeline]);

  const stop = useCallback(() => {
    const mr = mediaRef.current;
    if (mr && mr.state !== "inactive") mr.stop();
  }, []);

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
  const sttModel = stt?.model || "pyai-hear";
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

        {/* Outputs: raw (engine) → cleaned (formatted). */}
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Heard (raw)</CardTitle>
              <Badge variant="muted">{sttModel}</Badge>
            </CardHeader>
            <CardContent>
              <p className="min-h-[72px] whitespace-pre-wrap text-[15px] leading-relaxed text-muted">
                {heard || <span className="text-muted/50">The raw transcript appears here…</span>}
              </p>
            </CardContent>
          </Card>

          <Card className={cleanupOn ? "border-brand/30" : ""}>
            <CardHeader>
              <CardTitle className={cleanupOn ? "text-ink" : ""}>Cleaned</CardTitle>
              <Badge variant={cleanupOn ? "brand" : "muted"}>{cleanupBadge}</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {cleanupOn ? (
                <>
                  <Textarea
                    value={cleaned}
                    onChange={(e) => setCleaned(e.target.value)}
                    placeholder="Polished text lands here…"
                    rows={3}
                    spellCheck={false}
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!heard && !cleaned}
                      onClick={() => {
                        setHeard("");
                        setCleaned("");
                        setNote(null);
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                </>
              ) : (
                <div className="min-h-[72px] rounded-xl border border-dashed border-line bg-white/[0.02] px-4 py-3 text-[13px] leading-relaxed text-muted">
                  <b className="text-ink/80">Transcription only.</b> The cleanup engine isn&apos;t
                  configured — PyAI is voice-only. Set{" "}
                  <code className="text-ink/80">CLEANUP_PROVIDER</code> + its key (e.g.{" "}
                  <code className="text-ink/80">OPENAI_API_KEY</code>) to turn the raw transcript into
                  polished text.
                </div>
              )}
            </CardContent>
          </Card>
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
