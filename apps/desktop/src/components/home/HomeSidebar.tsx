import React, { useState } from "react";
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
import { cn } from "../lib/utils";

interface NavItem {
  id: string;
  labelKey: string;
  Icon: React.ComponentType<{ size?: number | string; className?: string }>;
}

const PRIMARY_NAV: NavItem[] = [
  { id: "home", labelKey: "home.sidebar.home", Icon: LayoutGrid },
  { id: "dictionary", labelKey: "home.sidebar.dictionary", Icon: BookText },
  { id: "snippets", labelKey: "home.sidebar.snippets", Icon: Scissors },
  { id: "style", labelKey: "home.sidebar.style", Icon: Type },
  { id: "notes", labelKey: "home.sidebar.notes", Icon: StickyNote },
];

const FOOTER_NAV: NavItem[] = [
  { id: "invite", labelKey: "home.sidebar.inviteTeam", Icon: Users },
  { id: "free-month", labelKey: "home.sidebar.freeMonth", Icon: Gift },
  { id: "settings", labelKey: "home.sidebar.settings", Icon: Settings },
  { id: "help", labelKey: "home.sidebar.help", Icon: HelpCircle },
];

/** Small equalizer/waveform brand mark (matches the "waveform/bar icon" spec). */
function WaveformMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
      className="text-[#1F1F1F]"
    >
      <rect x="2" y="6" width="2" height="6" rx="1" fill="currentColor" />
      <rect x="6" y="2.5" width="2" height="13" rx="1" fill="currentColor" />
      <rect x="10" y="4.5" width="2" height="9" rx="1" fill="currentColor" />
      <rect x="14" y="7" width="2" height="4" rx="1" fill="currentColor" />
    </svg>
  );
}

function NavRow({
  item,
  active,
  muted,
  onClick,
}: {
  item: NavItem;
  active?: boolean;
  muted?: boolean;
  onClick?: () => void;
}) {
  const { t } = useTranslation();
  const { Icon } = item;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 w-full h-9 px-3 rounded-lg text-left outline-none",
        "transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[#8B7CF6]/30",
        active
          ? "bg-[#E8E7E4] text-[#1F1F1F]"
          : cn(
              "hover:bg-black/[0.04] active:bg-black/[0.06]",
              muted ? "text-neutral-500" : "text-neutral-600"
            )
      )}
    >
      <Icon
        size={18}
        className={cn(
          "shrink-0 transition-colors duration-150",
          active ? "text-[#1F1F1F]" : "text-neutral-500 group-hover:text-neutral-700"
        )}
      />
      <span className="text-[13px] font-medium leading-none">{t(item.labelKey)}</span>
    </button>
  );
}

export default function HomeSidebar() {
  const [activeId, setActiveId] = useState<string>("home");

  return (
    <aside className="w-64 shrink-0 h-full flex flex-col bg-[#F3F2F0] border-r border-black/[0.06] px-3 py-4 select-none">
      {/* Brand row */}
      <div className="flex items-center gap-2 px-2 mb-6">
        <WaveformMark />
        <span className="text-[15px] font-semibold tracking-tight text-[#1F1F1F]">Pyper</span>
        <span className="rounded-full bg-[#8B7CF6] px-2 py-0.5 text-[11px] font-semibold leading-none text-white">
          Pro
        </span>
      </div>

      {/* Primary nav */}
      <nav className="flex flex-col gap-1">
        {PRIMARY_NAV.map((item) => (
          <NavRow
            key={item.id}
            item={item}
            active={activeId === item.id}
            onClick={() => setActiveId(item.id)}
          />
        ))}
      </nav>

      <div className="flex-1" />

      {/* Footer nav */}
      <nav className="flex flex-col gap-1">
        {FOOTER_NAV.map((item) => (
          <NavRow key={item.id} item={item} muted />
        ))}
      </nav>
    </aside>
  );
}
