import React from "react";
import {
  LayoutGrid,
  Sparkles,
  StickyNote,
  BookText,
  Scissors,
  BarChart3,
  MessageSquare,
  Upload,
  Blocks,
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
import { isAgentAllowed, isPolicyActionAllowed } from "../../stores/policyRules";
import { usePolicyStore } from "../../stores/policyStore";

interface HomeSidebarProps {
  activeView?: ControlPanelView;
  onViewChange?: (view: ControlPanelView) => void;
  onOpenSettings?: () => void;
  onOpenReferrals?: () => void;
  /** Navigate to the Dictionary view with the Snippets tab selected. */
  onOpenSnippets?: () => void;
  /** Which Dictionary tab is currently targeted (for active-row highlighting). */
  dictionaryTab?: "dictionary" | "snippets";
  updateAction?: React.ReactNode;
  // Accepted for drop-in compatibility with ControlPanelSidebar's call site but
  // unused by the Wispr layout: search is ⌘K, and account / upgrade live elsewhere.
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

type NavAction = "snippets";

interface NavItem {
  labelKey: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  /** Real ControlPanel view this row navigates to. */
  view?: ControlPanelView;
  /** Special navigation (e.g. deep-link into a tab) instead of a plain view. */
  action?: NavAction;
  /** Policy gate — the row is hidden when the capability is disallowed. */
  gate?: "agent" | "upload";
}

// Every row maps to a real, working Pyper view (nothing is a dead no-op). The
// Wispr design's "Style" item is intentionally omitted — Pyper has no Style
// feature yet, so there's nothing real to point it at.
const PRIMARY_NAV: NavItem[] = [
  { labelKey: "sidebar.home", Icon: LayoutGrid, view: "home" },
  { labelKey: "sidebar.aiNoteTaker", Icon: Sparkles, view: "ai-notetaker" },
  { labelKey: "sidebar.notes", Icon: StickyNote, view: "personal-notes" },
  { labelKey: "sidebar.dictionary", Icon: BookText, view: "dictionary" },
  { labelKey: "home.sidebar.snippets", Icon: Scissors, action: "snippets" },
  { labelKey: "sidebar.insights", Icon: BarChart3, view: "insights" },
  { labelKey: "sidebar.chat", Icon: MessageSquare, view: "chat", gate: "agent" },
  { labelKey: "sidebar.upload", Icon: Upload, view: "upload", gate: "upload" },
  { labelKey: "sidebar.integrations", Icon: Blocks, view: "integrations" },
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
 * Pyper's real app icon/brand and, crucially, wired to the app's real,
 * working views — Home, AI Note-Taker, Notes, Dictionary, Snippets (the
 * Dictionary → Snippets tab), Insights, Chat, Upload, Integrations — so nothing
 * is dropped or dead. Drop-in replacement for ControlPanelSidebar (accepts the
 * same props); keeps the in-app update button and the support menu.
 */
export default function HomeSidebar({
  activeView = "home",
  onViewChange,
  onOpenSettings,
  onOpenReferrals,
  onOpenSnippets,
  dictionaryTab = "dictionary",
  updateAction,
}: HomeSidebarProps) {
  const { t } = useTranslation();
  const agentAllowed = usePolicyStore(isAgentAllowed);
  const policyActionsAllowed = usePolicyStore((state) => isPolicyActionAllowed(state));

  const items = PRIMARY_NAV.filter((item) => {
    if (item.gate === "agent") return agentAllowed;
    if (item.gate === "upload") return policyActionsAllowed;
    return true;
  });

  const isRowActive = (item: NavItem): boolean => {
    if (item.action === "snippets") {
      return activeView === "dictionary" && dictionaryTab === "snippets";
    }
    if (item.view === "dictionary") {
      return activeView === "dictionary" && dictionaryTab !== "snippets";
    }
    return item.view != null && activeView === item.view;
  };

  const handleRowClick = (item: NavItem): (() => void) | undefined => {
    if (item.action === "snippets") return onOpenSnippets;
    if (item.view) return () => onViewChange?.(item.view as ControlPanelView);
    return undefined;
  };

  return (
    <aside className="w-48 h-full shrink-0 flex flex-col bg-[#f7f6f9] dark:bg-[#17171a] border-r border-black/[0.06] dark:border-white/10 select-none">
      {/* Drag region — macOS window controls sit here */}
      <div className="h-10 shrink-0" style={{ WebkitAppRegion: "drag" } as React.CSSProperties} />

      <div className="flex-1 flex flex-col min-h-0 px-2.5 pb-2.5 overflow-y-auto">
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
        <nav className="flex flex-col gap-[3px] mt-2">
          {items.map((item) => (
            <NavRow
              key={item.labelKey}
              labelKey={item.labelKey}
              Icon={item.Icon}
              active={isRowActive(item)}
              onClick={handleRowClick(item)}
            />
          ))}
        </nav>

        <div className="flex-1" />

        {/* Footer navigation */}
        <nav className="flex flex-col gap-[3px]">
          <NavRow
            labelKey="home.sidebar.inviteTeam"
            Icon={Users}
            muted
            onClick={onOpenReferrals}
          />
          <NavRow labelKey="home.sidebar.freeMonth" Icon={Gift} muted onClick={onOpenReferrals} />
          <NavRow labelKey="sidebar.settings" Icon={Settings} muted onClick={onOpenSettings} />
          <SupportDropdown
            trigger={
              <button
                type="button"
                aria-label={t("sidebar.support")}
                className="group flex items-center gap-2.5 w-full p-2.5 rounded-lg text-left outline-none transition-colors duration-150 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <HelpCircle size={16} className="shrink-0 text-[#747076] dark:text-white/50" />
                <span className="text-[15px] tracking-[-0.3px] font-medium text-[#5a555c] dark:text-white/60">
                  {t("sidebar.support")}
                </span>
              </button>
            }
          />
        </nav>

        {updateAction && (
          <div className="pt-1.5" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            {updateAction}
          </div>
        )}
      </div>
    </aside>
  );
}
