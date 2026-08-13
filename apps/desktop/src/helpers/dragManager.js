const { screen } = require("electron");
const { WindowPositionUtil } = require("./windowConfig");

// How far the cursor must travel from the press point before a press counts as a
// real drag (and the Wispr-style reposition overlay appears). A plain click/tap
// never moves this far, so it never flashes the overlay. Kept just above the
// renderer's own 5px click-vs-drag threshold (App.jsx) so the two never disagree.
const DRAG_OVERLAY_THRESHOLD_PX = 6;

class DragManager {
  constructor() {
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.mouseTrackingInterval = null;
    this.targetWindow = null;
    this.dragStartCursor = null;
    this.movedPastThreshold = false;
    // { onDragMove(cursorPoint), onDragEnd() } — driven by the tracking loop so
    // the window manager can show/update/hide the reposition overlay.
    this.callbacks = {};
  }

  setTargetWindow(window) {
    this.targetWindow = window;
  }

  setCallbacks(callbacks) {
    this.callbacks = callbacks || {};
  }

  async startWindowDrag() {
    if (!this.targetWindow || this.targetWindow.isDestroyed()) {
      return { success: false, message: "Window not available" };
    }

    try {
      this.isDragging = true;

      // Get current cursor position
      const cursorPos = screen.getCursorScreenPoint();
      const windowPos = this.targetWindow.getPosition();

      // Calculate offset from cursor to window position
      this.dragOffset = {
        x: cursorPos.x - windowPos[0],
        y: cursorPos.y - windowPos[1],
      };

      // Remember where the press began so the tracking loop can tell a real drag
      // from a stationary click and only then reveal the reposition overlay.
      this.dragStartCursor = { x: cursorPos.x, y: cursorPos.y };
      this.movedPastThreshold = false;

      // Start tracking mouse movements
      this.setupMouseTracking();

      console.log("🖱️ Window drag started");
      return { success: true };
    } catch (error) {
      console.error("Failed to start window drag:", error);
      this.isDragging = false;
      return { success: false, message: error.message };
    }
  }

  async stopWindowDrag() {
    try {
      this.isDragging = false;
      this.stopMouseTracking();
      this.dragStartCursor = null;
      this.movedPastThreshold = false;
      // Always fire — hiding an overlay that never appeared is a no-op, and the
      // window manager still needs the drop signal to fade the overlay out.
      this.callbacks.onDragEnd?.();
      console.log("🖱️ Window drag stopped");
      return { success: true };
    } catch (error) {
      console.error("Failed to stop window drag:", error);
      return { success: false, message: error.message };
    }
  }

  setupMouseTracking() {
    if (this.mouseTrackingInterval) {
      clearInterval(this.mouseTrackingInterval);
    }

    this.mouseTrackingInterval = setInterval(() => {
      if (this.isDragging && this.targetWindow && !this.targetWindow.isDestroyed()) {
        this.updateWindowPosition();
      }
    }, 16); // ~60fps
  }

  updateWindowPosition() {
    try {
      const cursorPos = screen.getCursorScreenPoint();
      const { width, height } = this.targetWindow.getBounds();
      const x = cursorPos.x - this.dragOffset.x;
      const y = cursorPos.y - this.dragOffset.y;

      // Constrain against the display the window lands on, not the one under the
      // cursor: near a boundary between differently sized displays, the cursor's
      // work area permits positions that leave the window in dead space.
      const display = screen.getDisplayNearestPoint({
        x: x + width / 2,
        y: y + height / 2,
      });
      const clamped = WindowPositionUtil.clampToWorkArea({ x, y, width, height }, display);

      this.targetWindow.setPosition(clamped.x, clamped.y);

      // Reveal + drive the reposition overlay only once the press has become a
      // real drag, then feed it the live cursor every tick.
      if (!this.movedPastThreshold && this.dragStartCursor) {
        const movedX = cursorPos.x - this.dragStartCursor.x;
        const movedY = cursorPos.y - this.dragStartCursor.y;
        if (Math.hypot(movedX, movedY) > DRAG_OVERLAY_THRESHOLD_PX) {
          this.movedPastThreshold = true;
        }
      }
      if (this.movedPastThreshold) {
        this.callbacks.onDragMove?.(cursorPos);
      }
    } catch (error) {
      console.error("Error updating window position:", error);
      this.stopWindowDrag();
    }
  }

  stopMouseTracking() {
    if (this.mouseTrackingInterval) {
      clearInterval(this.mouseTrackingInterval);
      this.mouseTrackingInterval = null;
    }
  }

  isDragActive() {
    return this.isDragging;
  }

  getDragOffset() {
    return { ...this.dragOffset };
  }

  cleanup() {
    this.stopWindowDrag();
    this.targetWindow = null;
  }
}

module.exports = DragManager;
