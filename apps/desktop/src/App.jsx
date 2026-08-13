import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import "./index.css";
import { useToast } from "./components/ui/useToast";
import { ThinkingOrb } from "./components/ui/thinking-orbs";
import { OrbPillRegion } from "./components/ui/OrbPill";
import { KeyGlyphs } from "./components/ui/KeyGlyphs";
import { useHotkey } from "./hooks/useHotkey";
import { formatHotkeyListLabel } from "./utils/hotkeys";
import { useWindowDrag } from "./hooks/useWindowDrag";
import { useAudioRecording } from "./hooks/useAudioRecording";
import { useSettingsStore } from "./stores/settingsStore";

export default function App() {
  const [isHovered, setIsHovered] = useState(false);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const commandMenuRef = useRef(null);
  const buttonRef = useRef(null);
  const { toast, dismiss, toastCount, toasts, pauseToast, resumeToast } = useToast();
  const { t } = useTranslation();
  const { hotkey } = useHotkey();
  const { isDragging, handleMouseDown, handleMouseUp } = useWindowDrag();

  const [dragStartPos, setDragStartPos] = useState(null);
  const [hasDragged, setHasDragged] = useState(false);

  // Floating icon auto-hide setting (read from store, synced via IPC)
  const floatingIconAutoHide = useSettingsStore((s) => s.floatingIconAutoHide);
  const panelStartPosition = useSettingsStore((s) => s.panelStartPosition);
  const prevAutoHideRef = useRef(floatingIconAutoHide);

  // Secondary command hotkeys — only surfaced in the command menu when the user
  // has actually configured them (never invented).
  const meetingKey = useSettingsStore((s) => s.meetingKey);
  const voiceAgentKey = useSettingsStore((s) => s.voiceAgentKey);
  const translationKey = useSettingsStore((s) => s.translationKey);

  const setWindowInteractivity = React.useCallback((shouldCapture) => {
    window.electronAPI?.setMainWindowInteractivity?.(shouldCapture);
  }, []);

  useEffect(() => {
    setWindowInteractivity(false);
    return () => setWindowInteractivity(false);
  }, [setWindowInteractivity]);

  // When a free drag snaps the pill to a fixed corner (Wispr-style), follow it in
  // the store so the in-window anchor + Settings match, and it gets persisted.
  useEffect(() => {
    const off = window.electronAPI?.onPanelStartPositionSnapped?.((position) => {
      useSettingsStore.getState().setPanelStartPosition(position);
    });
    return typeof off === "function" ? off : undefined;
  }, []);

  useEffect(() => {
    const unsubscribeFallback = window.electronAPI?.onHotkeyFallbackUsed?.((data) => {
      toast({
        title: t("app.toasts.hotkeyChanged.title"),
        description: t("app.toasts.hotkeyChanged.description", {
          original: data.original,
          fallback: data.fallback,
        }),
        duration: 8000,
      });
    });

    const unsubscribeFailed = window.electronAPI?.onHotkeyRegistrationFailed?.((_data) => {
      toast({
        title: t("app.toasts.hotkeyUnavailable.title"),
        description: t("app.toasts.hotkeyUnavailable.description"),
        duration: 10000,
      });
    });

    const showGpuFallbackToast = () => {
      toast({
        title: t("app.toasts.gpuFallback.title"),
        description: t("app.toasts.gpuFallback.description"),
        duration: 10000,
      });
    };
    const unsubscribeCudaFallback =
      window.electronAPI?.onCudaFallbackNotification?.(showGpuFallbackToast);
    const unsubscribeGpuFallback =
      window.electronAPI?.onGpuFallbackNotification?.(showGpuFallbackToast);

    const unsubscribeCorrections = window.electronAPI?.onCorrectionsLearned?.((words) => {
      if (words && words.length > 0) {
        const wordList = words.map((w) => `\u201c${w}\u201d`).join(", ");
        let toastId;
        toastId = toast({
          title: t("app.toasts.addedToDict", { words: wordList }),
          variant: "success",
          duration: 6000,
          action: (
            <button
              onClick={async () => {
                try {
                  const result = await window.electronAPI?.undoLearnedCorrections?.(words);
                  if (result?.success) {
                    dismiss(toastId);
                  }
                } catch {
                  // silently fail — word stays in dictionary
                }
              }}
              className="text-[10px] font-medium px-2.5 py-1 rounded-sm whitespace-nowrap
                text-emerald-100/90 hover:text-white
                bg-emerald-500/15 hover:bg-emerald-500/25
                border border-emerald-400/20 hover:border-emerald-400/35
                transition-all duration-150"
            >
              {t("app.toasts.undo")}
            </button>
          ),
        });
      }
    });

    return () => {
      unsubscribeFallback?.();
      unsubscribeFailed?.();
      unsubscribeCudaFallback?.();
      unsubscribeGpuFallback?.();
      unsubscribeCorrections?.();
    };
  }, [toast, dismiss, t]);

  useEffect(() => {
    if (isCommandMenuOpen || toastCount > 0) {
      setWindowInteractivity(true);
    } else if (!isHovered) {
      setWindowInteractivity(false);
    }
  }, [isCommandMenuOpen, isHovered, toastCount, setWindowInteractivity]);

  const handleDictationToggle = React.useCallback(() => {
    setIsCommandMenuOpen(false);
    setWindowInteractivity(false);
  }, [setWindowInteractivity]);

  const {
    isRecording,
    isProcessing,
    micCaptureStatus,
    toggleListening,
    cancelRecording,
    cancelProcessing,
  } = useAudioRecording(toast, {
    onToggle: handleDictationToggle,
  });

  // Sync auto-hide from main process — setState directly to avoid IPC echo
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onFloatingIconAutoHideChanged?.((enabled) => {
      localStorage.setItem("floatingIconAutoHide", String(enabled));
      useSettingsStore.setState({ floatingIconAutoHide: enabled });
    });
    return () => unsubscribe?.();
  }, []);

  const isRecordingRef = useRef(isRecording);

  useLayoutEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onCancelHotkeyPressed?.(() => {
      if (isRecordingRef.current) cancelRecording();
    });
    return () => unsubscribe?.();
  }, [cancelRecording]);

  // Auto-hide the floating icon when idle (setting enabled or dictation cycle completed)
  useEffect(() => {
    let hideTimeout;

    if (floatingIconAutoHide && !isRecording && !isProcessing && toastCount === 0) {
      // Delay briefly so processing can start after recording stops without a flash
      hideTimeout = setTimeout(() => {
        window.electronAPI?.hideWindow?.();
      }, 500);
    } else if (!floatingIconAutoHide && prevAutoHideRef.current) {
      window.electronAPI?.showDictationPanel?.();
    }

    prevAutoHideRef.current = floatingIconAutoHide;
    return () => clearTimeout(hideTimeout);
  }, [isRecording, isProcessing, floatingIconAutoHide, toastCount]);

  const handleClose = () => {
    window.electronAPI.hideWindow();
  };

  useEffect(() => {
    if (!isCommandMenuOpen) {
      return;
    }

    const handleClickOutside = (event) => {
      if (
        commandMenuRef.current &&
        !commandMenuRef.current.contains(event.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target)
      ) {
        setIsCommandMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isCommandMenuOpen]);

  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === "Escape") {
        if (isCommandMenuOpen) {
          setIsCommandMenuOpen(false);
        } else {
          handleClose();
        }
      }
    };

    document.addEventListener("keydown", handleKeyPress);
    return () => document.removeEventListener("keydown", handleKeyPress);
  }, [isCommandMenuOpen]);

  // Determine current mic state
  const getMicState = () => {
    if (isRecording && (micCaptureStatus === "reconnecting" || micCaptureStatus === "unavailable"))
      return "unavailable";
    if (isRecording) return "recording";
    if (isProcessing) return "processing";
    if (isHovered && !isRecording && !isProcessing) return "hover";
    return "idle";
  };

  const micState = getMicState();

  const getMicButtonProps = () => {
    const baseClasses =
      "rounded-full w-14 h-14 flex items-center justify-center relative overflow-hidden border-2 border-white/70 cursor-pointer";

    switch (micState) {
      case "idle":
      case "hover":
        return {
          className: `${baseClasses} bg-neutral-900/90 cursor-pointer`,
          tooltip: formatHotkeyListLabel(hotkey),
        };
      case "recording":
        return {
          // Dark "thinking-orb pill" look (matches the reference status pill).
          className: `${baseClasses} bg-neutral-900/90 cursor-pointer`,
          tooltip: t("app.mic.recording"),
        };
      case "unavailable":
        return {
          className: `${baseClasses} bg-amber-500 cursor-pointer`,
          tooltip: t("app.mic.waitingForMicrophone"),
        };
      case "processing":
        return {
          // Dark "thinking-orb pill" look (matches the reference status pill).
          className: `${baseClasses} bg-neutral-900/90 cursor-not-allowed`,
          tooltip: t("app.mic.processing"),
        };
      default:
        return {
          className: `${baseClasses} bg-neutral-900/90 cursor-pointer`,
          style: { transform: "scale(0.8)" },
          tooltip: t("app.mic.clickToSpeak"),
        };
    }
  };

  const micProps = getMicButtonProps();

  // Siri-style: the pill defaults to the TOP-right of the work area. The legacy
  // bottom anchors still work; the overlay window itself is placed to match in
  // windowConfig/windowManager, so the in-window anchor here must agree with it.
  const isTopPosition = panelStartPosition === "top-right" || panelStartPosition === "top-left";
  const isLeftPosition = panelStartPosition === "top-left" || panelStartPosition === "bottom-left";
  const isCenterPosition = panelStartPosition === "center";
  const panelContainerClasses = [
    "fixed z-50",
    isTopPosition ? "top-1" : "bottom-1",
    isLeftPosition ? "left-1" : isCenterPosition ? "left-1/2 -translate-x-1/2" : "right-1",
  ].join(" ");

  // Which side the orb caps, and therefore which way the message pill erupts:
  // pinned RIGHT → orb is the right cap, body grows LEFT (inward); pinned LEFT
  // or bottom-center → orb is the left cap, body grows RIGHT (inward).
  const isRightCap = !isLeftPosition && !isCenterPosition;
  const orbSide = isRightCap ? "right" : "left";
  const verticalAnchor = isTopPosition ? "top" : "bottom";

  const menuPlacement = [
    "absolute w-56",
    isTopPosition ? "top-full mt-3" : "bottom-full mb-3",
    isCenterPosition ? "left-1/2 -translate-x-1/2" : isLeftPosition ? "left-0" : "right-0",
  ].join(" ");

  // Resize the overlay window to fit whatever the orb is currently showing. It
  // stays anchored at its corner (windowManager.resizeMainWindow) and only ever
  // grows inward, so the orb never moves.
  const hasStatus =
    micState === "recording" || micState === "processing" || micState === "unavailable";
  const hasHint = micState === "hover";
  useEffect(() => {
    let sizeKey = "BASE";
    if (isCommandMenuOpen && (toastCount > 0 || hasStatus)) sizeKey = "EXPANDED";
    else if (isCommandMenuOpen) sizeKey = "WITH_MENU";
    else if (toastCount > 0) sizeKey = "WITH_TOAST";
    else if (hasStatus || hasHint) sizeKey = "WITH_HINT";
    window.electronAPI?.resizeMainWindow?.(sizeKey);
  }, [isCommandMenuOpen, toastCount, hasStatus, hasHint]);

  // The single inward "body" of the orb pill. Priority: notifications (errors)
  // first, then live dictation status, then the hover command hint. The newest
  // toast becomes the orb-capped primary; any older ones stack inward.
  const cancelLabels = {
    recording: t("app.buttons.cancelRecording"),
    processing: t("app.buttons.cancelProcessing"),
  };
  let primaryContent = null;
  let secondaryToasts = [];
  if (toasts.length > 0) {
    primaryContent = { kind: "toast", toast: toasts[toasts.length - 1] };
    secondaryToasts = toasts.slice(0, -1).reverse().slice(0, 2);
  } else if (micState === "unavailable") {
    primaryContent = {
      kind: "status",
      tone: "info",
      live: true,
      text: t("app.mic.waitingForMicrophone"),
      onCancel: cancelRecording,
      cancelLabel: cancelLabels.recording,
    };
  } else if (micState === "recording") {
    primaryContent = {
      kind: "status",
      tone: "destructive",
      live: true,
      text: t("app.mic.recording"),
      onCancel: cancelRecording,
      cancelLabel: cancelLabels.recording,
    };
  } else if (micState === "processing") {
    primaryContent = {
      kind: "status",
      tone: "info",
      live: true,
      text: t("app.mic.processing"),
      onCancel: cancelProcessing,
      cancelLabel: cancelLabels.processing,
    };
  } else if (micState === "hover" && !isCommandMenuOpen) {
    primaryContent = {
      kind: "command",
      label: t("app.commandMenu.startListening"),
      hotkey,
      onActivate: () => {
        setWindowInteractivity(true);
        setIsCommandMenuOpen(true);
      },
    };
  }

  // Secondary command hotkeys the user has actually configured — surfaced in the
  // command menu as reference (name + real key glyphs), never invented.
  const secondaryCommands = [
    { key: meetingKey, label: t("settingsPage.general.meetingHotkey.title") },
    { key: voiceAgentKey, label: t("settingsPage.general.voiceAgentHotkey.title") },
    { key: translationKey, label: t("settingsPage.general.translationHotkey.title") },
  ].filter((c) => typeof c.key === "string" && c.key.trim() !== "");

  return (
    <div className="dictation-window">
      {/* Voice button — position follows panelStartPosition (top-right by default) */}
      <div className={panelContainerClasses}>
        <div
          className="relative flex items-center"
          onMouseEnter={() => {
            setIsHovered(true);
            setWindowInteractivity(true);
          }}
          onMouseLeave={() => {
            setIsHovered(false);
            if (!isCommandMenuOpen) {
              setWindowInteractivity(false);
            }
          }}
        >
          {/* Orb — the fixed edge-side cap of the pill. Kept above the message
              body (z-10) so it reads as the rounded cap the body erupts from.
              Cancelling a recording/processing run now lives inside the status
              pill (see OrbPillRegion), so there is no separate cancel button. */}
          <div className="relative z-10">
            <button
              ref={buttonRef}
              onMouseDown={(e) => {
                setIsCommandMenuOpen(false);
                setDragStartPos({ x: e.clientX, y: e.clientY });
                setHasDragged(false);
                handleMouseDown(e);
              }}
              onMouseMove={(e) => {
                if (dragStartPos && !hasDragged) {
                  const distance = Math.sqrt(
                    Math.pow(e.clientX - dragStartPos.x, 2) +
                      Math.pow(e.clientY - dragStartPos.y, 2)
                  );
                  if (distance > 5) {
                    // 5px threshold for drag
                    setHasDragged(true);
                  }
                }
              }}
              onMouseUp={(e) => {
                handleMouseUp(e);
                setDragStartPos(null);
              }}
              onClick={(e) => {
                if (!hasDragged) {
                  setIsCommandMenuOpen(false);
                  toggleListening();
                }
                e.preventDefault();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!hasDragged) {
                  setWindowInteractivity(true);
                  setIsCommandMenuOpen((prev) => !prev);
                }
              }}
              onFocus={() => setIsHovered(true)}
              onBlur={() => setIsHovered(false)}
              className={micProps.className}
              style={{
                ...micProps.style,
                cursor:
                  micState === "processing"
                    ? "not-allowed !important"
                    : isDragging
                      ? "grabbing !important"
                      : "pointer !important",
                transition:
                  "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.25s ease-out",
              }}
            >
              {/* Background effects */}
              <div
                className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent transition-opacity duration-150"
                style={{ opacity: micState === "hover" ? 0.8 : 0 }}
              ></div>
              <div
                className="absolute inset-0 transition-colors duration-150"
                style={{
                  backgroundColor: micState === "hover" ? "rgba(0,0,0,0.1)" : "transparent",
                }}
              ></div>

              {/* The ThinkingOrb is the single live indicator across every state
                  (mirrors apps/web/app/demo): `breathing` when idle — frozen via
                  `paused` so an always-on overlay doesn't animate on battery —
                  `searching` on hover, `listening` while recording, `working`
                  while the transcript is processed. */}
              {micState === "unavailable" ? (
                <span className="text-white text-base font-bold">!</span>
              ) : (
                <span className="flex items-center justify-center [&_canvas]:!size-12">
                  <ThinkingOrb
                    state={
                      micState === "recording"
                        ? "listening"
                        : micState === "processing"
                          ? "working"
                          : micState === "hover"
                            ? "searching"
                            : "breathing"
                    }
                    size={64}
                    theme="dark"
                    paused={micState === "idle"}
                  />
                </span>
              )}

              {/* State indicator ring for recording */}
              {micState === "recording" && (
                <div className="absolute inset-0 rounded-full border-2 border-primary/50 animate-pulse"></div>
              )}
              {micState === "unavailable" && (
                <div className="absolute inset-0 rounded-full border-2 border-amber-200/70 animate-pulse"></div>
              )}

              {/* State indicator ring for processing */}
              {micState === "processing" && (
                <div className="absolute inset-0 rounded-full border-2 border-primary/30 opacity-50"></div>
              )}
            </button>
          </div>

          {/* The single horizontal message pill that erupts out of the orb —
              notifications, live status, and the hover command hint all render
              here, position-aware (grows away from the screen edge). */}
          <OrbPillRegion
            orbSide={orbSide}
            verticalAnchor={verticalAnchor}
            primary={primaryContent}
            secondary={secondaryToasts}
            onDismiss={dismiss}
            onPauseToast={pauseToast}
            onResumeToast={resumeToast}
          />

          {isCommandMenuOpen && (
            <div
              ref={commandMenuRef}
              className={`${menuPlacement} z-20 overflow-hidden rounded-xl toast-surface text-white`}
              onMouseEnter={() => {
                setWindowInteractivity(true);
              }}
              onMouseLeave={() => {
                if (!isHovered) {
                  setWindowInteractivity(false);
                }
              }}
            >
              <button
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] font-medium text-white/90 hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                onClick={() => {
                  toggleListening();
                }}
              >
                <span className="truncate">
                  {isRecording
                    ? t("app.commandMenu.stopListening")
                    : t("app.commandMenu.startListening")}
                </span>
                <KeyGlyphs hotkey={hotkey} className="shrink-0" />
              </button>

              {secondaryCommands.length > 0 && (
                <>
                  <div className="h-px bg-white/10" />
                  {secondaryCommands.map((cmd) => (
                    <div
                      key={cmd.label}
                      className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[12px] text-white/55"
                    >
                      <span className="truncate">{cmd.label}</span>
                      <KeyGlyphs hotkey={cmd.key} className="shrink-0" />
                    </div>
                  ))}
                </>
              )}

              <div className="h-px bg-white/10" />
              <button
                className="w-full px-3 py-2 text-left text-[13px] text-white/70 hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                onClick={() => {
                  setIsCommandMenuOpen(false);
                  setWindowInteractivity(false);
                  handleClose();
                }}
              >
                {t("app.commandMenu.hideForNow")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
