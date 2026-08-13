import React from "react";
import { Bell, CircleUser } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";

interface HomeTopBarProps {
  unreadCount: number;
  notificationsOpen: boolean;
  onToggleNotifications: () => void;
}

export default function HomeTopBar({
  unreadCount,
  notificationsOpen,
  onToggleNotifications,
}: HomeTopBarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-end gap-1 h-14 px-6 shrink-0">
      <button
        type="button"
        onClick={onToggleNotifications}
        aria-label={t("home.topbar.notifications")}
        aria-expanded={notificationsOpen}
        className={cn(
          "relative flex items-center justify-center h-9 w-9 rounded-full outline-none",
          "text-neutral-600 hover:bg-black/[0.05] transition-colors",
          "focus-visible:ring-2 focus-visible:ring-[#8B7CF6]/30",
          notificationsOpen && "bg-black/[0.06]"
        )}
      >
        <Bell size={19} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex min-w-[15px] h-[15px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
            {unreadCount}
          </span>
        )}
      </button>

      <button
        type="button"
        aria-label={t("home.topbar.account")}
        className={cn(
          "flex items-center justify-center h-9 w-9 rounded-full outline-none",
          "text-neutral-400 hover:bg-black/[0.05] transition-colors",
          "focus-visible:ring-2 focus-visible:ring-[#8B7CF6]/30"
        )}
      >
        <CircleUser size={24} strokeWidth={1.75} />
      </button>
    </div>
  );
}
