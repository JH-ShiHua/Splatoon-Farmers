import assert from "node:assert/strict";
import test from "node:test";

import {
  gamepadSnapshot,
  normalizeGamepadStick,
} from "../../web/gamepad-input.js";

test("maps standard gamepad face buttons to Switch positions", () => {
  const buttons = Array.from({ length: 18 }, () => ({ pressed: false, value: 0 }));
  buttons[0] = { pressed: true, value: 1 };
  buttons[1] = { pressed: true, value: 1 };
  buttons[12] = { pressed: true, value: 1 };
  const snapshot = gamepadSnapshot({ buttons, axes: [0, 0, 0, 0] });
  assert.deepEqual([...snapshot.controls].sort(), ["A", "B", "DPAD_UP"]);
});

test("applies radial deadzone and maps stick extrema to HID bytes", () => {
  assert.deepEqual(normalizeGamepadStick(0.05, -0.04), {
    x: 128,
    y: 128,
    normalizedX: 0,
    normalizedY: 0,
  });
  assert.deepEqual(normalizeGamepadStick(-1, 0), {
    x: 0,
    y: 128,
    normalizedX: -1,
    normalizedY: 0,
  });
  assert.deepEqual(normalizeGamepadStick(1, 1).x, 218);
  assert.deepEqual(normalizeGamepadStick(1, 1).y, 218);
});
