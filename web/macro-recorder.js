const NEUTRAL_REPORT = Object.freeze({
  buttons: 0,
  dpad: 15,
  leftX: 128,
  leftY: 128,
  rightX: 128,
  rightY: 128,
});

function copyReport(report) {
  return {
    buttons: report.buttons,
    dpad: report.dpad,
    leftX: report.leftX,
    leftY: report.leftY,
    rightX: report.rightX,
    rightY: report.rightY,
  };
}

function quantizeAxis(value, step = 8) {
  const axis = Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
  if (axis === 128) {
    return 128;
  }
  if (axis <= step / 2) {
    return 0;
  }
  if (axis >= 255 - step / 2) {
    return 255;
  }
  return Math.max(
    0,
    Math.min(255, 128 + Math.round((axis - 128) / step) * step),
  );
}

function recordingReport(report) {
  return {
    buttons: report.buttons,
    dpad: report.dpad,
    leftX: quantizeAxis(report.leftX),
    leftY: quantizeAxis(report.leftY),
    rightX: quantizeAxis(report.rightX),
    rightY: quantizeAxis(report.rightY),
  };
}

function digitalStateChanged(left, right) {
  return left.buttons !== right.buttons || left.dpad !== right.dpad;
}

function sameReport(left, right) {
  return (
    left.buttons === right.buttons &&
    left.dpad === right.dpad &&
    left.leftX === right.leftX &&
    left.leftY === right.leftY &&
    left.rightX === right.rightX &&
    left.rightY === right.rightY
  );
}

export class MacroRecorder {
  constructor(clock = () => performance.now(), analogSampleMs = 50) {
    this.clock = clock;
    this.analogSampleMs = analogSampleMs;
    this.reset();
  }

  reset() {
    this.recording = false;
    this.anchorStep = 0;
    this.steps = [];
    this.lastReport = copyReport(NEUTRAL_REPORT);
    this.lastChangedAt = 0;
  }

  start(anchorStep, now = this.clock()) {
    this.reset();
    this.recording = true;
    this.anchorStep = Math.max(0, Math.trunc(anchorStep) || 0);
    this.lastChangedAt = now;
  }

  capture(report, now = this.clock()) {
    if (!this.recording) {
      return;
    }
    const nextReport = recordingReport(report);
    if (sameReport(nextReport, this.lastReport)) {
      return;
    }
    if (
      !digitalStateChanged(nextReport, this.lastReport) &&
      now - this.lastChangedAt < this.analogSampleMs
    ) {
      return;
    }
    this.appendElapsed(now);
    this.lastReport = nextReport;
    this.lastChangedAt = now;
  }

  finish(now = this.clock()) {
    if (!this.recording) {
      return [];
    }
    this.appendElapsed(now);
    this.recording = false;
    return this.steps.map((step) => ({
      durationMs: step.durationMs,
      report: copyReport(step.report),
    }));
  }

  appendElapsed(now) {
    const durationMs = Math.max(1, Math.round(now - this.lastChangedAt));
    const previous = this.steps.at(-1);
    if (previous && sameReport(previous.report, this.lastReport)) {
      previous.durationMs += durationMs;
    } else {
      this.steps.push({
        durationMs,
        report: copyReport(this.lastReport),
      });
    }
  }
}

export function macroUploadCommands(anchorStep, steps) {
  const commands = [`MACRO_BEGIN ${anchorStep} ${steps.length}`];
  for (const { durationMs, report } of steps) {
    commands.push(
      `MACRO_STEP ${durationMs} ${report.buttons} ${report.dpad} ` +
        `${report.leftX} ${report.leftY} ${report.rightX} ${report.rightY}`,
    );
  }
  commands.push("MACRO_COMMIT");
  return commands;
}

export function macroReplaceCommands(steps) {
  const commands = [`MACRO_REPLACE_BEGIN ${steps.length}`];
  for (const { durationMs, report } of steps) {
    commands.push(
      `MACRO_STEP ${durationMs} ${report.buttons} ${report.dpad} ` +
        `${report.leftX} ${report.leftY} ${report.rightX} ${report.rightY}`,
    );
  }
  commands.push("MACRO_COMMIT");
  return commands;
}

export { NEUTRAL_REPORT };
