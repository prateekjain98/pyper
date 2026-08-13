const { screen } = require("electron");
const { WindowPositionUtil } = require("./windowConfig");

// Cheap resting cadence — while nothing is moving we just glance at the work
// area a couple of times a second (each glance is a synchronous getBounds +
// getDisplayNearestPoint, never a busy loop).
const IDLE_POLL_MS = 400;
// While the pill is riding the Dock we sample ~per frame so it tracks the Dock's
// live show/hide/resize animation instead of lagging a step behind it.
const ACTIVE_POLL_MS = 16;
// Length of the eased settle. macOS's Dock show/hide runs ~250ms, so a slightly
// shorter ease-out (fast start, gentle finish) arrives in step with it — the
// pill glides up/down with the Dock rather than jumping.
const ANIM_DURATION_MS = 220;

// Ease-out cubic: quick initial response (feels attached to the Dock), then a
// soft deceleration onto the exact target. At t=1 this is exactly 1, so the
// tween lands pixel-perfect on the canonical spot.
function easeOutCubic(t) {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

// Keeps the bottom-center dictation pill glued just above the macOS Dock, and —
// unlike a plain reposition — makes it move WITH the Dock instead of snapping
// after it. Wispr Flow's pill rides the Dock's animation; this reproduces that.
//
// How it works: macOS shrinks a display's work-area bottom inset while a bottom
// Dock occupies space (a persistent Dock, or one shown / hidden / resized). The
// canonical bottom-center spot is derived from that work area, so when the inset
// changes the target y changes. Instead of one instant setBounds, we ease the
// window's y (and re-center x) to the new target over ANIM_DURATION_MS, sampling
// the work area every frame so we follow the Dock's own motion; if the Dock is
// still moving we re-aim mid-flight. Once settled we drop back to the cheap idle
// poll and never rewrite bounds while resting.
//
// Only bottom-center reacts to the Dock — the four corners ignore it entirely —
// so the watcher is started (by windowManager._syncDockWatcher) ONLY while the
// pill rests at center, and stopped the moment it snaps elsewhere (or is dragged,
// hidden, or destroyed).
class DockWatcher {
  constructor() {
    this._timer = null;
    this._getWindow = null;
    // Tracks whether the pill was visible last tick so a Dock change that
    // happened while it was hidden is applied as an instant snap on reappearance
    // (a slide-in would look like a glitch), not as an animated glide.
    this._wasVisible = false;
    this._onDisplayMetrics = null;
    this._resetAnim();
  }

  // Idempotent: begin watching the window returned by `getWindow()`. A no-op if
  // already running (the position sync calls this on every relevant change).
  start(getWindow) {
    this._getWindow = getWindow;
    if (this._timer) return;
    this._resetAnim();
    this._wasVisible = false;
    // A work-area change (Dock shown / hidden / resized) fires this — react at
    // once rather than waiting out the idle poll, so we catch the start of the
    // Dock's animation and ride it. The tick itself is a cheap no-op when the
    // pill is already where it belongs, so a spurious event costs nothing.
    if (!this._onDisplayMetrics) {
      this._onDisplayMetrics = () => this._kick();
    }
    screen.on("display-metrics-changed", this._onDisplayMetrics);
    // Align immediately (as an instant snap — see _wasVisible) so a Dock already
    // on screen doesn't cover the pill, then let the loop take over.
    this._tick();
  }

  // Idempotent: stop watching. Safe to call when not running.
  stop() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._onDisplayMetrics) {
      screen.removeListener("display-metrics-changed", this._onDisplayMetrics);
    }
    this._getWindow = null;
    this._wasVisible = false;
    this._resetAnim();
  }

  _resetAnim() {
    this._animating = false;
    this._animStartX = 0;
    this._animStartY = 0;
    this._animTargetX = 0;
    this._animTargetY = 0;
    this._animStartTime = 0;
  }

  // Re-evaluate now (out of band from the poll) in response to a work-area event,
  // keeping exactly one timer in flight.
  _kick() {
    if (!this._getWindow) return;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._tick();
  }

  _scheduleNext() {
    // Sample every frame while settling; relax to the cheap cadence at rest.
    const delay = this._animating ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    this._timer = setTimeout(() => this._tick(), delay);
  }

  _tick() {
    // Stopped between schedule and fire — don't reschedule.
    if (!this._getWindow) return;

    const win = this._getWindow();
    // A hidden pill (auto-hide idle) or a torn-down window has nothing to keep
    // above the Dock. Abandon any in-flight settle, remember it's away (so it
    // snaps rather than slides when it returns), and keep glancing cheaply.
    if (!win || win.isDestroyed() || !win.isVisible()) {
      this._resetAnim();
      this._wasVisible = false;
      this._scheduleNext();
      return;
    }

    const bounds = win.getBounds();
    const size = { width: bounds.width, height: bounds.height };
    const display = screen.getDisplayNearestPoint({
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    });
    // The canonical bottom-center spot for the pill's CURRENT size — the exact
    // place a fresh placement lands. Sharing getMainWindowPosition keeps the
    // watcher, the placement, and the drag markers in lockstep (frame flush to
    // the work-area bottom; the orb's Wispr lift is a renderer inset inside it).
    const target = WindowPositionUtil.getMainWindowPosition(display, size, "center");

    // First frame after the pill (re)appears: it may have missed a Dock change
    // while hidden. Put it exactly where it belongs INSTANTLY — no glide.
    if (!this._wasVisible) {
      this._wasVisible = true;
      this._resetAnim();
      if (target.x !== bounds.x || target.y !== bounds.y) {
        win.setBounds({ x: target.x, y: target.y, width: size.width, height: size.height });
      }
      this._scheduleNext();
      return;
    }

    if (this._animating) {
      this._stepAnimation(win, bounds, size, target);
    } else if (target.x !== bounds.x || target.y !== bounds.y) {
      // The work area moved (Dock shown / hidden / resized, or the pill landed on
      // a display with a different inset) — start riding to the new spot with a
      // short eased settle instead of a single jump. The first movement lands on
      // the next (active-cadence) tick, easing out from here.
      this._beginAnimation(bounds, target);
    }
    // else: resting and on-target — nothing to write (cheap).

    this._scheduleNext();
  }

  _beginAnimation(bounds, target) {
    this._animating = true;
    this._animStartX = bounds.x;
    this._animStartY = bounds.y;
    this._animTargetX = target.x;
    this._animTargetY = target.y;
    this._animStartTime = Date.now();
  }

  _stepAnimation(win, bounds, size, target) {
    // Dock still moving? Re-aim from our current spot at the latest work-area
    // target so we track the Dock's live animation instead of easing toward a
    // stale end-point (and so we don't settle early while it's still sliding).
    if (target.x !== this._animTargetX || target.y !== this._animTargetY) {
      this._animStartX = bounds.x;
      this._animStartY = bounds.y;
      this._animTargetX = target.x;
      this._animTargetY = target.y;
      this._animStartTime = Date.now();
    }

    const elapsed = Date.now() - this._animStartTime;
    const p = elapsed >= ANIM_DURATION_MS ? 1 : elapsed / ANIM_DURATION_MS;
    const e = easeOutCubic(p);
    // p === 1 ⇒ e === 1 ⇒ these land exactly on the canonical target pixel.
    const nextX = Math.round(this._animStartX + (this._animTargetX - this._animStartX) * e);
    const nextY = Math.round(this._animStartY + (this._animTargetY - this._animStartY) * e);

    // Only write when the pixel actually changes — a frame that doesn't move the
    // window (e.g. x unchanged during a pure vertical Dock slide) costs nothing.
    if (nextX !== bounds.x || nextY !== bounds.y) {
      win.setBounds({ x: nextX, y: nextY, width: size.width, height: size.height });
    }

    // Settled exactly on target — go idle (the next schedule relaxes the poll).
    if (p >= 1) {
      this._animating = false;
    }
  }
}

module.exports = DockWatcher;
