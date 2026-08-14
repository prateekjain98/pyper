import React from "react";
import { useTranslation } from "react-i18next";

interface WelcomeStatsProps {
  /** Display name rendered in "Welcome back, {name}". */
  name: string;
  /** Current consecutive-day dictation streak. */
  streakDays: number;
  /** Total words dictated across all history. */
  totalWords: number;
  /** Average words per minute. */
  wpm: number;
  /** False when no recording carried an audio duration to compute WPM from. */
  wpmAvailable: boolean;
}

function StatItem({ emoji, label }: { emoji: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3">
      <span aria-hidden="true" className="text-[14px] leading-none">
        {emoji}
      </span>
      <span className="text-[15px] font-medium text-[#5a555c] dark:text-neutral-300 tracking-[-0.01em] whitespace-nowrap">
        {label}
      </span>
    </div>
  );
}

/**
 * "Welcome back" header with a stat pill (streak · words · WPM). Each stat is
 * shown only when it has a real value, so a brand-new user sees just the
 * greeting rather than a row of zeros. Wired to live insights data by the
 * parent (see HomeDashboardView).
 */
export default function WelcomeStats({
  name,
  streakDays,
  totalWords,
  wpm,
  wpmAvailable,
}: WelcomeStatsProps) {
  const { t } = useTranslation();

  const pills = [
    streakDays > 0 && {
      emoji: "🔥",
      label: t("insights.streak.title", { count: streakDays }),
    },
    totalWords > 0 && {
      emoji: "🚀",
      label: t("home.stats.words", { value: totalWords.toLocaleString() }),
    },
    wpmAvailable &&
      wpm > 0 && {
        emoji: "👋",
        label: t("home.stats.wpm", { value: wpm }),
      },
  ].filter(Boolean) as { emoji: string; label: string }[];

  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <h1 className="text-[24px] font-semibold tracking-tight text-foreground">
        {t("home.welcomeBack", { name })}
      </h1>

      {pills.length > 0 && (
        <div className="flex items-center rounded-2xl bg-[#F7F6F9] dark:bg-white/[0.06] border border-black/[0.03] dark:border-white/10 py-1.5">
          {pills.map((pill, index) => (
            <React.Fragment key={pill.emoji}>
              {index > 0 && <span aria-hidden="true" className="w-px h-4 bg-border" />}
              <StatItem emoji={pill.emoji} label={pill.label} />
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
