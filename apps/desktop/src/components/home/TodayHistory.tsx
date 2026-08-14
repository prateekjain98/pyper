import React from "react";
import { useTranslation } from "react-i18next";
import type { DictationEntry } from "./homeMockData";

interface TodayHistoryProps {
  entries: DictationEntry[];
}

export default function TodayHistory({ entries }: TodayHistoryProps) {
  const { t } = useTranslation();

  return (
    <section className="mt-8">
      <div className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
        {t("home.sections.today")}
      </div>

      {entries.length === 0 ? (
        <p className="mt-4 px-1 text-[14px] text-neutral-400">{t("home.history.empty")}</p>
      ) : (
        <ul className="mt-1">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-start gap-4 min-h-[64px] py-4 border-b border-[#EEEEEE]"
            >
              <span className="w-16 shrink-0 pt-0.5 text-[14px] text-neutral-400 tabular-nums">
                {entry.time}
              </span>
              <span className="flex-1 text-[15px] leading-relaxed text-[#1F1F1F] break-words">
                {entry.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
