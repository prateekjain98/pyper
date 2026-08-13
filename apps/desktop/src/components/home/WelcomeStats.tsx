import React from "react";
import { useTranslation } from "react-i18next";
import type { HomeStats } from "./homeMockData";

interface WelcomeStatsProps {
  name: string;
  stats: HomeStats;
}

function StatItem({ emoji, label }: { emoji: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3">
      <span aria-hidden="true" className="text-[13px] leading-none">
        {emoji}
      </span>
      <span className="text-[13px] font-medium text-[#3F3F3F] whitespace-nowrap">{label}</span>
    </div>
  );
}

function Divider() {
  return <span aria-hidden="true" className="w-px h-4 bg-black/10" />;
}

export default function WelcomeStats({ name, stats }: WelcomeStatsProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <h1 className="text-[28px] font-semibold tracking-tight text-[#1F1F1F]">
        {t("home.welcomeBack", { name })}
      </h1>

      <div className="flex items-center rounded-full bg-[#F3F2F0] border border-black/[0.05] py-1.5">
        <StatItem emoji="🔥" label={t("home.stats.weekStreak", { count: stats.streakWeeks })} />
        <Divider />
        <StatItem
          emoji="🚀"
          label={t("home.stats.words", { value: stats.wordCount.toLocaleString() })}
        />
        <Divider />
        <StatItem emoji="👏" label={t("home.stats.wpm", { value: stats.wpm })} />
      </div>
    </div>
  );
}
