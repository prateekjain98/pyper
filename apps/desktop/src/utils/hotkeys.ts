/**
 * Hotkey utilities for formatting and displaying keyboard shortcuts.
 * Supports both single keys and compound hotkeys (e.g., "CommandOrControl+Shift+K").
 */

import { getPlatform, type Platform } from "./platform.ts";

export function isGlobeLikeHotkey(hotkey: string): boolean {
  return hotkey === "GLOBE" || hotkey === "Fn";
}

/**
 * Parse a comma-separated hotkey list (a legacy single value is a one-item
 * list): trimmed, de-duplicated, empties removed, order preserved. The comma
 * KEY is itself a valid hotkey (e.g. "Control+,"): no accelerator legitimately
 * ends with "+", so a split segment ending in "+" gets its comma restored.
 *
 * Keep in sync with the main-process twin in src/helpers/hotkeyList.js.
 */
export function parseHotkeyList(value?: string | null): string[] {
  // Defensive: the signature says string|null, but a malformed setting or an
  // errant main-process value can surface a non-string at runtime — never let it
  // .split-crash and white-screen the app (callers use `|| getDefaultHotkey()`).
  if (typeof value !== "string" || value === "") return [];
  const raw = value.split(",");
  const seen = new Set<string>();
  const result: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    let hotkey = raw[i].trim();
    if (hotkey.endsWith("+") && i < raw.length - 1 && raw[i + 1].trim() === "") {
      hotkey += ",";
    }
    if (!hotkey || seen.has(hotkey)) continue;
    seen.add(hotkey);
    result.push(hotkey);
  }
  return result;
}

/** Serialize a hotkey list back to the canonical comma-separated string. */
export function serializeHotkeyList(list: string[]): string {
  return parseHotkeyList(list.join(",")).join(",");
}

export function isMouseButtonHotkey(hotkey: string): boolean {
  return /^MouseButton[45]$/i.test(hotkey || "");
}

function formatModifierPart(part: string, platform: Platform): string {
  switch (part) {
    case "CommandOrControl":
      return platform === "darwin" ? "Cmd" : "Ctrl";
    case "Command":
    case "Cmd":
      return "Cmd";
    case "Control":
    case "Ctrl":
      return "Ctrl";
    case "Alt":
      return platform === "darwin" ? "Option" : "Alt";
    case "Option":
      return "Option";
    case "Shift":
      return "Shift";
    case "Super":
    case "Meta":
      return platform === "darwin" ? "Cmd" : platform === "win32" ? "Win" : "Super";
    case "Win":
      return platform === "win32" ? "Win" : "Super";
    case "Fn":
      return "Fn";
    default:
      return part;
  }
}

/**
 * Formats an Electron accelerator string into a user-friendly display label.
 *
 * @param hotkey - The hotkey string in Electron accelerator format
 * @returns User-friendly label (e.g., "Cmd+Shift+K" on macOS, "Ctrl+Shift+K" on Windows)
 *
 * @example
 * formatHotkeyLabel("CommandOrControl+Shift+K") // "Cmd+Shift+K" on macOS, "Ctrl+Shift+K" on Windows
 * formatHotkeyLabel("GLOBE") // "Globe"
 * formatHotkeyLabel("`") // "`"
 * formatHotkeyLabel(null) // platform default
 */
export function formatHotkeyLabel(hotkey?: string | null): string {
  const platform = getPlatform();
  const resolvedHotkey =
    typeof hotkey === "string" && hotkey.trim() !== "" ? hotkey : getDefaultHotkey();
  return formatHotkeyLabelForPlatform(resolvedHotkey, platform);
}

/**
 * Label for a comma-separated hotkey list: entries formatted individually and
 * joined with " / "; empty lists fall back like formatHotkeyLabel.
 */
export function formatHotkeyListLabel(value?: string | null): string {
  const list = parseHotkeyList(value);
  if (list.length === 0) return formatHotkeyLabel(value);
  return list.map((hotkey) => formatHotkeyLabel(hotkey)).join(" / ");
}

export function formatHotkeyLabelForPlatform(hotkey: string, platform: Platform): string {
  if (typeof hotkey !== "string" || hotkey.trim() === "") {
    return "";
  }

  if (isGlobeLikeHotkey(hotkey)) {
    return "Globe/Fn";
  }

  if (isMouseButtonHotkey(hotkey)) {
    return hotkey === "MouseButton4" ? "Mouse Button 4" : "Mouse Button 5";
  }

  // Right-side single modifiers
  const rightSideMap: Record<string, string> = {
    RightOption: platform === "darwin" ? "Right Option" : "Right Alt",
    RightAlt: "Right Alt",
    RightCommand: "Right Cmd",
    RightCmd: "Right Cmd",
    RightControl: "Right Ctrl",
    RightCtrl: "Right Ctrl",
    RightShift: "Right Shift",
    RightSuper: platform === "win32" ? "Right Win" : "Right Super",
    RightMeta:
      platform === "darwin" ? "Right Cmd" : platform === "win32" ? "Right Win" : "Right Super",
    RightWin: "Right Win",
  };
  if (rightSideMap[hotkey]) {
    return rightSideMap[hotkey];
  }

  if (hotkey.includes("+")) {
    const parts = hotkey.split("+");
    const formattedParts = parts.map((part) => formatModifierPart(part, platform));
    return formattedParts.join("+");
  }

  return hotkey;
}

/**
 * A single rendered piece of a hotkey — one key "cap". `glyph` is the compact
 * symbol to show when space is tight (e.g. "⇧"), `label` the readable name
 * (e.g. "Shift"); `glyph` falls back to `label` when there is no symbol.
 */
export interface HotkeyToken {
  glyph?: string;
  label: string;
  isModifier: boolean;
}

// Apple-standard modifier glyphs. Only used on macOS — Windows/Linux keep the
// spelled-out modifier names, which is what users expect there.
const MAC_MODIFIER_GLYPHS: Record<string, string> = {
  Command: "⌘",
  Cmd: "⌘",
  CommandOrControl: "⌘",
  Super: "⌘",
  Meta: "⌘",
  Control: "⌃",
  Ctrl: "⌃",
  Alt: "⌥",
  Option: "⌥",
  Shift: "⇧",
};

// Base (non-modifier) keys that read better as a glyph than their raw name.
const BASE_KEY_GLYPHS: Record<string, string> = {
  " ": "␣",
  Space: "␣",
  Spacebar: "␣",
  Enter: "↵",
  Return: "↵",
  Tab: "⇥",
  Escape: "⎋",
  Esc: "⎋",
  Backspace: "⌫",
  Delete: "⌦",
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

const MODIFIER_NAMES = new Set([
  "Command",
  "Cmd",
  "CommandOrControl",
  "Control",
  "Ctrl",
  "Alt",
  "Option",
  "Shift",
  "Super",
  "Meta",
  "Win",
  "Fn",
]);

function toBaseKeyToken(part: string): HotkeyToken {
  const glyph = BASE_KEY_GLYPHS[part];
  if (glyph) return { glyph, label: part, isModifier: false };
  // Single letters read best uppercased; everything else is shown verbatim.
  const label = part.length === 1 ? part.toUpperCase() : part;
  return { label, isModifier: false };
}

function toHotkeyToken(part: string, platform: Platform): HotkeyToken {
  if (part === "Fn") return { label: "fn", isModifier: true };
  if (MODIFIER_NAMES.has(part)) {
    const label = formatModifierPart(part, platform);
    const glyph = platform === "darwin" ? MAC_MODIFIER_GLYPHS[part] : undefined;
    return { glyph, label, isModifier: true };
  }
  return toBaseKeyToken(part);
}

/**
 * Breaks a hotkey accelerator into display "caps" for rendering with real key
 * glyphs (e.g. `Alt+M` → ⌥ / M on macOS, "Alt" / "M" elsewhere). Falls back to
 * the platform default hotkey for empty input, mirroring {@link formatHotkeyLabel}.
 */
export function formatHotkeyTokens(
  hotkey?: string | null,
  platformOverride?: Platform
): HotkeyToken[] {
  const platform = platformOverride ?? getPlatform();
  const resolved =
    typeof hotkey === "string" && hotkey.trim() !== "" ? hotkey : getDefaultHotkey();

  if (isGlobeLikeHotkey(resolved)) {
    return [{ label: "fn", isModifier: true }];
  }
  if (isMouseButtonHotkey(resolved)) {
    return [{ label: resolved === "MouseButton4" ? "M4" : "M5", isModifier: false }];
  }

  // Right-side single modifiers (e.g. "RightOption") carry no "+" but are still
  // modifiers — show their readable label as one cap.
  if (!resolved.includes("+")) {
    if (MODIFIER_NAMES.has(resolved) || resolved === "Fn") {
      return [toHotkeyToken(resolved, platform)];
    }
    const rightLabel = formatHotkeyLabelForPlatform(resolved, platform);
    if (rightLabel !== resolved) {
      return [{ label: rightLabel, isModifier: true }];
    }
    return [toBaseKeyToken(resolved)];
  }

  return resolved.split("+").map((part) => toHotkeyToken(part, platform));
}

/**
 * Parses a hotkey string to extract modifiers and the base key.
 *
 * @param hotkey - The hotkey string in Electron accelerator format
 * @returns Object with modifiers array and baseKey
 *
 * @example
 * parseHotkey("CommandOrControl+Shift+K")
 * // { modifiers: ["CommandOrControl", "Shift"], baseKey: "K" }
 */
export function parseHotkey(hotkey: string): {
  modifiers: string[];
  baseKey: string;
} {
  if (!hotkey || !hotkey.includes("+")) {
    return { modifiers: [], baseKey: hotkey || "" };
  }

  const parts = hotkey.split("+");
  const baseKey = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);

  return { modifiers, baseKey };
}

/**
 * Checks if a hotkey is a compound hotkey (has modifiers).
 *
 * @param hotkey - The hotkey string
 * @returns True if the hotkey includes modifiers
 */
export function isCompoundHotkey(hotkey: string): boolean {
  return hotkey?.includes("+") || false;
}

/**
 * Gets the default hotkey for the current platform.
 * - macOS: GLOBE key (Fn key on modern Macs)
 * - Windows/Linux: Control+Super (Ctrl+Win / Ctrl+Super)
 */
export function getDefaultHotkey(): string {
  const platform = getPlatform();
  return platform === "darwin" ? "GLOBE" : "Control+Super";
}

/**
 * Validates if a hotkey string is in a valid format.
 * Valid formats include single keys and Electron accelerator strings.
 *
 * @param hotkey - The hotkey string to validate
 * @returns True if the hotkey format is valid
 */
export function isValidHotkeyFormat(hotkey: string): boolean {
  if (typeof hotkey !== "string" || hotkey.trim() === "") {
    return false;
  }

  if (isGlobeLikeHotkey(hotkey) || isMouseButtonHotkey(hotkey)) {
    return true;
  }

  // Single character or word keys are valid
  if (!hotkey.includes("+")) {
    return true;
  }

  // Compound hotkey: must have at least one modifier and one base key
  const parts = hotkey.split("+");
  if (parts.length < 2) {
    return false;
  }

  // Check that all parts are non-empty
  return parts.every((part) => part.trim().length > 0);
}
