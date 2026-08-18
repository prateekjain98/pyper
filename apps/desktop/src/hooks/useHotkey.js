import { useSettingsStore } from "../stores/settingsStore";
import { getDefaultHotkey } from "../utils/hotkeys";

export const useHotkey = () => {
  // Prefer the hotkeys the main process actually registered over the stored
  // preference (they diverge on partial registration and DE-native backends).
  const storedHotkey = useSettingsStore((s) => s.activeDictationKey || s.dictationKey);
  // OFF is a real state, distinct from "never configured": when the user turns
  // the shortcut off both keys are empty, and falling back to the platform
  // default here is what made the orb/tooltip advertise a Globe/fn key that
  // could never fire. Callers must render `isDisabled` honestly instead.
  const isDisabled = useSettingsStore((s) => s.dictationHotkeyDisabled);
  const hotkey = isDisabled ? "" : storedHotkey || getDefaultHotkey();
  const setHotkey = useSettingsStore((s) => s.setDictationKey);

  return {
    hotkey,
    isDisabled,
    setHotkey,
  };
};
