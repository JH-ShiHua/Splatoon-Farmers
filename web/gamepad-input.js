export const GAMEPAD_BUTTON_BINDINGS = Object.freeze({
  0: "B",
  1: "A",
  2: "Y",
  3: "X",
  4: "L",
  5: "R",
  6: "ZL",
  7: "ZR",
  8: "MINUS",
  9: "PLUS",
  10: "L_STICK_PRESS",
  11: "R_STICK_PRESS",
  12: "DPAD_UP",
  13: "DPAD_DOWN",
  14: "DPAD_LEFT",
  15: "DPAD_RIGHT",
  16: "HOME",
  17: "CAPTURE",
});

const CENTER_AXIS = 128;

function axisByte(value) {
  const normalized = Math.max(-1, Math.min(1, Number(value) || 0));
  return Math.max(
    0,
    Math.min(
      255,
      Math.round(
        CENTER_AXIS + normalized * (normalized < 0 ? 128 : 127),
      ),
    ),
  );
}

export function normalizeGamepadStick(x, y, deadzone = 0.12) {
  const rawX = Math.max(-1, Math.min(1, Number(x) || 0));
  const rawY = Math.max(-1, Math.min(1, Number(y) || 0));
  const rawMagnitude = Math.hypot(rawX, rawY);
  const magnitude = Math.min(1, rawMagnitude);
  if (magnitude <= deadzone) {
    return { x: 128, y: 128, normalizedX: 0, normalizedY: 0 };
  }
  const scaledMagnitude = (magnitude - deadzone) / (1 - deadzone);
  const normalizedX = (rawX / rawMagnitude) * scaledMagnitude;
  const normalizedY = (rawY / rawMagnitude) * scaledMagnitude;
  return {
    x: axisByte(normalizedX),
    y: axisByte(normalizedY),
    normalizedX,
    normalizedY,
  };
}

export function gamepadSnapshot(gamepad, deadzone = 0.12) {
  const controls = new Set();
  for (const [index, control] of Object.entries(GAMEPAD_BUTTON_BINDINGS)) {
    const button = gamepad?.buttons?.[Number(index)];
    if (button?.pressed || Number(button?.value) > 0.5) {
      controls.add(control);
    }
  }
  return {
    controls,
    left: normalizeGamepadStick(gamepad?.axes?.[0], gamepad?.axes?.[1], deadzone),
    right: normalizeGamepadStick(gamepad?.axes?.[2], gamepad?.axes?.[3], deadzone),
  };
}
