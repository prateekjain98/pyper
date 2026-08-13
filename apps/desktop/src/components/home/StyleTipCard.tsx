import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { StyleTip, TipSegment } from "./homeMockData";

const SERIF = "Georgia, 'Times New Roman', serif";
const ROTATE_INTERVAL_MS = 9000;

interface StyleTipCardProps {
  tips: StyleTip[];
}

/** Inline keycap chip, e.g. ⌃ Ctrl. */
function Keycap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center align-middle rounded-md border border-black/15 bg-white px-1.5 py-0.5 font-sans text-[0.82em] font-medium leading-none text-neutral-700 shadow-[0_1px_0_rgba(0,0,0,0.05)]">
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
            <strong className="font-semibold text-neutral-800">{value}</strong>
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

  // Auto-rotate through the tip variants (variant 1 renders first).
  useEffect(() => {
    if (tips.length <= 1) return;
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % tips.length);
    }, ROTATE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [tips.length]);

  const tip = tips[index];
  if (!tip) return null;

  return (
    <div className="mt-6 rounded-2xl border border-black/[0.06] bg-[#FBFBEA] p-8">
      <h2
        className="text-[26px] leading-[1.25] text-[#1F1F1F]"
        style={{ fontFamily: SERIF }}
      >
        {renderSegments(tip.heading, t, "italic")}
      </h2>

      <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-neutral-600">
        {renderSegments(tip.body, t, "bold")}
      </p>

      <button
        type="button"
        className="mt-6 inline-flex items-center h-10 px-5 rounded-lg bg-[#1F1F1F] text-[14px] font-medium text-white outline-none transition-colors hover:bg-black focus-visible:ring-2 focus-visible:ring-[#8B7CF6]/40"
      >
        {t(tip.ctaKey)}
      </button>
    </div>
  );
}
