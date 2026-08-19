"use client";

import React from "react";

/**
 * The product's core proof, shown rather than claimed: one real dictation, the
 * disfluencies marked up in place, and the same sentence re-toned for wherever
 * the cursor happens to be.
 *
 * The channel outputs mirror the REAL style rules the proxy sends to the cleanup
 * model (services/pyai-proxy/channelStyles.js) — Slack stays casual with no
 * greeting, Gmail gains a greeting and sign-off on their own lines, Notes
 * collapse to terse fragments. Nothing here is aspirational.
 */

type Kind = "filler" | "hedge" | "restart" | "trailing";

const KIND_LABEL: Record<Kind, string> = {
  filler: "filler",
  hedge: "hedge",
  restart: "false start",
  trailing: "trailing",
};

// Tailwind can't see runtime-built class names, so keep these literal.
const KIND_CLASS: Record<Kind, string> = {
  filler: "text-rose-300/70 decoration-rose-400/60",
  hedge: "text-amber-300/70 decoration-amber-400/60",
  restart: "text-violet-300/70 decoration-violet-400/60",
  trailing: "text-sky-300/70 decoration-sky-400/60",
};

const KIND_DOT: Record<Kind, string> = {
  filler: "bg-rose-400/80",
  hedge: "bg-amber-400/80",
  restart: "bg-violet-400/80",
  trailing: "bg-sky-400/80",
};

/** The raw utterance. `cut` marks a token the cleanup stage removes. */
const RAW: Array<{ t: string; cut?: Kind }> = [
  { t: "um", cut: "filler" },
  { t: "so", cut: "filler" },
  { t: "I" },
  { t: "looked" },
  { t: "at" },
  { t: "the" },
  { t: "numbers" },
  { t: "again" },
  { t: "and" },
  { t: "I", cut: "hedge" },
  { t: "think", cut: "hedge" },
  { t: "the—", cut: "restart" },
  { t: "the" },
  { t: "pricing" },
  { t: "page" },
  { t: "is" },
  { t: "uh", cut: "filler" },
  { t: "the" },
  { t: "issue" },
  { t: "can" },
  { t: "we" },
  { t: "maybe", cut: "hedge" },
  { t: "move" },
  { t: "the" },
  { t: "review" },
  { t: "to" },
  { t: "like", cut: "filler" },
  { t: "Thursday" },
  { t: "afternoon" },
  { t: "if", cut: "trailing" },
  { t: "that", cut: "trailing" },
  { t: "works", cut: "trailing" },
];

const CHANNELS = [
  {
    id: "slack",
    name: "Slack",
    rule: "casual · no greeting · kept short",
    body: "Numbers say the pricing page is the problem — can we move the review to Thursday afternoon?",
  },
  {
    id: "gmail",
    name: "Gmail",
    rule: "formal · greeting + sign-off",
    body: "Hi,\n\nLooking at the numbers again, the pricing page appears to be the issue. Could we move the review to Thursday afternoon?\n\nThanks,",
  },
  {
    id: "notes",
    name: "Notes",
    rule: "terse · fragments and bullets",
    body: "• Pricing page — main issue (per the numbers)\n• Move review → Thursday afternoon",
  },
] as const;

export function CleanupProof() {
  const [channel, setChannel] = React.useState<string>("slack");
  const active = CHANNELS.find((c) => c.id === channel) ?? CHANNELS[0];

  const removed = RAW.filter((w) => w.cut).length;
  const kinds: Kind[] = ["filler", "hedge", "restart", "trailing"];

  return (
    <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
      {/* ---------------- raw, marked up in place ---------------- */}
      <div className="rounded-2xl border border-line bg-[#0f131c] p-6 sm:p-7">
        <div className="flex items-center justify-between gap-4">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            — what you said
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />
            raw transcript
          </span>
        </div>

        <p className="mt-5 text-[17px] leading-[1.85] text-ink/90">
          {RAW.map((w, i) => (
            <React.Fragment key={`${w.t}-${i}`}>
              {w.cut ? (
                <span
                  className={`line-through decoration-2 ${KIND_CLASS[w.cut]}`}
                >
                  {w.t}
                </span>
              ) : (
                <span>{w.t}</span>
              )}{" "}
            </React.Fragment>
          ))}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4">
          {kinds.map((k) => (
            <span
              key={k}
              className="flex items-center gap-2 text-xs text-muted"
            >
              <span className={`h-2 w-2 rounded-full ${KIND_DOT[k]}`} />
              {KIND_LABEL[k]}
            </span>
          ))}
        </div>
      </div>

      {/* ---------------- cleaned, per destination ---------------- */}
      <div className="rounded-2xl border border-brand/25 bg-[#0d1424] p-6 sm:p-7">
        <div className="flex items-center justify-between gap-4">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-brand">
            — what gets typed
          </span>
          <div className="flex gap-1">
            {CHANNELS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setChannel(c.id)}
                aria-pressed={c.id === channel}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  c.id === channel
                    ? "bg-brand text-white"
                    : "text-muted hover:bg-white/5 hover:text-ink"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-5 whitespace-pre-line text-[17px] leading-[1.75] text-ink">
          {active.body}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <span className="font-mono text-[11px] text-muted">
            {active.rule}
          </span>
          <span className="text-xs font-medium text-brand">
            meaning kept · {removed} words removed
          </span>
        </div>
      </div>
    </div>
  );
}
