import React from "react";
import {
  LayoutGrid,
  BookText,
  Scissors,
  Type,
  StickyNote,
  Users,
  Gift,
  Settings,
  HelpCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import logoIcon from "../../assets/icon.png";
import { cn } from "../lib/utils";
import SupportDropdown from "../ui/SupportDropdown";
import type { ControlPanelView } from "../ControlPanelSidebar";
import type { UpsellDecision } from "../../lib/upsell";

interface HomeSidebarProps {
  activeView?: ControlPanelView;
  onViewChange?: (view: ControlPanelView) => void;
  onOpenSettings?: () => void;
  onOpenReferrals?: () => void;
  updateAction?: React.ReactNode;
  // Accepted for drop-in compatibility with ControlPanelSidebar's call site but
  // unused by the Wispr layout: search is ⌘K, and account / upgrade move off the
  // sidebar (the design surfaces them in the top bar instead).
  onOpenSearch?: () => void;
  onUpgrade?: () => void;
  onSignIn?: () => void;
  isOverLimit?: boolean;
  userName?: string | null;
  userEmail?: string | null;
  userImage?: string | null;
  isSignedIn?: boolean;
  authLoaded?: boolean;
  upsell?: UpsellDecision;
}

// `view` is the real ControlPanel view a row navigates to; `null` marks a design
// item that has no backing feature yet, so it renders but doesn't navigate.
interface NavItem {
  labelKey: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  view: ControlPanelView | null;
}

const PRIMARY_NAV: NavItem[] = [
  { labelKey: "home.sidebar.home", Icon: LayoutGrid, view: "home" },
  { labelKey: "home.sidebar.dictionary", Icon: BookText, view: "dictionary" },
  { labelKey: "home.sidebar.snippets", Icon: Scissors, view: null },
  { labelKey: "home.sidebar.style", Icon: Type, view: null },
  { labelKey: "home.sidebar.notes", Icon: StickyNote, view: "personal-notes" },
];

function NavRow({
  labelKey,
  Icon,
  active,
  muted,
  onClick,
}: {
  labelKey: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  active?: boolean;
  muted?: boolean;
  onClick?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-2.5 w-full p-2.5 rounded-lg text-left outline-none",
        "transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary/30",
        active
          ? "bg-[#e8e6e9] dark:bg-white/10"
          : "hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
      )}
    >
      <Icon
        size={16}
        className={cn(
          "shrink-0",
          muted ? "text-[#747076] dark:text-white/50" : "text-[#403c44] dark:text-white/70"
        )}
      />
      <span
        className={cn(
          "text-[15px] tracking-[-0.3px] whitespace-nowrap",
          muted
            ? "font-medium text-[#5a555c] dark:text-white/60"
            : "font-semibold text-[#2b2830] dark:text-white/90"
        )}
      >
        {t(labelKey)}
      </span>
    </button>
  );
}

/**
 * Wispr Flow-style primary sidebar, pixel-matched to the Figma design but using
 * Pyper's real app icon and brand. Drop-in replacement for ControlPanelSidebar:
 * it accepts the same props, wires the rows that map to real views (Home →
 * home, Dictionary → dictionary, Notes → personal-notes, plus Settings, Help,
 * and referrals), and keeps the in-app update button. Snippets / Style are
 * shown per the design but have no backing feature yet, so they don't navigate.
 */
export default function HomeSidebar({
  activeView = "home",
  onViewChange,
  onOpenSettings,
  onOpenReferrals,
  updateAction,
}: HomeSidebarProps) {
  const { t } = useTranslation();

  return (
    <aside className="w-48 h-full shrink-0 flex flex-col bg-[#f7f6f9] dark:bg-[#17171a] border-r border-black/[0.06] dark:border-white/10 select-none">
      {/* Drag region — macOS window controls sit here */}
      <div className="h-10 shrink-0" style={{ WebkitAppRegion: "drag" } as React.CSSProperties} />

      <div className="flex-1 flex flex-col min-h-0 px-2.5 pb-2.5">
        {/* Brand — Pyper's real app icon + Pro badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-2">
          <img src={logoIcon} alt="" className="w-[25px] h-[25px] rounded-md shrink-0" />
          <span className="text-[17px] font-semibold tracking-[-0.4px] text-[#2b2830] dark:text-white">
            Pyper
          </span>
          <span className="rounded-md bg-[#977dff] px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
            Pro
          </span>
        </div>

        {/* Primary navigation */}
        <nav className="flex flex-col gap-[5px] mt-2">
          {PRIMARY_NAV.map((item) => (
            <NavRow
              key={item.labelKey}
              labelKey={item.labelKey}
              Icon={item.Icon}
              active={item.view != null && activeView === item.view}
              onClick={item.view ? () => onViewChange?.(item.view as ControlPanelView) : undefined}
            />
          ))}
        </nav>

        <div className="flex-1" />

        {/* Footer navigation */}
        <nav className="flex flex-col gap-[5px]">
          <NavRow
            labelKey="home.sidebar.inviteTeam"
            Icon={Users}
            muted
            onClick={onOpenReferrals}
          />
          <NavRow labelKey="home.sidebar.freeMonth" Icon={Gift} muted onClick={onOpenReferrals} />
          <NavRow labelKey="home.sidebar.settings" Icon={Settings} muted onClick={onOpenSettings} />
          <SupportDropdown
            trigger={
              <button
                type="button"
                aria-label={t("home.sidebar.help")}
                className="group flex items-center gap-2.5 w-full p-2.5 rounded-lg text-left outline-none transition-colors duration-150 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <HelpCircle size={16} className="shrink-0 text-[#747076] dark:text-white/50" />
                <span className="text-[15px] tracking-[-0.3px] font-medium text-[#5a555c] dark:text-white/60">
                  {t("home.sidebar.help")}
                </span>
              </button>
            }
          />
        </nav>

        {updateAction && (
          <div
            className="pt-1.5"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            {updateAction}
          </div>
        )}
      </div>
    </aside>
  );
}
