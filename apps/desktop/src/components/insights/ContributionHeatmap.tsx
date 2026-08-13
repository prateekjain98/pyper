import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { partsFromDayIndex, type DayActivity } from "../../hooks/useInsights";

interface ContributionHeatmapProps {
  activityByDay: Map<number, DayActivity>;
  todayIndex: number;
  /** How many trailing weeks (columns) to render. */
  weeks?: number;
}

// Level 0 = no activity; 1–4 ramp the primary color. Built with plain divs +
// Tailwind — no charting dependency.
const LEVEL_CLASS = [
  "bg-foreground/[0.07] dark:bg-white/[0.06]",
  "bg-primary/25",
  "bg-primary/45",
  "bg-primary/70",
  "bg-primary",
];

function levelFor(count: number): number {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
}

function localDate(index: number): Date {
  const { year, month, day } = partsFromDayIndex(index);
  return new Date(year, month, day);
}

interface Cell {
  index: number;
  isFuture: boolean;
  activity: DayActivity | null;
}

export default function ContributionHeatmap({
  activityByDay,
  todayIndex,
  weeks = 27,
}: ContributionHeatmapProps) {
  const { t, i18n } = useTranslation();

  const { columns, monthLabels, weekdayLabels } = useMemo(() => {
    // Anchor the grid to the Saturday ending this week, then step back so the
    // final column is the current (possibly partial) week.
    const todayDow = localDate(todayIndex).getDay(); // 0 = Sunday
    const endIndex = todayIndex + (6 - todayDow);
    const startIndex = endIndex - (weeks * 7 - 1);

    const cols: Cell[][] = [];
    for (let w = 0; w < weeks; w++) {
      const col: Cell[] = [];
      for (let d = 0; d < 7; d++) {
        const index = startIndex + w * 7 + d;
        col.push({
          index,
          isFuture: index > todayIndex,
          activity: activityByDay.get(index) ?? null,
        });
      }
      cols.push(col);
    }

    // Month label above the first column whose top cell begins a new month.
    const monthFmt = new Intl.DateTimeFormat(i18n.language || undefined, { month: "short" });
    const labels: { col: number; label: string }[] = [];
    let lastMonth = -1;
    cols.forEach((col, idx) => {
      const top = localDate(col[0].index);
      const month = top.getMonth();
      if (month !== lastMonth) {
        labels.push({ col: idx, label: monthFmt.format(top) });
        lastMonth = month;
      }
    });

    // Weekday labels (Mon/Wed/Fri) — locale-aware, from a known reference week.
    const weekdayFmt = new Intl.DateTimeFormat(i18n.language || undefined, { weekday: "short" });
    const refSunday = startIndex - localDate(startIndex).getDay();
    const wdLabels = [1, 3, 5].map((row) => ({
      row,
      label: weekdayFmt.format(localDate(refSunday + row)),
    }));

    return { columns: cols, monthLabels: labels, weekdayLabels: wdLabels };
  }, [activityByDay, todayIndex, weeks, i18n.language]);

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language || undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    [i18n.language]
  );

  const weekdayLabelByRow = new Map(weekdayLabels.map((w) => [w.row, w.label]));

  return (
    <div className="w-full overflow-x-auto">
      <div className="inline-flex min-w-full flex-col gap-1.5">
        <div className="flex gap-[3px]">
          <div className="w-8 shrink-0" />
          {columns.map((_, col) => {
            const label = monthLabels.find((m) => m.col === col)?.label;
            return (
              <div key={col} className="h-3 w-3 shrink-0">
                {label && (
                  <span className="block whitespace-nowrap text-[10px] leading-3 text-muted-foreground">
                    {label}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex gap-[3px]">
          <div className="flex w-8 shrink-0 flex-col gap-[3px] pr-1">
            {Array.from({ length: 7 }, (_, row) => (
              <div key={row} className="flex h-3 items-center justify-end">
                <span className="text-[10px] leading-3 text-muted-foreground">
                  {weekdayLabelByRow.get(row) ?? ""}
                </span>
              </div>
            ))}
          </div>

          {columns.map((col, colIdx) => (
            <div key={colIdx} className="flex flex-col gap-[3px]">
              {col.map((cell) => {
                if (cell.isFuture) {
                  return <div key={cell.index} className="h-3 w-3" />;
                }
                const count = cell.activity?.count ?? 0;
                const dateLabel = dateFmt.format(localDate(cell.index));
                const title =
                  count > 0
                    ? t("insights.heatmap.tooltip", { count, date: dateLabel })
                    : t("insights.heatmap.tooltipEmpty", { date: dateLabel });
                return (
                  <div
                    key={cell.index}
                    title={title}
                    className={`h-3 w-3 rounded-[3px] ${LEVEL_CLASS[levelFor(count)]}`}
                  />
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-1.5 pt-1 text-[10px] text-muted-foreground">
          <span>{t("insights.heatmap.less")}</span>
          {LEVEL_CLASS.map((cls, i) => (
            <div key={i} className={`h-3 w-3 rounded-[3px] ${cls}`} />
          ))}
          <span>{t("insights.heatmap.more")}</span>
        </div>
      </div>
    </div>
  );
}
