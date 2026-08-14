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
  const hoverContainerRef = useRef(null);
  // Bottom-center only: a stable, invisible pad spanning the orb's whole
  // semicircle→risen travel. reconcileHover hit-tests THIS instead of the orb,
  // so lifting the orb on hover never slides the hover zone out from under the
  // cursor — which is what caused the orb to bounce/flicker.
  const centerHitRef = useRef(null);
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

  // Whether an orb drag is in flight — hover reconciliation pauses while true
  // (see reconcileHover). Kept in a ref so the window-level move listener can
  // read it synchronously without re-subscribing.
  const isDraggingRef = useRef(false);
  // Coalesces overlay resizes (see the resize effect). Kept in a ref so rapid
  // hover changes debounce into a single setBounds instead of thrashing.
  const resizeTimerRef = useRef(null);
  const lastSizeKeyRef = useRef(null);

  // Derive hover from the real cursor position over the orb, not from raw
  // mouseenter/mouseleave: hovering flips the transparent overlay to interactive
  // and resizes it (and grows the orb), and those resizes make macOS spray
  // synthetic enter/leave events — each of which would flip hover, which resizes
  // again. Reconciling against the pointer position, with hysteresis, makes that
  // feedback impossible. Paused during a drag so a fast drag that momentarily
  // outruns the window can't drop hover and revoke click-through mid-drag (which
  // would swallow the drag's mouseup).
  const reconcileHover = React.useCallback((screenX, screenY) => {
    if (isDraggingRef.current) return;
    // Hit-test in SCREEN space, not client space. Hovering resizes the overlay,
    // and for a horizontally-centered orb the window grows symmetrically — so the
    // orb's *client* rect jumps by half the width delta (~122px) on every resize,
    // sliding out from under the cursor and bouncing hover on/off forever. Its
    // *screen* position, though, is stable (window-left moves left exactly as the
    // orb moves right in client coords — they cancel). Converting the client rect
    // to screen coords with window.screenX/Y removes the jump, so the feedback
    // loop can't form regardless of anchoring.
    const wx = window.screenX;
    const wy = window.screenY;
    const hit = (rect, slop) =>
      !!rect &&
      screenX >= rect.left + wx - slop &&
      screenX <= rect.right + wx + slop &&
      screenY >= rect.top + wy - slop &&
      screenY <= rect.bottom + wy + slop;
    const onOrb = (slop) =>
      hit((centerHitRef.current ?? buttonRef.current)?.getBoundingClientRect(), slop);
    // Hysteresis is what stops the "jumps while moving": *entering* hover needs
    // the cursor on the orb itself; *staying* hovered also accepts the erupted
    // pill(s). Because the hold zone is always larger than the enter zone, the
    // orb/window resize that hovering triggers can never push the cursor back
    // out of the hold zone and un-hover it — so the hover↔resize feedback loop
    // that caused the flicker can't form. We union each pill's *own* layout rect
    // rather than the container's, because the bottom-center pill visually
    // overflows its container (getBoundingClientRect on the container misses it).
    setIsHovered((prev) => {
      let next;
      if (!prev) next = onOrb(4);
      else if (onOrb(10)) next = true;
      else {
        next = false;
        const root = hoverContainerRef.current;
        if (root) {
          for (const pill of root.querySelectorAll(".toast-surface")) {
            if (hit(pill.getBoundingClientRect(), 8)) {
              next = true;
              break;
            }
          }
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setWindowInteractivity(false);
    return () => setWindowInteractivity(false);
  }, [setWindowInteractivity]);

  // Mirror the drag flag into a ref so reconcileHover can bail synchronously.
  useLayoutEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  // Window-level so it fires in click-through `forward` mode too, and in the
  // capture phase so it can never interfere with the drag handlers. It only
  // reads the cursor position — it never calls preventDefault/stopPropagation.
  useEffect(() => {
    const onMove = (e) => reconcileHover(e.screenX, e.screenY);
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("pointermove", onMove, true);
    return () => {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("pointermove", onMove, true);
    };
  }, [reconcileHover]);

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
    if (isCommandMenuOpen || toastCount > 0 || isHovered) {
      setWindowInteractivity(true);
    } else {
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
    // Size is applied separately (see isCompactCenter) so the bottom-center idle
    // orb can shrink; every other state keeps the full 56px circle.
    const baseClasses =
      "rounded-full flex items-center justify-center relative overflow-hidden border-2 border-white/70 cursor-pointer";

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
  // The window frame reaches the work-area edge (windowConfig MARGIN=0) and is
  // sized with a transparent shadow pad; the orb is inset ~20px (top-5/bottom-5/
  // left-5/right-5) from its anchored edges so the pill's drop-shadow renders in
  // that inset instead of being clipped into a rectangle. Bottom-center lifts the
  // orb to 44px (bottom-11) — Wispr Flow's resting spot, clear of the Dock.
  const panelContainerClasses = [
    "fixed z-50",
    // Bottom-center: push the orb half below the screen edge so it reads as a
    // semicircle at the extreme bottom (-bottom-7 = -28px = half the 56px orb).
    isTopPosition ? "top-5" : isCenterPosition ? "-bottom-7" : "bottom-5",
    // Bottom-center spans the full window width and centers the orb+pill unit with
    // flexbox (justify-center), so as the body reveals to the right the whole unit
    // stays centered and the orb slides left — robust, unlike a shrink-to-fit
    // translate which collapsed and let wide pills clip off the right edge.
    isCenterPosition
      ? "inset-x-0 flex justify-center"
      : isLeftPosition
        ? "left-5"
        : "right-5",
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

  // Wispr-style compact resting pill: at bottom-center, while truly idle (no live
  // status, no toast, no open menu), the orb shrinks to a small, unobtrusive form
  // so it doesn't sit on top of the user's work. Every other position keeps the
  // full 56px circle, and the moment it becomes active — recording, processing,
  // hover, or a message erupts — this flips off and the orb grows back.
  // Bottom-center now stays FULL SIZE always (no compact shrink). Keeping the orb
  // the same size across idle/hover means the window never resizes the orb on
  // hover, so it can't bounce — only the pill grows upward above it.
  const isCompactCenter = false;

  // Bottom-center idle rests as a semicircle peeking at the screen's very bottom
  // (panelContainer -bottom-7). The moment it becomes active — hover, live status,
  // a toast, or the open command menu — the orb rises to a full circle clear of the
  // edge. It's a GPU transform on the orb+pill unit, so it glides up smoothly and
  // the overlay window never resizes vertically (no bounce). On leave it settles
  // back down into the semicircle.
  const centerLifted =
    isCenterPosition && (isHovered || hasStatus || hasHint || toastCount > 0 || isCommandMenuOpen);

  useEffect(() => {
    let sizeKey = "BASE";
    if (isCommandMenuOpen && (toastCount > 0 || hasStatus)) sizeKey = "EXPANDED";
    else if (isCommandMenuOpen) sizeKey = "WITH_MENU";
    else if (toastCount > 0) sizeKey = "WITH_TOAST";
    else if (hasStatus || hasHint) sizeKey = "WITH_HINT";
    else if (isCompactCenter) sizeKey = "COMPACT";
    // Bottom-center: keep idle, hover AND recording on ONE fixed window size
    // (WITH_HINT) so none of those transitions resize the overlay. A resize
    // mid-hover was the bounce: window.screenX and the client rect settle a frame
    // apart, so the screen-space hit-test briefly desynced and dropped hover for a
    // frame → the orb rose then fell → resize back → repeat. With the window held
    // still, hover (and idle→recording) is a pure CSS lift and cannot bounce. Only
    // the genuinely taller states (toast / menu) still resize.
    if (isCenterPosition && (sizeKey === "BASE" || sizeKey === "WITH_HINT")) {
      sizeKey = "WITH_HINT";
    }
    // Debounce + de-dupe the actual resize. Sweeping the cursor across the orb's
    // edge can flip hover several times in a few frames; without this each flip
    // was a setBounds, and every setBounds is a visible size/position jump of the
    // overlay (the reported "jumps while moving"). Coalescing to the settled size
    // and skipping no-op repeats keeps the window still while the pointer moves;
    // the pill still appears within ~1 frame of hover settling.
    clearTimeout(resizeTimerRef.current);
    resizeTimerRef.current = setTimeout(() => {
      if (sizeKey === lastSizeKeyRef.current) return;
      lastSizeKeyRef.current = sizeKey;
      window.electronAPI?.resizeMainWindow?.(sizeKey);
    }, 80);
    return () => clearTimeout(resizeTimerRef.current);
  }, [isCommandMenuOpen, toastCount, hasStatus, hasHint, isCompactCenter, isCenterPosition]);

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
        {/* Hover is derived SOLELY from the window-level mousemove listener
            (reconcileHover, real cursor coords). We deliberately do NOT wire
            onMouseEnter/onMouseLeave here: a window resize on hover makes macOS
            spray SYNTHETIC leave events whose coords are stale/at the window edge,
            and feeding those to reconcileHover dropped hover for a frame — which
            made the bottom-center orb rise then immediately fall (the bounce). */}
        <div ref={hoverContainerRef} className="relative flex items-center">
          {/* Bottom-center: a stable, invisible hover pad spanning the orb's whole
              semicircle→risen travel. reconcileHover hit-tests THIS, so the lift
              never slides the hover zone out from under the cursor — no feedback
              bounce. It's a pure geometry marker (no pointer events, invisible). */}
          {isCenterPosition && (
            <div
              ref={centerHitRef}
              aria-hidden
              className="pointer-events-none absolute bottom-0 left-1/2 h-28 w-20 -translate-x-1/2"
            />
          )}

          {/* Lift wrapper — bottom-center rises the orb+pill from the resting
              semicircle to a full circle whenever active (hover / status / toast /
              menu), as a single smooth ease-out GPU transform. The overlay window
              never resizes vertically, so the rise can't bounce. Other positions
              are a static passthrough. */}
          <div
            className={`relative flex items-center ${
              isCenterPosition
                ? `transition-transform duration-300 ease-out will-change-transform ${
                    centerLifted ? "-translate-y-10" : "translate-y-0"
                  }`
                : ""
            }`}
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
              className={`${micProps.className} ${isCompactCenter ? "h-9 w-9" : "h-14 w-14"}`}
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
                <span
                  className={`flex items-center justify-center ${
                    isCompactCenter ? "[&_canvas]:!size-7" : "[&_canvas]:!size-12"
                  }`}
                >
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
                    paused={false}
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
            centered={isCenterPosition}
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
    </div>
  );
}
