import React from "react";
import { Award, Filter, MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { HomeNotification } from "./homeMockData";

interface NotificationsPanelProps {
  notifications: HomeNotification[];
  onClose: () => void;
}

export default function NotificationsPanel({ notifications }: NotificationsPanelProps) {
  const { t } = useTranslation();

  return (
    <div
      role="dialog"
      aria-label={t("home.notifications.title")}
      className="absolute right-6 top-[52px] z-50 w-[500px] max-w-[calc(100vw-3rem)] rounded-xl border border-black/[0.08] bg-white shadow-xl overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-black/[0.06]">
        <span className="text-[15px] font-semibold text-[#1F1F1F]">
          {t("home.notifications.title")}
        </span>
        <div className="flex items-center gap-1 text-neutral-400">
          <button
            type="button"
            aria-label={t("home.notifications.filter")}
            className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-black/[0.05] hover:text-neutral-600 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#8B7CF6]/30"
          >
            <Filter size={16} />
          </button>
          <button
            type="button"
            aria-label={t("home.notifications.more")}
            className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-black/[0.05] hover:text-neutral-600 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#8B7CF6]/30"
          >
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      <ul className="max-h-[60vh] overflow-y-auto py-1">
        {notifications.map((item) => (
          <li key={item.id} className="flex items-start gap-3 px-4 py-3 hover:bg-black/[0.02]">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EFEBFE]">
              <Award size={18} className="text-[#8B7CF6]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold leading-snug text-[#1F1F1F]">
                {t(item.titleKey)}
              </p>
              <p className="mt-0.5 text-[13px] leading-snug text-neutral-500">
                {t(item.subtitleKey)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
