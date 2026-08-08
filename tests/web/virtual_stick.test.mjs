import assert from "node:assert/strict";
import test from "node:test";

import {
  stickVectorFromPoint,
  sticksCentered,
} from "../../web/virtual-stick.js";

const rect = { left: 10, top: 20, width: 200, height: 200 };

test("virtual stick maps center and cardinal edges to Switch axes", () => {
  assert.deepEqual(stickVectorFromPoint(110, 120, rect), {
    normalizedX: 0,
    normalizedY: 0,
    x: 128,
    y: 128,
  });
  assert.equal(stickVectorFromPoint(210, 120, rect).x, 255);
  assert.equal(stickVectorFromPoint(10, 120, rect).x, 0);
  assert.equal(stickVectorFromPoint(110, 20, rect).y, 0);
  assert.equal(stickVectorFromPoint(110, 220, rect).y, 255);
});

test("virtual stick clamps diagonal input to a circular gate", () => {
  const value = stickVectorFromPoint(210, 220, rect);
  assert.ok(Math.abs(Math.hypot(value.normalizedX, value.normalizedY) - 1) < 1e-9);
  assert.equal(value.x, 218);
  assert.equal(value.y, 218);
});

test("center detection checks all four axes", () => {
  const centered = {
    left: { x: 128, y: 128 },
    right: { x: 128, y: 128 },
  };
  assert.equal(sticksCentered(centered), true);
  centered.left.x = 129;
  assert.equal(sticksCentered(centered), false);
});
