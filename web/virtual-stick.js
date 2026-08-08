export const CENTER_AXIS = 128;

export function stickVectorFromPoint(clientX, clientY, rect, deadzone = 0.04) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
  let normalizedX = (clientX - centerX) / radius;
  let normalizedY = (clientY - centerY) / radius;
  const magnitude = Math.hypot(normalizedX, normalizedY);

  if (magnitude > 1) {
    normalizedX /= magnitude;
    normalizedY /= magnitude;
  } else if (magnitude < deadzone) {
    normalizedX = 0;
    normalizedY = 0;
  }

  return {
    normalizedX,
    normalizedY,
    x: Math.max(
      0,
      Math.min(
        255,
        Math.round(
          CENTER_AXIS + normalizedX * (normalizedX < 0 ? 128 : 127),
        ),
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        255,
        Math.round(
          CENTER_AXIS + normalizedY * (normalizedY < 0 ? 128 : 127),
        ),
      ),
    ),
  };
}

export function sticksCentered(sticks) {
  return (
    sticks.left.x === CENTER_AXIS &&
    sticks.left.y === CENTER_AXIS &&
    sticks.right.x === CENTER_AXIS &&
    sticks.right.y === CENTER_AXIS
  );
}
