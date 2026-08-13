const test = require("node:test");
const assert = require("node:assert/strict");

const { WindowPositionUtil, FIXED_PANEL_POSITIONS } = require("../../src/helpers/windowConfig");

// A plain 1000x800 work area at the origin. Pill is the 96x96 base size.
const DISPLAY = { id: 1, workArea: { x: 0, y: 0, width: 1000, height: 800 } };
const PILL = { width: 96, height: 96 };

// Places a 96x96 pill so its center lands on (cx, cy).
function pillCenteredAt(cx, cy) {
  return { x: cx - PILL.width / 2, y: cy - PILL.height / 2, width: PILL.width, height: PILL.height };
}

test("exposes all five fixed snap positions including bottom-center", () => {
  assert.deepEqual(
    [...FIXED_PANEL_POSITIONS].sort(),
    ["bottom-left", "bottom-right", "center", "top-left", "top-right"]
  );
});

test("getFixedPositionTargets returns one target per fixed position", () => {
  const targets = WindowPositionUtil.getFixedPositionTargets(DISPLAY, PILL);
  assert.equal(targets.length, 5);
  assert.deepEqual(
    targets.map((t) => t.id).sort(),
    ["bottom-left", "bottom-right", "center", "top-left", "top-right"]
  );
  // Bottom-center sits on the work-area horizontal center, near the bottom edge.
  const center = targets.find((t) => t.id === "center");
  assert.equal(center.centerX, 500); // (1000 - 96) / 2 + 48
  assert.ok(center.centerY > 700, "bottom-center hugs the bottom edge");
});

test("a pill near the bottom middle snaps to bottom-center, not a bottom corner", () => {
  const nearest = WindowPositionUtil.getNearestFixedPosition(
    pillCenteredAt(500, 700),
    DISPLAY,
    PILL
  );
  assert.equal(nearest, "center");
});

test("each corner region snaps to its own corner", () => {
  assert.equal(
    WindowPositionUtil.getNearestFixedPosition(pillCenteredAt(90, 90), DISPLAY, PILL),
    "top-left"
  );
  assert.equal(
    WindowPositionUtil.getNearestFixedPosition(pillCenteredAt(910, 90), DISPLAY, PILL),
    "top-right"
  );
  assert.equal(
    WindowPositionUtil.getNearestFixedPosition(pillCenteredAt(90, 710), DISPLAY, PILL),
    "bottom-left"
  );
  assert.equal(
    WindowPositionUtil.getNearestFixedPosition(pillCenteredAt(910, 710), DISPLAY, PILL),
    "bottom-right"
  );
});

test("with no top-center target, the top middle falls to a top corner", () => {
  const nearest = WindowPositionUtil.getNearestFixedPosition(
    pillCenteredAt(500, 90),
    DISPLAY,
    PILL
  );
  assert.ok(["top-left", "top-right"].includes(nearest), `unexpected: ${nearest}`);
});
