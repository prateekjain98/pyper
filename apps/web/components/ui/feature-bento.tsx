"use client";

import React from "react";
import { Lock, Search, Sparkles, Apple, Monitor, Terminal } from "lucide-react";

/**
 * Feature bento — the 21st.dev bento pattern (asymmetric tiles, each carrying a
 * real visual rather than an icon), implemented with the deps already in this
 * app. Every tile shows the feature working instead of describing it.
 */

const Tile = ({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => (
  <div className={`flex flex-col bg-[#0f131c] p-6 ${className}`}>
    {children}
  </div>
);

const Caption = ({ title, body }: { title: string; body: string }) => (
  <div className="mt-5">
    <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
    <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{body}</p>
  </div>
);

export function FeatureBento() {
  return (
    <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
      {/* ---- Dictate anywhere: text landing in two real destinations ---- */}
      <Tile className="lg:col-span-2">
        <div className="flex-1 space-y-2.5">
          {[
            {
              app: "Slack",
              ch: "#team-product",
              text: "Numbers say the pricing page is the problem.",
            },
            {
              app: "Gmail",
              ch: "To: sara@acme.com",
              text: "Hi, — could we move the review to Thursday?",
            },
          ].map((m) => (
            <div
              key={m.app}
              className="rounded-xl bg-white/[0.03] p-3.5 ring-1 ring-line"
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-ink/70">
                  {m.app}
                </span>
                <span className="font-mono text-[10px] text-muted">{m.ch}</span>
              </div>
              <p className="mt-2 text-[13px] leading-snug text-ink/85">
                {m.text}
                <span className="ml-0.5 inline-block h-3.5 w-px translate-y-0.5 animate-pulse bg-brand" />
              </p>
            </div>
          ))}
        </div>
        <Caption
          title="Dictate anywhere"
          body="One hotkey works in every app. Text lands at the cursor already matching where it landed — casual in Slack, formal in Gmail."
        />
      </Tile>

      {/* ---- Private by default: the actual choice, shown ---- */}
      <Tile>
        <div className="flex-1">
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl bg-brand/10 px-3.5 py-3 ring-1 ring-brand/25">
              <span className="text-[13px] font-medium text-ink">
                Pyper Cloud
              </span>
              <span className="font-mono text-[10px] text-brand">default</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3.5 py-3 ring-1 ring-line">
              <span className="flex items-center gap-2 text-[13px] text-ink/80">
                <Lock className="h-3.5 w-3.5 text-emerald-400" />
                On-device
              </span>
              <span className="font-mono text-[10px] text-muted">
                no network
              </span>
            </div>
          </div>
        </div>
        <Caption
          title="Private by default"
          body="Every stage has a local implementation. Switch to on-device and your voice never leaves the machine."
        />
      </Tile>

      {/* ---- Meetings: speaker separation ---- */}
      <Tile>
        <div className="flex-1 space-y-3">
          {[
            { n: "Priya", w: "78%", c: "bg-brand" },
            { n: "Marcus", w: "54%", c: "bg-emerald-400" },
            { n: "Sara", w: "35%", c: "bg-amber-400" },
          ].map((s) => (
            <div key={s.n} className="flex items-center gap-3">
              <span className="w-14 flex-none font-mono text-[11px] text-muted">
                {s.n}
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                <span
                  className={`block h-full rounded-full ${s.c}`}
                  style={{ width: s.w }}
                />
              </span>
            </div>
          ))}
        </div>
        <Caption
          title="Meeting transcription"
          body="Calls are captured with speakers separated on-device — no bot joins the meeting."
        />
      </Tile>

      {/* ---- Semantic search ---- */}
      <Tile>
        <div className="flex-1">
          <div className="flex items-center gap-2 rounded-xl bg-white/[0.03] px-3.5 py-2.5 ring-1 ring-line">
            <Search className="h-3.5 w-3.5 text-muted" />
            <span className="text-[13px] text-ink/70">financial forecast</span>
          </div>
          <div className="mt-2.5 space-y-1.5">
            {["Quarterly revenue projections", "Pricing review — Thursday"].map(
              (r) => (
                <div
                  key={r}
                  className="rounded-lg bg-brand/[0.07] px-3 py-2 text-[12px] text-ink/80 ring-1 ring-brand/15"
                >
                  {r}
                </div>
              ),
            )}
          </div>
        </div>
        <Caption
          title="Notes & search"
          body="Everything you dictate becomes searchable by meaning, not just keywords — and it runs offline."
        />
      </Tile>

      {/* ---- Agent ---- */}
      <Tile>
        <div className="flex-1 space-y-2">
          <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-brand px-3.5 py-2 text-[12.5px] text-white">
            Summarise this thread and draft a reply
          </div>
          <div className="w-fit max-w-[90%] rounded-2xl rounded-bl-sm bg-white/[0.05] px-3.5 py-2 text-[12.5px] text-ink/85 ring-1 ring-line">
            <Sparkles className="mr-1.5 inline h-3 w-3 text-brand" />
            Drafted — three decisions, one open question.
          </div>
        </div>
        <Caption
          title="Ask, not just dictate"
          body="Hold the hotkey a beat longer and Pyper answers instead of transcribing — over the model you choose."
        />
      </Tile>

      {/* ---- Platforms ---- */}
      <Tile>
        <div className="flex-1">
          <div className="flex flex-wrap gap-2">
            {[
              { i: Apple, l: "macOS", on: true },
              { i: Monitor, l: "Windows", on: false },
              { i: Terminal, l: "Linux", on: false },
            ].map((p) => (
              <span
                key={p.l}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] ring-1 ${
                  p.on
                    ? "bg-brand/10 text-ink ring-brand/25"
                    : "bg-white/[0.03] text-muted ring-line"
                }`}
              >
                <p.i className="h-3.5 w-3.5" />
                {p.l}
                {!p.on && <span className="font-mono text-[10px]">soon</span>}
              </span>
            ))}
          </div>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white/[0.03] px-2.5 py-1.5 font-mono text-[11px] text-muted ring-1 ring-line">
            MIT licensed
          </div>
        </div>
        <Caption
          title="Cross-platform & open"
          body="Native desktop apps and source you can read, audit and build yourself."
        />
      </Tile>
    </div>
  );
}
