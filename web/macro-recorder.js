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
  constructor(clock = () => performance.now()) {
    this.clock = clock;
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
    if (!this.recording || sameReport(report, this.lastReport)) {
      return;
    }
    this.appendElapsed(now);
    this.lastReport = copyReport(report);
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
