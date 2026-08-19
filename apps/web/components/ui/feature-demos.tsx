"use client";

import React from "react";

/**
 * Live, looping demos of the three features — the thing a screenshot cannot do.
 * Each runs the real sequence a user sees in the app: a word mis-heard then
 * learned, a trigger expanding, numbers accruing. Built from the app's own
 * surface styling rather than pasted images.
 */

function useLoop(steps: number, ms: number) {
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return; // respect the OS setting: hold on the resolved state
    const t = window.setInterval(() => setI((n) => (n + 1) % steps), ms);
    return () => window.clearInterval(t);
  }, [steps, ms]);
  return i;
}

const Surface = ({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) => (
  <div className="overflow-hidden rounded-2xl bg-[#0b0e14] ring-1 ring-white/10">
    <div className="flex items-center gap-2 border-b border-white/[0.07] bg-white/[0.03] px-4 py-2.5">
      <span className="h-1.5 w-1.5 rounded-full bg-brand" />
      <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/40">
        {label}
      </span>
    </div>
    <div className="p-5">{children}</div>
  </div>
);

/* ---------- 1. Dictionary: mis-heard, taught, then right forever ---------- */
export function DictionaryDemo() {
  const step = useLoop(3, 2200); // 0 wrong · 1 learning · 2 right
  return (
    <Surface label="Pyper — Dictionary">
      <div className="min-h-[132px]">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
          you said
        </div>
        <p className="mt-2 text-[15px] text-ink/85">
          &ldquo;Send the deck to Nilesh Tripathi&rdquo;
        </p>

        <div className="mt-4 border-t border-line pt-4">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
            it typed
          </div>
          <p className="mt-2 text-[15px]">
            Send the deck to{" "}
            {step === 0 ? (
              <span className="text-rose-300 line-through decoration-rose-400/60">
                Nile&rsquo;sh Tripati
              </span>
            ) : (
              <span
                className={`font-medium ${step === 1 ? "text-amber-300" : "text-emerald-300"} transition-colors`}
              >
                Nilesh Tripathi
              </span>
            )}
          </p>
        </div>

        <div className="mt-4 flex h-6 items-center gap-2">
          {step >= 1 && (
            <span className="inline-flex animate-[fadeIn_.3s_ease] items-center gap-1.5 rounded-md bg-brand/15 px-2 py-1 font-mono text-[10.5px] text-brand ring-1 ring-brand/25">
              + added to dictionary
            </span>
          )}
          {step === 2 && (
            <span className="font-mono text-[10.5px] text-emerald-300/80">
              right from now on
            </span>
          )}
        </div>
      </div>
    </Surface>
  );
}

/* ---------- 2. Snippets: a trigger typing out, then expanding ---------- */
const SNIPPET_OUT = "Hi — I lead the AI services business at SaaS Labs.";
export function SnippetsDemo() {
  const [phase, setPhase] = React.useState(0); // 0 typing · 1 expanding · 2 done
  const [typed, setTyped] = React.useState("");
  React.useEffect(() => {
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) {
      setTyped("intro");
      setPhase(2);
      return;
    }
    let alive = true;
    const run = async () => {
      while (alive) {
        setPhase(0);
        setTyped("");
        for (const ch of "intro") {
          if (!alive) return;
          await new Promise((r) => setTimeout(r, 170));
          setTyped((t) => t + ch);
        }
        await new Promise((r) => setTimeout(r, 420));
        if (!alive) return;
        setPhase(1);
        await new Promise((r) => setTimeout(r, 260));
        if (!alive) return;
        setPhase(2);
        await new Promise((r) => setTimeout(r, 2100));
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Surface label="Pyper — Snippets">
      <div className="min-h-[132px]">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
          you say
        </div>
        <div className="mt-2 flex items-center gap-1">
          <span className="rounded-md bg-brand/15 px-2 py-1 font-mono text-[13px] text-brand ring-1 ring-brand/25">
            {typed || " "}
          </span>
          {phase === 0 && <span className="h-4 w-px animate-pulse bg-brand" />}
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
            what lands
          </div>
          <p
            className={`mt-2 text-[15px] leading-relaxed transition-all duration-300 ${
              phase === 2
                ? "text-ink opacity-100"
                : "text-ink/30 opacity-40 blur-[2px]"
            }`}
          >
            {SNIPPET_OUT}
          </p>
        </div>
      </div>
    </Surface>
  );
}

/* ---------- 3. Insights: numbers accruing ---------- */
function useCount(to: number, ms = 1400) {
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
      return setN(to);
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return n;
}

export function InsightsDemo() {
  const wpm = useCount(142);
  const words = useCount(18420, 1800);
  const fixes = useCount(376, 1600);
  return (
    <Surface label="Pyper — Insights">
      <div className="grid min-h-[132px] grid-cols-3 gap-3">
        {[
          { k: "words / min", v: wpm.toString() },
          { k: "words dictated", v: words.toLocaleString() },
          { k: "fixes made", v: fixes.toString() },
        ].map((s) => (
          <div
            key={s.k}
            className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-line"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              {s.k}
            </div>
            <div className="mt-2 text-[1.6rem] font-bold tabular-nums tracking-tight text-ink">
              {s.v}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-1">
        {Array.from({ length: 28 }, (_, i) => (
          <span
            key={i}
            className="h-6 flex-1 rounded-sm"
            style={{
              background: `oklch(0.72 0.22 260 / ${(0.08 + ((i * 37) % 11) / 12).toFixed(2)})`,
            }}
          />
        ))}
      </div>
    </Surface>
  );
}
