import React, { useState } from "react";
import HomeSidebar from "./HomeSidebar";
import HomeTopBar from "./HomeTopBar";
import WelcomeStats from "./WelcomeStats";
import StyleTipCard from "./StyleTipCard";
import TodayHistory from "./TodayHistory";
import NotificationsPanel from "./NotificationsPanel";
import {
  HOME_NOTIFICATIONS,
  HOME_STATS,
  HOME_USER,
  NOTIFICATION_UNREAD_COUNT,
  STYLE_TIPS,
  TODAY_HISTORY,
} from "./homeMockData";

/**
 * Wispr Flow-style Home dashboard — a self-contained, presentational two-column
 * shell (fixed sidebar + white content area). Reachable in dev via
 * `?home-dashboard=true` (see AppRouter). Mock-data only; no DB/IPC/Convex.
 */
export default function HomeDashboard() {
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const closeNotifications = () => setNotificationsOpen(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F5F5F4] text-[#1F1F1F] antialiased">
      <HomeSidebar />

      <main className="relative flex flex-1 flex-col overflow-hidden bg-white">
        <HomeTopBar
          unreadCount={NOTIFICATION_UNREAD_COUNT}
          notificationsOpen={notificationsOpen}
          onToggleNotifications={() => setNotificationsOpen((open) => !open)}
        />

        {notificationsOpen && (
          <>
            {/* Click-away backdrop */}
            <div
              className="fixed inset-0 z-40"
              aria-hidden="true"
              onClick={closeNotifications}
            />
            <NotificationsPanel
              notifications={HOME_NOTIFICATIONS}
              onClose={closeNotifications}
            />
          </>
        )}

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-8 py-6">
            <WelcomeStats name={HOME_USER.name} stats={HOME_STATS} />
            <StyleTipCard tips={STYLE_TIPS} />
            <TodayHistory entries={TODAY_HISTORY} />
          </div>
        </div>
      </main>
    </div>
  );
}
