import { ParallaxComponent } from "@/components/ui/parallax-scrolling";
import { Header } from "@/components/ui/header";
import { DownloadButtons } from "@/components/ui/download-buttons";
import { DownloadCTA } from "@/components/ui/download-cta";
import { ThinkingOrb } from "@/components/ui/thinking-orbs";
import {
  Mic,
  Command,
  Wand2,
  Lock,
  Search,
  AudioLines,
  Bot,
  Laptop,
  ArrowRight,
  Github,
  Check,
} from "lucide-react";

// Pyper marketing landing page — light, Wispr-Flow-style, parallax kept as the
// cinematic top hero. Brand values live in one place.
const BRAND = {
  name: "Pyper",
  domain: "pyper.work",
  url: "https://pyper.work",
  docs: "https://docs.pyper.work",
  github: "https://github.com/prateekjain98/pyper",
  releases: "https://github.com/prateekjain98/pyper/releases/latest",
};

const models = ["OpenAI", "Anthropic", "Gemini", "Groq", "Whisper", "Parakeet"];

const stats = [
  { value: "3×", label: "faster than typing" },
  { value: "100%", label: "offline, on your device" },
  { value: "MIT", label: "free & open source" },
];

const steps = [
  {
    icon: Command,
    title: "Press your hotkey",
    body: "One global shortcut works in every app — your editor, inbox, terminal, chat box. No window to switch to.",
  },
  {
    icon: AudioLines,
    title: "Just speak",
    body: "Ramble, pause, or change your mind mid-sentence. Pyper transcribes on your device as you talk.",
  },
  {
    icon: Wand2,
    title: "Watch it appear",
    body: "Filler words removed, punctuation added — polished text lands right at your cursor.",
  },
];

const features = [
  {
    icon: Mic,
    title: "Dictate anywhere",
    body: "Hit a hotkey and talk into any app. Your words appear at the cursor — nothing to copy or paste.",
  },
  {
    icon: Lock,
    title: "Private by default",
    body: "Transcribe 100% offline with local Whisper & NVIDIA Parakeet. Your audio never leaves your device.",
  },
  {
    icon: Bot,
    title: "Bring your own AI",
    body: "Plug in OpenAI, Anthropic, Gemini or Groq — or run a fully local model. Your keys, your rules.",
  },
  {
    icon: AudioLines,
    title: "Meeting transcription",
    body: "Capture calls with speaker labels, no bot in the room. Turn the talk into notes automatically.",
  },
  {
    icon: Search,
    title: "Notes & search",
    body: "Everything you dictate becomes searchable — find any thought by meaning, not just keywords.",
  },
  {
    icon: Laptop,
    title: "Cross-platform & open",
    body: "Native apps for macOS, Windows and Linux. MIT-licensed source you can read and trust.",
  },
];

export default function Home() {
  return (
    <div className="landing">
      <Header />

      {/* Cinematic hero (parallax) with the primary CTA overlaid. */}
      <ParallaxComponent title={BRAND.name}>
        <p className="max-w-xl text-balance text-lg font-medium text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.6)] sm:text-xl">
          Your voice, typed perfectly — in any app, up to 3× faster than your keyboard.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <DownloadCTA className="inline-flex items-center gap-2 rounded-xl bg-brand px-6 py-3.5 text-[15px] font-semibold text-white shadow-[0_14px_34px_-10px_rgba(32,86,223,0.7)] transition hover:-translate-y-0.5 hover:bg-brand-600">
            Download for free
            <ArrowRight className="h-4 w-4" />
          </DownloadCTA>
          <a
            href={BRAND.github}
            className="inline-flex items-center gap-2 rounded-xl border border-white/35 bg-white/10 px-6 py-3.5 text-[15px] font-semibold text-white backdrop-blur-md transition hover:-translate-y-0.5 hover:bg-white/20"
          >
            <Github className="h-4 w-4" />
            Star on GitHub
          </a>
        </div>
        <p className="text-sm font-medium text-white/80 drop-shadow-[0_1px_10px_rgba(0,0,0,0.6)]">
          Free &amp; open source · macOS · Windows · Linux
        </p>
      </ParallaxComponent>

      <main>
        {/* ---------------------------------------------------------------- */}
        {/* Value-prop hero                                                  */}
        {/* ---------------------------------------------------------------- */}
        <section className="relative overflow-hidden">
          <div className="landing-grid pointer-events-none absolute inset-0 -z-10" />
          <div className="mx-auto max-w-6xl px-6 pt-20 pb-16 text-center sm:pt-24">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-brand-050 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-brand">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              Open source · Private by default
            </span>

            <h1 className="mx-auto mt-6 max-w-4xl text-[clamp(2.6rem,6.2vw,4.75rem)] font-extrabold leading-[1.02] tracking-[-0.035em] text-ink">
              Don&rsquo;t type.{" "}
              <span className="bg-gradient-to-r from-brand to-[#5b8bff] bg-clip-text text-transparent">
                Just speak.
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-[clamp(1.05rem,2.1vw,1.3rem)] leading-relaxed text-muted">
              Pyper turns speech into clean, punctuated text in any app — filler words gone,
              formatting done. It runs fully offline, so your voice never leaves your machine.
            </p>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <DownloadCTA className="inline-flex items-center gap-2 rounded-xl bg-brand px-6 py-3.5 text-[15px] font-semibold text-white shadow-[0_14px_34px_-10px_rgba(32,86,223,0.55)] transition hover:-translate-y-0.5 hover:bg-brand-600">
                Download for free
                <ArrowRight className="h-4 w-4" />
              </DownloadCTA>
              <a
                href={BRAND.github}
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-6 py-3.5 text-[15px] font-semibold text-ink transition hover:-translate-y-0.5 hover:border-ink/20"
              >
                <Github className="h-4 w-4" />
                Star on GitHub
              </a>
            </div>

            {/* Stat row — quick credibility, in the spirit of Wispr's "4× faster". */}
            <div className="mx-auto mt-10 flex max-w-xl flex-wrap items-center justify-center gap-x-10 gap-y-4">
              {stats.map((s) => (
                <div key={s.label} className="flex items-baseline gap-2">
                  <span className="text-2xl font-extrabold tracking-tight text-ink">
                    {s.value}
                  </span>
                  <span className="text-sm text-muted">{s.label}</span>
                </div>
              ))}
            </div>

            {/* Product visual — the thinking orb as mini "status pills", one per
                stage of dictation (the reference look). */}
            <div className="relative mx-auto mt-14 flex max-w-sm flex-col gap-3">
              <div className="pointer-events-none absolute -inset-12 -z-10 rounded-full bg-brand/15 blur-3xl" />
              {(
                [
                  { state: "listening", label: "Listening…", sub: "Capturing your voice" },
                  { state: "working", label: "Transcribing…", sub: "On-device, in real time" },
                  { state: "solving", label: "Polishing…", sub: "Cleaning up the words" },
                ] as const
              ).map((p) => (
                <div
                  key={p.label}
                  className="flex items-center gap-3 rounded-full bg-[#161b27] py-2 pl-2 pr-6 text-left ring-1 ring-white/10 shadow-[0_12px_30px_-14px_rgba(0,0,0,0.7)]"
                >
                  <span className="grid h-11 w-11 flex-none place-items-center [&_canvas]:!size-9">
                    <ThinkingOrb state={p.state} size={64} theme="dark" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[15px] font-medium text-white/90">{p.label}</div>
                    <div className="truncate text-xs text-white/45">{p.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Trust strip                                                      */}
        {/* ---------------------------------------------------------------- */}
        <section className="border-y border-line bg-paper-2">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-10">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              Bring your own AI — Pyper works with every major model
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
              {models.map((m) => (
                <span key={m} className="text-lg font-semibold text-ink/45">
                  {m}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* How it works                                                     */}
        {/* ---------------------------------------------------------------- */}
        <section className="mx-auto max-w-6xl px-6 py-24">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-[clamp(1.9rem,4vw,2.75rem)] font-bold tracking-[-0.02em] text-ink">
              From voice to text in one breath
            </h2>
            <p className="mt-4 text-lg text-muted">
              No window to switch to, no button to click. Speak, and keep working.
            </p>
          </div>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {steps.map((s, i) => (
              <div
                key={s.title}
                className="relative rounded-2xl border border-line bg-surface p-7 shadow-[0_1px_2px_rgba(11,18,32,0.04),0_12px_28px_-16px_rgba(11,18,32,0.14)]"
              >
                <span className="absolute right-6 top-6 text-sm font-semibold text-ink/25">
                  0{i + 1}
                </span>
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-050 text-brand">
                  <s.icon className="h-6 w-6" />
                </span>
                <h3 className="mt-5 text-lg font-semibold text-ink">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Features                                                         */}
        {/* ---------------------------------------------------------------- */}
        <section id="features" className="bg-paper-2 py-24">
          <div className="mx-auto max-w-6xl px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-[clamp(1.9rem,4vw,2.75rem)] font-bold tracking-[-0.02em] text-ink">
                Everything you need to talk instead of type
              </h2>
              <p className="mt-4 text-lg text-muted">
                One app for dictation, meetings, notes and AI — and all of it is yours.
              </p>
            </div>
            <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <div
                  key={f.title}
                  className="group rounded-2xl border border-line bg-surface p-6 shadow-[0_1px_2px_rgba(11,18,32,0.04)] transition hover:-translate-y-1 hover:shadow-[0_18px_40px_-20px_rgba(11,18,32,0.22)]"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-050 text-brand transition group-hover:bg-brand group-hover:text-white">
                    <f.icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-5 text-[17px] font-semibold text-ink">{f.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Privacy callout                                                  */}
        {/* ---------------------------------------------------------------- */}
        <section className="mx-auto max-w-6xl px-6 py-24">
          <div className="relative overflow-hidden rounded-3xl border border-line bg-surface p-10 md:p-14">
            <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-brand/10 blur-3xl" />
            <div className="grid items-center gap-10 md:grid-cols-[1.1fr_0.9fr]">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full border border-line bg-brand-050 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-brand">
                  <Lock className="h-3.5 w-3.5" />
                  Private by design
                </span>
                <h2 className="mt-5 text-[clamp(1.8rem,3.6vw,2.6rem)] font-bold tracking-[-0.02em] text-ink">
                  Your voice never has to leave your device
                </h2>
                <p className="mt-4 max-w-xl text-lg text-muted">
                  Run transcription 100% offline with local Whisper and NVIDIA Parakeet. No
                  account, no telemetry on your audio — and every line is open source, so you can
                  verify it yourself.
                </p>
              </div>
              <ul className="grid gap-3">
                {[
                  "On-device transcription — audio stays local",
                  "Bring your own key for cloud models",
                  "No bot ever joins your meetings",
                  "MIT-licensed and fully open source",
                ].map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 rounded-xl border border-line bg-paper-2 px-4 py-3 text-[15px] font-medium text-ink"
                  >
                    <Check className="mt-0.5 h-5 w-5 flex-none text-brand" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Final CTA                                                        */}
        {/* ---------------------------------------------------------------- */}
        <section id="download" className="mx-auto max-w-6xl px-6 pb-28">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-[#121a2e] to-[#0a0e18] px-6 py-16 text-center text-white ring-1 ring-white/10">
            <div className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-64 w-[36rem] max-w-full rounded-full bg-brand/40 blur-[90px]" />
            <div className="relative mx-auto flex max-w-2xl flex-col items-center">
              <span className="orb-float grid h-16 w-16 place-items-center rounded-full bg-white/5 ring-1 ring-white/15 [&_canvas]:!size-11">
                <ThinkingOrb state="working" size={64} theme="dark" />
              </span>
              <h2 className="mt-7 text-[clamp(2rem,4.4vw,3rem)] font-bold tracking-[-0.02em]">
                Stop typing. Start speaking.
              </h2>
              <p className="mt-4 max-w-lg text-lg text-white/70">
                Free, open source, and yours to keep. Download {BRAND.name} and start talking in
                seconds.
              </p>
              <div className="mt-8">
                <DownloadButtons releasesUrl={BRAND.releases} />
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-10 text-sm text-muted sm:flex-row">
          <span>
            © {new Date().getFullYear()} {BRAND.name} · Built by SaaS Labs
          </span>
          <span>{BRAND.domain} · Derived from the open-source OpenWhispr project (MIT)</span>
        </div>
      </footer>
    </div>
  );
}
