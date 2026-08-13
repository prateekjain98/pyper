import type { Metadata } from "next";
import { Header } from "@/components/ui/header";
import { FeaturesDemo } from "@/components/ui/features-demo";

const BRAND = {
  name: "Pyper",
  domain: "pyper.work",
};

export const metadata: Metadata = {
  title: "Features — Pyper",
  description:
    "Hold a key and speak. What lands on screen is what you meant — cleaned up, in the right tone, spelled correctly. Hold it twice, and Pyper stops transcribing and starts answering.",
};

// One dictation session, in the order it actually happens. `action` marks the
// step that switches from dictation to answering.
type Step = {
  time: string;
  title: string;
  body: string;
  tag: string;
  action?: boolean;
};

const STEPS: Step[] = [
  {
    time: "0:00 — press",
    title: "One key. Every app.",
    body: "Hold one hotkey anywhere — Slack, Mail, Notion, your terminal — and start talking. No app to switch to, no separate window to manage.",
    tag: "Dictation",
  },
  {
    time: "0:01 — speaking",
    title: "Words land as you speak.",
    body: "Text appears the moment you say it, not after you finish. Watch your sentence take shape in real time, right where your cursor already is.",
    tag: "Dictation",
  },
  {
    time: "0:04 — release",
    title: "Cleaned up before you see it.",
    body: "Filler words drop out. Punctuation lands where your voice implied it. What gets typed is what you meant — not a transcript of exactly what you said.",
    tag: "Dictation",
  },
  {
    time: "0:04 — same moment",
    title: "Reads the room.",
    body: "A quick note in Slack comes out casual. The same thought in an email comes out formal. It knows because it looks at what you're typing into — not just what you said.",
    tag: "Dictation",
  },
  {
    time: "ongoing",
    title: "Remembers your words.",
    body: "Say a name or a piece of jargon once. It's spelled right the second time, and every time after — no dictionary to maintain by hand.",
    tag: "Dictation",
  },
  {
    time: "0:00 — press, twice",
    title: "Ask, don't just dictate.",
    body: "Hold the same key twice and Pyper stops transcribing, starts answering. Draft a reply, summarize a thread, work through a question — without leaving your cursor or opening another app.",
    tag: "Action",
    action: true,
  },
];

export default function FeaturesPage() {
  return (
    <>
      <Header />

      <main className="features-main">
        <section className="fx-hero">
          <div className="fx-eyebrow">
            <span className="fx-eyebrow-dot" />
            {BRAND.name} · one hotkey
          </div>
          <h1 className="fx-title">
            Your voice, <span className="fx-accent">understood</span> — not just{" "}
            <span className="fx-accent2">typed</span>.
          </h1>
          <p className="fx-subhead">
            Hold a key and speak. What lands on screen is what you meant — cleaned up,
            in the right tone, spelled correctly. Hold it twice, and it stops
            transcribing and starts answering.
          </p>

          <FeaturesDemo />
        </section>

        <section className="fx-session">
          <h2 className="fx-session-heading">One session, start to finish</h2>
          <p className="fx-session-sub">
            Everything that happens between pressing the key and getting your text — in
            the order it actually happens.
          </p>

          <div className="fx-timeline">
            {STEPS.map((step) => (
              <div
                key={step.title}
                className={`fx-feature${step.action ? " fx-feature--action" : ""}`}
              >
                <span className="fx-feature-dot" />
                <span className="fx-feature-time">{step.time}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
                <span className="fx-tag">{step.tag}</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="site-footer container">
        <span>
          © {new Date().getFullYear()} {BRAND.name} · Built by SaaS Labs
        </span>
        <span>
          {BRAND.domain} · Derived from the open-source OpenWhispr project (MIT)
        </span>
      </footer>
    </>
  );
}
