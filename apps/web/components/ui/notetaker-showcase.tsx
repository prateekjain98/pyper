"use client";

import React from "react";

/**
 * Notetaker — Pyper's second product surface, and until now missing from the
 * site entirely. Everything claimed here ships in the desktop app: on-device
 * meeting detection (meetingProcessDetector.js), speaker diarization
 * (diarization.js) and Google/Microsoft/Apple calendar sync.
 */

const SPEAKERS = {
  priya: {
    name: "Priya",
    dot: "bg-brand",
    chip: "bg-brand/15 text-brand ring-brand/25",
  },
  marcus: {
    name: "Marcus",
    dot: "bg-emerald-400",
    chip: "bg-emerald-400/15 text-emerald-300 ring-emerald-400/25",
  },
  sara: {
    name: "Sara",
    dot: "bg-amber-400",
    chip: "bg-amber-400/15 text-amber-300 ring-amber-400/25",
  },
} as const;

const TRANSCRIPT: Array<{ s: keyof typeof SPEAKERS; t: string }> = [
  { s: "priya", t: "Can we get the pricing page out this sprint?" },
  { s: "marcus", t: "Only if finance signs off on the new discount tier." },
  {
    s: "sara",
    t: "I'm still waiting on the SOC 2 letter — that's blocking two deals.",
  },
  { s: "priya", t: "I'll chase finance and confirm by Thursday." },
];

const ACTIONS = [
  { who: "priya", text: "Confirm discount tier with finance", due: "Thu" },
  { who: "marcus", text: "Ship pricing page this sprint", due: "Sprint" },
  { who: "sara", text: "Chase SOC 2 letter — unblocks 2 deals", due: "ASAP" },
] as const;

export function NotetakerShowcase() {
  /* The call actually runs: lines land one at a time, then the action items are
     pulled out of them. A static transcript can't show that it happens live. */
  const total = TRANSCRIPT.length + ACTIONS.length;
  const [shown, setShown] = React.useState(total);

  React.useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let alive = true;
    let t: number;
    const run = async () => {
      while (alive) {
        setShown(0);
        await new Promise((r) => (t = window.setTimeout(r, 700)));
        for (let i = 1; i <= total; i++) {
          if (!alive) return;
          setShown(i);
          await new Promise(
            (r) =>
              (t = window.setTimeout(r, i <= TRANSCRIPT.length ? 620 : 380)),
          );
        }
        await new Promise((r) => (t = window.setTimeout(r, 3200)));
      }
    };
    void run();
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [total]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
      {/* live meeting transcript, speaker-attributed */}
      <div className="rounded-2xl border border-line bg-[#0f131c] p-6 sm:p-7">
        <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-400" />
            </span>
            <span className="text-sm font-medium text-ink">Weekly sync</span>
            <span className="font-mono text-[11px] text-muted">· Zoom</span>
          </div>
          <span className="font-mono text-[11px] text-muted">
            no bot in the call
          </span>
        </div>

        <div className="mt-5 space-y-4">
          {TRANSCRIPT.map((line, i) => {
            const sp = SPEAKERS[line.s];
            return (
              <div
                key={i}
                className={`flex gap-3 transition-all duration-300 ${
                  i < shown
                    ? "translate-y-0 opacity-100"
                    : "translate-y-1 opacity-0"
                }`}
              >
                <span
                  className={`mt-0.5 h-fit flex-none rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${sp.chip}`}
                >
                  {sp.name}
                </span>
                <p className="text-[15px] leading-relaxed text-ink/85">
                  {line.t}
                </p>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex items-center gap-2 border-t border-line pt-4">
          <span className="font-mono text-[11px] text-muted">
            speakers separated on-device · nothing uploaded to identify a voice
          </span>
        </div>
      </div>

      {/* what you actually keep */}
      <div className="rounded-2xl border border-brand/25 bg-[#0d1424] p-6 sm:p-7">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-brand">
          — after the call
        </span>

        <h3 className="mt-4 text-lg font-semibold text-ink">Action items</h3>
        <ul className="mt-4 space-y-2.5">
          {ACTIONS.map((a) => (
            <li
              key={a.text}
              className={`flex items-start gap-3 rounded-xl bg-white/[0.03] px-3.5 py-3 ring-1 ring-line transition-all duration-300 ${
                TRANSCRIPT.length + ACTIONS.indexOf(a) < shown
                  ? "translate-y-0 opacity-100"
                  : "translate-y-1 opacity-0"
              }`}
            >
              <span
                className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${SPEAKERS[a.who].dot}`}
              />
              <span className="flex-1 text-[14px] leading-snug text-ink/90">
                {a.text}
              </span>
              <span className="font-mono text-[11px] text-muted">{a.due}</span>
            </li>
          ))}
        </ul>

        <p className="mt-5 border-t border-line pt-4 text-[13px] leading-relaxed text-muted">
          Every transcript lands in your notes workspace — folders, semantic
          search, and AI actions — so a meeting becomes something you can act
          on, not a wall of text.
        </p>
      </div>
    </div>
  );
}
