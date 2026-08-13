const { screen } = require("electron");
const { WindowPositionUtil } = require("./windowConfig");

// Modest poll — each tick is a couple of cheap synchronous reads (getBounds +
// getDisplayNearestPoint), never a busy loop.
const DOCK_POLL_MS = 400;

// Keeps the bottom-center dictation pill clear of the macOS Dock.
//
// While the pill rests at bottom-center this polls the active display's work
// area. macOS shrinks the work area's bottom inset when a bottom Dock occupies
// space (a persistent Dock, or one toggled / resized in System Settings); when
// that inset changes, the pill is repositioned to the canonical bottom-center
// spot for its current size, so it rides up to stay above a Dock that appears
// and drops back down when the Dock's inset goes away.
//
// Only bottom-center reacts to the Dock — the four corners ignore it entirely —
// so the watcher runs *only* while the pill is centered and is stopped the moment
// it snaps elsewhere (or the window is dragged, hidden, or destroyed).
class DockWatcher {
  constructor() {
    this._interval = null;
    this._getWindow = null;
    this._lastWorkAreaBottom = null;
  }

  // Idempotent: begin polling for the window returned by `getWindow()`. A no-op
  // if already running (the position sync calls this on every relevant change).
  start(getWindow) {
    this._getWindow = getWindow;
    if (this._interval) return;
    this._lastWorkAreaBottom = null;
    this._interval = setInterval(() => this._tick(), DOCK_POLL_MS);
    // Align immediately so a Dock already on screen doesn't cover the pill for a
    // whole interval before the first poll lands.
    this._tick();
  }

  // Idempotent: stop polling. Safe to call when not running.
  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    this._getWindow = null;
    this._lastWorkAreaBottom = null;
  }

  _tick() {
    const win = this._getWindow?.();
    // A hidden pill (auto-hide idle) or a torn-down window has nothing to keep
    // above the Dock; skip cheaply and let the next tick re-align once it's back.
    if (!win || win.isDestroyed() || !win.isVisible()) return;

    const bounds = win.getBounds();
    const display = screen.getDisplayNearestPoint({
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    });
    const workArea = display.workArea || display.bounds;
    const workAreaBottom = workArea.y + workArea.height;

    // Act only when the bottom inset actually changed (Dock shown / hidden /
    // resized, or the pill moved to a display with a different inset), so a
    // resting pill isn't rewritten every tick.
    if (this._lastWorkAreaBottom === workAreaBottom) return;
    this._lastWorkAreaBottom = workAreaBottom;

    // Re-derive the canonical bottom-center spot for the pill's CURRENT size so
    // the new y (and re-centered x) match exactly where a fresh placement lands —
    // sharing getMainWindowPosition keeps the watcher, the placement, and the drag
    // markers in lockstep (frame flush to the work-area bottom; the orb's Wispr
    // lift is a renderer inset inside the frame).
    const target = WindowPositionUtil.getMainWindowPosition(
      display,
      { width: bounds.width, height: bounds.height },
      "center"
    );
    if (target.x !== bounds.x || target.y !== bounds.y) {
      win.setBounds({
        x: target.x,
        y: target.y,
        width: bounds.width,
        height: bounds.height,
      });
    }
  }
}

module.exports = DockWatcher;
