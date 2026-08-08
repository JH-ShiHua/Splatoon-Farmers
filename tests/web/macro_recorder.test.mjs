import assert from "node:assert/strict";
import test from "node:test";

import {
  MacroRecorder,
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
