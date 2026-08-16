import assert from "node:assert/strict";
import test from "node:test";

import {
  MacroRecorder,
  macroActionUploadCommands,
  macroActionsFromSteps,
  macroReplaceCommands,
  macroUploadCommands,
  NEUTRAL_REPORT,
} from "../../web/macro-recorder.js";

const reportA = { ...NEUTRAL_REPORT, buttons: 1 << 2 };

test("records neutral delay, held input, and release timing", () => {
  const recorder = new MacroRecorder();
  recorder.start(12, 1000);
  recorder.capture(reportA, 1250);
  recorder.capture(NEUTRAL_REPORT, 1400);
  const steps = recorder.finish(1500);

  assert.equal(recorder.anchorStep, 12);
  assert.deepEqual(
    steps.map(({ durationMs, report }) => [durationMs, report.buttons]),
    [
      [250, 0],
      [150, 4],
      [100, 0],
    ],
  );
});

test("rate-limits and quantizes high-frequency analog gamepad reports", () => {
  const recorder = new MacroRecorder(() => 0, 50);
  recorder.start(0, 0);
  for (let time = 10; time <= 2000; time += 10) {
    recorder.capture(
      {
        ...NEUTRAL_REPORT,
        leftX: 128 + Math.round((time / 2000) * 127),
        leftY: 127 + (time % 20),
      },
      time,
    );
  }
  const steps = recorder.finish(2050);
  assert.ok(steps.length <= 42, `expected <= 42 steps, got ${steps.length}`);
  assert.equal(steps.at(-1).report.leftX, 255);
});

test("records digital changes immediately between analog samples", () => {
  const recorder = new MacroRecorder(() => 0, 50);
  recorder.start(0, 0);
  recorder.capture({ ...NEUTRAL_REPORT, leftX: 160 }, 20);
  recorder.capture({ ...NEUTRAL_REPORT, leftX: 160, buttons: 4 }, 25);
  recorder.capture({ ...NEUTRAL_REPORT, leftX: 160, buttons: 0 }, 30);
  const steps = recorder.finish(40);
  assert.deepEqual(
    steps.map(({ report }) => report.buttons),
    [0, 4, 0],
  );
});

test("turns a new recording into the full-replacement protocol", () => {
  assert.deepEqual(
    macroReplaceCommands([
      { durationMs: 120, report: reportA },
      { durationMs: 80, report: NEUTRAL_REPORT },
    ]),
    [
      "MACRO_REPLACE_BEGIN 2",
      "MACRO_STEP 120 4 15 128 128 128 128",
      "MACRO_STEP 80 0 15 128 128 128 128",
      "MACRO_COMMIT",
    ],
  );
});

test("pairs press and release timing into one logical action", () => {
  const actions = macroActionsFromSteps([
    { durationMs: 250, report: NEUTRAL_REPORT },
    { durationMs: 120, report: reportA },
    { durationMs: 500, report: NEUTRAL_REPORT },
  ]);
  assert.deepEqual(actions, [
    { holdMs: 120, waitMs: 500, report: reportA },
  ]);
  assert.deepEqual(macroActionUploadCommands(actions), [
    "MACRO_ACTION_BEGIN 1",
    "MACRO_ACTION 120 500 4 15 128 128 128 128",
    "MACRO_ACTION_COMMIT",
  ]);
});

test("turns recorded steps into the firmware upload protocol", () => {
  assert.deepEqual(macroUploadCommands(7, [
    { durationMs: 120, report: reportA },
    { durationMs: 80, report: NEUTRAL_REPORT },
  ]), [
    "MACRO_BEGIN 7 2",
    "MACRO_STEP 120 4 15 128 128 128 128",
    "MACRO_STEP 80 0 15 128 128 128 128",
    "MACRO_COMMIT",
  ]);
});
