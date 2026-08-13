import * as React from "react";
import { cn } from "../lib/utils";
import { formatHotkeyTokens } from "../../utils/hotkeys";

interface KeyGlyphsProps {
  /** Electron accelerator string, e.g. "Alt+M" or "GLOBE". */
  hotkey?: string | null;
  className?: string;
  capClassName?: string;
}

/**
 * Renders a hotkey as a row of small key "caps" with real modifier glyphs
 * (⇧ ⌥ ⌘ ⌃ on macOS; spelled-out names on Windows/Linux). Used by the orb
 * command tooltips so shortcuts read the way they do in the OS.
 */
export function KeyGlyphs({ hotkey, className, capClassName }: KeyGlyphsProps) {
  const tokens = React.useMemo(() => formatHotkeyTokens(hotkey), [hotkey]);
  if (tokens.length === 0) return null;

  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {tokens.map((token, i) => (
        <kbd
          key={`${token.label}-${i}`}
          className={cn(
            "inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-[5px] px-1",
            "border border-white/15 bg-white/10 text-white/85",
            "font-sans text-[10px] font-semibold leading-none",
            capClassName
          )}
        >
          {token.glyph ?? token.label}
        </kbd>
      ))}
    </span>
  );
}

export default KeyGlyphs;
