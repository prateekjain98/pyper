import React from "react";
import { useTranslation } from "react-i18next";
import {
  Gauge,
  Wand2,
  Type,
  Smartphone,
  Monitor,
  Flame,
  Users,
  Loader2,
} from "lucide-react";
import { useInsights } from "../../hooks/useInsights";
import WpmGauge from "./WpmGauge";
import ContributionHeatmap from "./ContributionHeatmap";

interface InsightsViewProps {
  /** Optional — wires the "See team usage" button to open settings. */
  onOpenSettings?: (section?: string) => void;
}

const cardClass =
  "rounded-xl border border-border/40 bg-card/60 p-5 dark:border-white/6 dark:bg-surface-1/40";

function CardHeader({
  icon: Icon,
  title,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-2 text-muted-foreground">
      <Icon size={15} className="text-primary" />
      <span className="text-xs font-semibold uppercase tracking-wide">{title}</span>
    </div>
  );
}

// Descending primary shades give the bars a cohesive on-theme gradient.
const BAR_SHADE = [
  "bg-primary",
  "bg-primary/80",
  "bg-primary/65",
  "bg-primary/50",
  "bg-primary/40",
  "bg-primary/30",
];

export default function InsightsView({ onOpenSettings }: InsightsViewProps = {}) {
  const { t } = useTranslation();
  const insights = useInsights();

  if (insights.isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={15} className="animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-5xl px-8 py-7">
        {/* ------------------------------ Header ------------------------------ */}
        <header className="mb-7 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-foreground">
            {t("insights.title")}
          </h1>
          <button
            type="button"
            onClick={() => onOpenSettings?.("plansBilling")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-foreground/5 dark:border-white/8 dark:hover:bg-white/5"
          >
            <Users size={15} />
            {t("insights.seeTeamUsage")}
          </button>
        </header>

        {!insights.hasData && (
          <div className="mb-6 rounded-xl border border-dashed border-border/50 px-5 py-4 text-sm text-muted-foreground dark:border-white/8">
            {t("insights.emptyHint")}
          </div>
        )}

        {/* --------------------------- Stat cards row -------------------------- */}
        <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Words per minute */}
          <div className={cardClass}>
            <CardHeader icon={Gauge} title={t("insights.wpm.title")} />
            <WpmGauge
              value={insights.wpm}
              available={insights.wpmAvailable}
              emptyLabel={t("insights.wpm.noData")}
            />
            {insights.wpmSampleCount > 1 && (
              <div className="mt-3 flex items-center justify-center">
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                  {t("insights.wpm.samples", { count: insights.wpmSampleCount })}
                </span>
              </div>
            )}
          </div>

          {/* Fixes made by Pyper */}
          <div className={cardClass}>
            <CardHeader icon={Wand2} title={t("insights.fixes.title")} />
            <div className="text-4xl font-bold tracking-tight tabular-nums text-foreground">
              {insights.fixesTotal.toLocaleString()}
            </div>
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t("insights.fixes.wordsCorrected")}</span>
                <span className="font-medium tabular-nums text-foreground">
                  {insights.wordsCorrected.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t("insights.fixes.dictionaryFixes")}
                </span>
                <span className="font-medium tabular-nums text-foreground">
                  {insights.dictionaryFixes.toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* Total words dictated */}
          <div className={cardClass}>
            <CardHeader icon={Type} title={t("insights.totalWords.title")} />
            <div className="text-4xl font-bold tracking-tight tabular-nums text-foreground">
              {insights.totalWords.toLocaleString()}
            </div>
            <div className="mt-4 space-y-2.5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Monitor size={14} className="text-foreground/50" />
                <span>
                  {t("insights.totalWords.desktop", {
                    words: insights.totalWords.toLocaleString(),
                  })}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground/70">
                <Smartphone size={14} className="text-foreground/40" />
                <span>{t("insights.totalWords.downloadMobile")}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ----------------------------- Top words ---------------------------- */}
        {insights.topWords.length > 0 && (
          <div className={`${cardClass} mb-4`}>
            <div className="mb-4 flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("insights.topWords.title")}
              </span>
              <span className="text-sm font-semibold tabular-nums text-foreground">
                {t("insights.topWords.unique", { count: insights.distinctWordCount })}
              </span>
            </div>
            <div className="space-y-2.5">
              {insights.topWords.map((word, i) => (
                <div key={word.word} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 truncate text-sm text-foreground/80">
                    {word.word}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-foreground/8 dark:bg-white/8">
                    <div
                      className={`h-full rounded-full ${BAR_SHADE[i] ?? "bg-primary/30"}`}
                      style={{ width: `${word.barPercent}%` }}
                    />
                  </div>
                  <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {word.count.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ------------------------------ Streak ------------------------------ */}
        <div className={cardClass}>
          <div className="mb-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Flame size={18} />
              </div>
              <span className="text-lg font-bold tracking-tight text-foreground">
                {t("insights.streak.title", { count: insights.currentStreak })}
              </span>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("insights.streak.longest")}
              </div>
              <div className="text-sm font-semibold tabular-nums text-foreground">
                {insights.longestStreak}
              </div>
            </div>
          </div>
          <ContributionHeatmap
            activityByDay={insights.activityByDay}
            todayIndex={insights.todayIndex}
          />
        </div>
      </div>
    </div>
  );
}
