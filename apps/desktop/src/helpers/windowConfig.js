const path = require("path");

const isGnomeWayland =
  process.platform === "linux" &&
  process.env.XDG_SESSION_TYPE === "wayland" &&
  /gnome|ubuntu|unity/i.test(process.env.XDG_CURRENT_DESKTOP || "");

const isKDEWayland =
  process.platform === "linux" &&
  process.env.XDG_SESSION_TYPE === "wayland" &&
  /kde/i.test(process.env.XDG_CURRENT_DESKTOP || "");

const MAIN_OVERLAY_TYPE =
  process.platform === "darwin"
    ? "panel"
    : process.platform === "linux"
      ? isGnomeWayland || isKDEWayland
        ? "normal"
        : "toolbar"
      : "normal";

const FLOATING_OVERLAY_TYPE =
  process.platform === "darwin"
    ? "panel"
    : process.platform === "linux"
      ? isKDEWayland
        ? "normal"
        : "toolbar"
      : "normal";

// The overlay window carries a transparent SHADOW-SAFE margin around the orb/pill
// so the pill's `toast-surface` drop-shadow (0 8px 24px -4px … ≈28px of reach)
// renders in full instead of being hard-clipped into a rectangle by a content-
// tight window. Two pieces cooperate:
//   • Every size below is 48px (2 × ~24px shadow pad) larger than the old content-
//     tight size, giving ≥24px of clear space on every INWARD side for the shadow.
//   • The orb is inset ~20px (App.jsx panelContainerClasses) from the window's
//     anchored edge, and MARGIN is 0 (getMainWindowPosition) so the window frame
//     reaches the work-area edge. The anchored-side shadow therefore clips only at
//     the screen edge (natural, invisible), never mid-screen.
// Changing these sizes? Keep the +48 shadow pad, or the clip returns.
//
// The window stays anchored at its screen corner and grows INWARD (see
// windowManager.resizeMainWindow). Status/error messages render as a horizontal
// pill erupting from the orb, so these are WIDE and SHORT rather than tall cards:
//   BASE       — just the orb.
//   WITH_HINT  — orb + a single short status/command pill (Recording…, Dictate ⌘…).
//   WITH_MENU  — orb + the (vertical) right-click command menu.
//   WITH_TOAST — orb + notification pill(s); tall enough for an expanded error
//                and a couple of stacked messages.
//   EXPANDED   — command menu open while a notification pill is showing.
//   COMPACT    — the small, Wispr-style resting orb shown only at bottom-center
//                while idle (App.jsx isCompactCenter); a snugger window so the
//                shrunken orb isn't adrift in a full-size box. No pill ⇒ no
//                shadow, so it needs no shadow pad, only room for the center lift.
const WINDOW_SIZES = {
  BASE: { width: 144, height: 144 },
  WITH_HINT: { width: 388, height: 144 },
  WITH_MENU: { width: 300, height: 328 },
  WITH_TOAST: { width: 508, height: 328 },
  EXPANDED: { width: 508, height: 468 },
  COMPACT: { width: 96, height: 96 },
};

// Main dictation window configuration
const MAIN_WINDOW_CONFIG = {
  width: WINDOW_SIZES.BASE.width,
  height: WINDOW_SIZES.BASE.height,
  title: "Voice Recorder",
  webPreferences: {
    preload: path.join(__dirname, "..", "..", "preload.js"),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
  },
  frame: false,
  alwaysOnTop: true,
  resizable: false,
  transparent: true,
  show: false,
  skipTaskbar: true,
  focusable: false,
  visibleOnAllWorkspaces: process.platform !== "win32",
  fullScreenable: false,
  hasShadow: false,
  acceptFirstMouse: true,
  type: MAIN_OVERLAY_TYPE,
};

// Control panel window configuration
const CONTROL_PANEL_CONFIG = {
  width: 1200,
  height: 800,
  backgroundColor: "#1c1c2e",
  webPreferences: {
    preload: path.join(__dirname, "..", "..", "preload.js"),
    nodeIntegration: false,
    contextIsolation: true,
    // sandbox: false is required because the preload script bridges IPC
    // between the renderer and main process.
    sandbox: false,
    // webSecurity: false disables same-origin policy. Required because in
    // production the renderer loads from a file:// origin but makes
    // cross-origin fetch calls to Better Auth, Gemini, OpenAI, and Groq APIs
    // directly from the browser. These would be blocked by CORS otherwise.
    webSecurity: false,
    spellcheck: false,
    backgroundThrottling: false,
  },
  title: "Control Panel",
  resizable: true,
  show: false,
  frame: false,
  ...(process.platform === "darwin" && {
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 20, y: 20 },
  }),
  transparent: false,
  minimizable: true,
  maximizable: true,
  closable: true,
  fullscreenable: true,
  skipTaskbar: false,
  alwaysOnTop: false,
  visibleOnAllWorkspaces: false,
  type: "normal",
};

const NOTIFICATION_WINDOW_CONFIG = {
  width: 392,
  height: 92,
  frame: false,
  transparent: true,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  focusable: false,
  hasShadow: false,
  show: false,
  webPreferences: {
    preload: path.join(__dirname, "..", "..", "preload.js"),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
  },
  visibleOnAllWorkspaces: process.platform !== "win32",
  type: FLOATING_OVERLAY_TYPE,
};

// Full-screen, transparent, click-through overlay shown while the dictation pill
// is being dragged (Wispr-style): it dims the display the pill is on and marks
// the fixed snap targets. Sized to the active display at show time; the small
// default here is replaced by setBounds. It must never take focus or capture the
// pointer — the drag's mouse capture belongs to the pill window.
const DRAG_OVERLAY_CONFIG = {
  width: 800,
  height: 600,
  frame: false,
  transparent: true,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  movable: false,
  focusable: false,
  hasShadow: false,
  show: false,
  fullscreenable: false,
  acceptFirstMouse: false,
  enableLargerThanScreen: true,
  webPreferences: {
    preload: path.join(__dirname, "..", "..", "preload.js"),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    backgroundThrottling: false,
  },
  visibleOnAllWorkspaces: process.platform !== "win32",
  type: FLOATING_OVERLAY_TYPE,
};

// The pill can rest only at these fixed positions. `center` is bottom-center
// (Wispr Flow's default placement). Shared by the drag overlay's target markers
// and the snap-on-drop logic so both agree on exactly the same five spots.
const FIXED_PANEL_POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right", "center"];

const TRANSCRIPTION_PREVIEW_SIZE_LIMITS = {
  minWidth: 400,
  defaultWidth: 460,
  maxWidth: 640,
  minHeight: 96,
  defaultHeight: 132,
  maxHeight: 520,
};

const TRANSCRIPTION_PREVIEW_CONFIG = {
  width: TRANSCRIPTION_PREVIEW_SIZE_LIMITS.defaultWidth,
  height: TRANSCRIPTION_PREVIEW_SIZE_LIMITS.defaultHeight,
  frame: false,
  transparent: true,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  focusable: false,
  hasShadow: false,
  show: false,
  acceptFirstMouse: true,
  webPreferences: {
    preload: path.join(__dirname, "..", "..", "preload.js"),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
  },
  visibleOnAllWorkspaces: process.platform !== "win32",
  type: FLOATING_OVERLAY_TYPE,
};

class WindowPositionUtil {
  static getMainWindowPosition(display, customSize = null, position = "top-right") {
    const { width, height } = customSize || WINDOW_SIZES.BASE;
    // The window frame reaches the work-area edge (MARGIN 0); the orb's Siri-style
    // gap from the edge comes from ORB_INSET in the renderer (App.jsx), inside the
    // frame, so the pill's drop-shadow fills that transparent inset and only clips
    // at the screen edge — never mid-screen as a hard rectangle.
    const MARGIN = 0;
    const workArea = display.workArea || display.bounds;

    let x, y;
    if (position === "bottom-left") {
      x = workArea.x + MARGIN;
      y = workArea.y + workArea.height - height - MARGIN;
    } else if (position === "center") {
      // Bottom-center's frame hugs the work-area bottom exactly like the bottom
      // corners; Wispr Flow's higher resting spot comes from a larger CSS bottom
      // inset on the orb (App.jsx), so the down-shadow clears the Dock. The Dock
      // watcher keeps this frame flush as the work area changes.
      x = Math.round(workArea.x + (workArea.width - width) / 2);
      y = workArea.y + workArea.height - height - MARGIN;
    } else if (position === "top-left") {
      x = workArea.x + MARGIN;
      y = workArea.y + MARGIN;
    } else if (position === "top-right") {
      // Siri-style: top-right corner of the work area
      x = workArea.x + workArea.width - width - MARGIN;
      y = workArea.y + MARGIN;
    } else {
      // bottom-right (default)
      x = workArea.x + workArea.width - width - MARGIN;
      y = workArea.y + workArea.height - height - MARGIN;
    }

    // Clamped to the display's own work area, never to zero: a monitor placed
    // above or left of the primary one has a negative origin, so flooring at zero
    // lands the window on a coordinate that display doesn't cover.
    return {
      ...WindowPositionUtil.clampToWorkArea({ x, y, width, height }, display),
      width,
      height,
    };
  }

  // Keeps a window's whole frame inside one display's work area. Displays of
  // different sizes leave dead space beside the smaller one, and a window parked
  // there is invisible even though the window server still reports it on screen.
  static clampToWorkArea(bounds, display) {
    const workArea = display.workArea || display.bounds;
    return {
      x: Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - bounds.width)),
      y: Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - bounds.height)),
    };
  }

  // The on-screen center of every fixed snap target for a pill of `customSize`
  // on `display`. Drives both the drag overlay's target markers and the
  // nearest-target highlight, so a marker sits exactly where the pill will land.
  static getFixedPositionTargets(display, customSize = null) {
    const size = customSize || WINDOW_SIZES.BASE;
    return FIXED_PANEL_POSITIONS.map((id) => {
      const pos = WindowPositionUtil.getMainWindowPosition(display, size, id);
      return {
        id,
        x: pos.x,
        y: pos.y,
        width: pos.width,
        height: pos.height,
        centerX: pos.x + pos.width / 2,
        centerY: pos.y + pos.height / 2,
      };
    });
  }

  // Which of the five fixed positions the pill (at `bounds`) is closest to, by
  // straight-line distance between centers. Nearest-of-five (four corners +
  // bottom-center) replaces the old quadrant test, which couldn't express a
  // center target. Used to snap on drop and to highlight the live target.
  static getNearestFixedPosition(bounds, display, customSize = null) {
    const size = customSize || { width: bounds.width, height: bounds.height };
    const targets = WindowPositionUtil.getFixedPositionTargets(display, size);
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    let bestId = targets[0].id;
    let bestDist = Infinity;
    for (const target of targets) {
      const dx = target.centerX - cx;
      const dy = target.centerY - cy;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        bestId = target.id;
      }
    }
    return bestId;
  }

  static getNotificationPosition(display) {
    const { width, height } = NOTIFICATION_WINDOW_CONFIG;
    const MARGIN = 16;
    const workArea = display.workArea || display.bounds;
    // Same negative-origin trap as getMainWindowPosition: clamp to the display,
    // not to zero, or a monitor above the primary one puts the prompt nowhere.
    const bounds = {
      x: workArea.x + workArea.width - width - MARGIN,
      y: workArea.y + MARGIN,
      width,
      height,
    };
    return { ...WindowPositionUtil.clampToWorkArea(bounds, display), width, height };
  }

  static getTranscriptionPreviewPosition(display, mainWindowBounds, size = {}) {
    const width =
      size.width ||
      TRANSCRIPTION_PREVIEW_CONFIG.width ||
      TRANSCRIPTION_PREVIEW_SIZE_LIMITS.defaultWidth;
    const height =
      size.height ||
      TRANSCRIPTION_PREVIEW_CONFIG.height ||
      TRANSCRIPTION_PREVIEW_SIZE_LIMITS.defaultHeight;
    const GAP = 8;
    const workArea = display.workArea || display.bounds;

    let x = Math.round(mainWindowBounds.x + (mainWindowBounds.width - width) / 2);
    let y = mainWindowBounds.y - height - GAP;

    x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width));
    y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - height));

    return { x, y, width, height };
  }

  static setupAlwaysOnTop(window) {
    if (process.platform === "darwin") {
      // macOS: Use panel level for proper floating behavior
      // This ensures the window stays on top across spaces and fullscreen apps
      window.setAlwaysOnTop(true, "floating", 1);
      window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true, // Keep Dock/Command-Tab behaviour
      });
      window.setFullScreenable(false);

      if (window.isVisible()) {
        window.setAlwaysOnTop(true, "floating", 1);
      }
    } else if (process.platform === "win32") {
      window.setAlwaysOnTop(true, "pop-up-menu");
    } else if (isGnomeWayland) {
      window.setAlwaysOnTop(true, "floating");
    } else {
      // KDE XWayland and other Linux — "screen-saver" is the strongest z-level
      window.setAlwaysOnTop(true, "screen-saver");
    }
  }
}

const AGENT_OVERLAY_CONFIG = {
  width: 420,
  height: 300,
  minWidth: 360,
  minHeight: 200,
  maxWidth: 800,
  maxHeight: 10000,
  frame: false,
  alwaysOnTop: true,
  transparent: true,
  show: false,
  skipTaskbar: true,
  hasShadow: false,
  focusable: true,
  resizable: false,
  fullScreenable: false,
  acceptFirstMouse: true,
  type: FLOATING_OVERLAY_TYPE,
  visibleOnAllWorkspaces: process.platform !== "win32",
  webPreferences: {
    preload: path.join(__dirname, "..", "..", "preload.js"),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: false,
    webSecurity: false,
    spellcheck: false,
    backgroundThrottling: false,
  },
};

module.exports = {
  MAIN_WINDOW_CONFIG,
  CONTROL_PANEL_CONFIG,
  AGENT_OVERLAY_CONFIG,
  NOTIFICATION_WINDOW_CONFIG,
  TRANSCRIPTION_PREVIEW_CONFIG,
  TRANSCRIPTION_PREVIEW_SIZE_LIMITS,
  DRAG_OVERLAY_CONFIG,
  FIXED_PANEL_POSITIONS,
  WINDOW_SIZES,
  WindowPositionUtil,
};
