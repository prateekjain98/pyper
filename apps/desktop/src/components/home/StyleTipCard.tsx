import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";
import type { StyleTip, TipSegment } from "./homeMockData";

const SERIF = "'Crimson Text', Georgia, 'Times New Roman', serif";
const ROTATE_INTERVAL_MS = 9000;

interface StyleTipCardProps {
  tips: StyleTip[];
}

/** Inline keycap chip, e.g. fn. */
function Keycap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center align-middle rounded-md border border-black/15 dark:border-white/20 bg-white dark:bg-white/10 px-1.5 py-0.5 font-sans text-[0.82em] font-medium leading-none text-neutral-700 dark:text-neutral-200 shadow-[0_1px_0_rgba(0,0,0,0.05)]">
      {children}
    </kbd>
  );
}

function renderSegments(
  segments: TipSegment[],
  t: (key: string) => string,
  emphasis: "italic" | "bold"
): React.ReactNode {
  return segments.map((segment, index) => {
    const value = t(segment.key);
    const spacer = index > 0 ? " " : "";

    if (segment.kind === "keycap") {
      return (
        <React.Fragment key={index}>
          {spacer}
          <Keycap>{value}</Keycap>
        </React.Fragment>
      );
    }

    if (segment.kind === "emphasis") {
      return (
        <React.Fragment key={index}>
          {spacer}
          {emphasis === "italic" ? (
            <em className="italic">{value}</em>
          ) : (
            <strong className="font-semibold text-foreground/90">{value}</strong>
          )}
        </React.Fragment>
      );
    }

    return (
      <React.Fragment key={index}>
        {spacer}
        {value}
      </React.Fragment>
    );
  });
}

export default function StyleTipCard({ tips }: StyleTipCardProps) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // Auto-rotate through the tip variants (variant 1 first). Pauses while the
  // pointer is over the card, and the timer resets after each change — so a
  // manual pick via the dots gets a full dwell before it advances.
  useEffect(() => {
    if (tips.length <= 1 || paused) return;
    const id = window.setTimeout(() => {
      setIndex((current) => (current + 1) % tips.length);
    }, ROTATE_INTERVAL_MS);
    return () => window.clearTimeout(id);
  }, [index, paused, tips.length]);

  const tip = tips[index];
  if (!tip) return null;

  return (
    <div
      className="relative mt-6 overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.06] dark:bg-primary/[0.13] p-6 shadow-sm transition-colors duration-300 hover:border-primary/35"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Content cross-fades on each rotation (remounts via key) */}
      <div
        key={index}
        className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-500 motion-safe:ease-out"
      >
        <h2
          className="text-[32px] leading-[1.15] tracking-[-0.02em] text-foreground text-balance"
          style={{ fontFamily: SERIF }}
        >
          {renderSegments(tip.heading, t, "italic")}
        </h2>

        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          {renderSegments(tip.body, t, "bold")}
        </p>

        <button
          type="button"
          className="group mt-6 inline-flex items-center h-10 px-5 rounded-lg bg-foreground text-[14px] font-medium text-background outline-none shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {t(tip.ctaKey)}
        </button>
      </div>

      {/* Pagination — subtle, clickable, pauses-with-hover */}
      {tips.length > 1 && (
        <div className="absolute bottom-5 right-5 flex items-center gap-1.5">
          {tips.map((tipItem, i) => (
            <button
              key={tipItem.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show tip ${i + 1} of ${tips.length}`}
              aria-current={i === index ? "true" : undefined}
              className={cn(
                "h-1.5 rounded-full outline-none transition-all duration-300 focus-visible:ring-2 focus-visible:ring-primary/40",
                i === index
                  ? "w-5 bg-foreground/70"
                  : "w-1.5 bg-foreground/20 hover:bg-foreground/40"
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
