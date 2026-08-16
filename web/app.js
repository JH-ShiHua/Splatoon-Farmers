import { formatDuration, parseDeviceLine } from "./protocol.js";
import {
  GAMEPAD_BUTTON_BINDINGS,
  gamepadSnapshot,
} from "./gamepad-input.js";
import {
  buildManualReport,
  KEYBOARD_BINDINGS,
  ManualInputState,
} from "./manual-input.js";
import {
  MacroRecorder,
  macroActionUploadCommands,
  macroActionsFromSteps,
  macroUploadCommands,
} from "./macro-recorder.js";
import { MockSerialTransport, SerialTransport } from "./serial-transport.js";
import { stickVectorFromPoint, sticksCentered } from "./virtual-stick.js?v=5";

const elements = {
  connectionButton: document.querySelector('[data-testid="connect-button"]'),
  startButton: document.querySelector('[data-testid="start-button"]'),
  stopButton: document.querySelector('[data-testid="stop-button"]'),
  statusBadge: document.querySelector('[data-testid="status-badge"]'),
  statusText: document.querySelector('[data-testid="status-text"]'),
  detailText: document.querySelector('[data-testid="detail-text"]'),
  progress: document.querySelector('[data-testid="macro-progress"]'),
  stepText: document.querySelector('[data-testid="step-text"]'),
  browserNote: document.querySelector('[data-testid="browser-note"]'),
  errorText: document.querySelector('[data-testid="error-text"]'),
  durationText: document.querySelector('[data-testid="duration-text"]'),
  stepsTotal: document.querySelector('[data-testid="steps-total"]'),
  heroSteps: document.querySelector('[data-testid="hero-steps"]'),
  activeMacroName: document.querySelector('[data-testid="active-macro-name"]'),
  macroSelect: document.querySelector('[data-testid="macro-select"]'),
  selectMacroButton: document.querySelector(
    '[data-testid="select-macro-button"]',
  ),
  manualStatus: document.querySelector('[data-testid="manual-status"]'),
  recordButton: document.querySelector('[data-testid="record-button"]'),
  newMacroRecordButton: document.querySelector(
    '[data-testid="new-macro-record-button"]',
  ),
  uploadRecordingButton: document.querySelector(
    '[data-testid="upload-recording-button"]',
  ),
  cancelRecordingButton: document.querySelector(
    '[data-testid="cancel-recording-button"]',
  ),
  resetMacroButton: document.querySelector(
    '[data-testid="reset-macro-button"]',
  ),
  recordingStatus: document.querySelector('[data-testid="recording-status"]'),
  recordingDetail: document.querySelector('[data-testid="recording-detail"]'),
  stickDiagnostic: document.querySelector('[data-testid="stick-diagnostic"]'),
  gamepadStatus: document.querySelector('[data-testid="gamepad-status"]'),
};
const manualButtons = [
  ...document.querySelectorAll("button[data-control]"),
];
const stickPads = [...document.querySelectorAll("[data-stick]")];

const mockMode = new URLSearchParams(window.location.search).get("mock") === "1";
const TransportClass = mockMode ? MockSerialTransport : SerialTransport;
const transportSupported = TransportClass.isSupported();

let transport = null;
let connected = false;
let busy = false;
let deviceState = "unknown";
let devicePhase = "idle";
let currentStep = 0;
let lastRunningStep = 0;
let stepCount = 48;
let pollTimer = null;
let activeManualControls = new Set();
const stickState = {
  left: { x: 128, y: 128 },
  right: { x: 128, y: 128 },
};
let customMacro = false;
let activeMacroId = "original";
let customMacroSteps = 0;
let recordingAnchor = 0;
let recordingMode = "insert";
let lastSentAxes = null;
let lastAppliedAxes = null;
let pendingMacroResponse = null;
let activeGamepadIndex = null;
let gamepadAxesActive = false;
const macroRecorder = new MacroRecorder();
const manualInputState = new ManualInputState(onManualInputChange);

elements.durationText.textContent = formatDuration(63595);

function setError(message = "") {
  elements.errorText.textContent = message;
  elements.errorText.hidden = !message;
}

function render() {
  const manualActive =
    connected &&
    (activeManualControls.size > 0 || !sticksCentered(stickState));
  const running = connected && deviceState === "running" && !manualActive;
  elements.connectionButton.textContent = connected ? "断开串口" : "连接手柄";
  elements.connectionButton.disabled = busy || !transportSupported;
  elements.startButton.disabled = busy || !connected || running || manualActive;
  elements.stopButton.disabled = busy || !connected || !running;
  elements.recordButton.disabled = busy || !connected || macroRecorder.recording;
  elements.newMacroRecordButton.disabled =
    busy || !connected || macroRecorder.recording;
  elements.uploadRecordingButton.disabled =
    busy || !connected || !macroRecorder.recording;
  elements.cancelRecordingButton.disabled =
    busy || !connected || !macroRecorder.recording;
  elements.resetMacroButton.disabled =
    busy || !connected || macroRecorder.recording || !customMacro;
  elements.macroSelect.disabled = busy || !connected || macroRecorder.recording;
  elements.selectMacroButton.disabled =
    busy ||
    !connected ||
    macroRecorder.recording ||
    elements.macroSelect.value === activeMacroId;
  for (const button of manualButtons) {
    const pressed = activeManualControls.has(button.dataset.control);
    button.disabled = busy || !connected;
    button.classList.toggle("is-pressed", pressed);
    button.setAttribute("aria-pressed", String(pressed));
  }
  for (const pad of stickPads) {
    pad.setAttribute("aria-disabled", String(busy || !connected));
  }

  elements.statusBadge.dataset.state = connected
    ? manualActive
      ? "manual"
      : running
      ? "running"
      : "connected"
    : "disconnected";

  if (!connected) {
    elements.statusText.textContent = "未连接";
    elements.detailText.textContent =
      deviceState === "running"
        ? "控制线已断开；板载远征任务可能仍在独立运行"
        : "先用 USB-UART 连接电脑";
  } else if (manualActive) {
    elements.statusText.textContent = "手动输入";
    elements.detailText.textContent = `已按下 ${activeManualControls.size} 个控制 · 板载脚本已停止`;
  } else if (running && devicePhase === "gap") {
    elements.statusText.textContent = "补给间隔";
    elements.detailText.textContent = `已完成 ${Math.max(
      1,
      Number(elements.statusBadge.dataset.cycle || 1),
    )} 轮 · 准备下一次素材远征`;
  } else if (running) {
    elements.statusText.textContent = "远征执行中";
    elements.detailText.textContent = `脚本在 ESP32-S3 本地执行 · 第 ${currentStep}/${stepCount} 步`;
  } else {
    elements.statusText.textContent = "已连接 · 待命";
    elements.detailText.textContent = "素材脚本已固化在 Flash，点击即可从第 1 步出发";
  }

  if (!connected) {
    elements.manualStatus.textContent = "连接后启用";
    elements.manualStatus.dataset.state = "disconnected";
  } else if (manualActive) {
    const activeKinds =
      activeManualControls.size + (sticksCentered(stickState) ? 0 : 1);
    elements.manualStatus.textContent = `${activeKinds} 组输入生效`;
    elements.manualStatus.dataset.state = "active";
  } else {
    elements.manualStatus.textContent = "键盘输入已启用";
    elements.manualStatus.dataset.state = "ready";
  }

  elements.progress.max = stepCount;
  elements.progress.value = currentStep;
  elements.stepText.textContent = `${currentStep} / ${stepCount}`;
  elements.stepsTotal.textContent = String(stepCount);
  elements.heroSteps.textContent = `${stepCount} STEPS`;
  elements.activeMacroName.textContent =
    activeMacroId === "custom" ? "自定义宏" : "原始素材宏";

  if (macroRecorder.recording) {
    elements.recordingStatus.textContent = "正在录制";
    elements.recordingStatus.dataset.state = "recording";
    elements.recordingDetail.textContent =
      (recordingMode === "replace"
        ? "新建宏：将替换当前自定义宏"
        : `插入点：第 ${recordingAnchor} 步之后`) +
      ` · 已捕获 ${
        recordingMode === "replace"
          ? macroActionsFromSteps(macroRecorder.steps).length
          : macroRecorder.steps.length
      } 个${recordingMode === "replace" ? "完整动作" : "状态片段"}；完成后写入开发板。`;
  } else {
    elements.recordingStatus.textContent = customMacro ? "自定义宏已保存" : "等待录制";
    elements.recordingStatus.dataset.state = customMacro ? "saved" : "idle";
    elements.recordingDetail.textContent = customMacro
      ? `当前板载宏共 ${stepCount} 步，断电重启后仍会保留。`
      : "开始录制会停止当前循环；随后使用下方手动按键，网页会记录按下、松开与间隔。";
  }

  if (lastSentAxes || lastAppliedAxes) {
    const sent = lastSentAxes
      ? `TX L${lastSentAxes.leftX},${lastSentAxes.leftY} R${lastSentAxes.rightX},${lastSentAxes.rightY}`
      : "TX --";
    const applied = lastAppliedAxes
      ? `ESP L${lastAppliedAxes.leftX},${lastAppliedAxes.leftY} R${lastAppliedAxes.rightX},${lastAppliedAxes.rightY} HID:${lastAppliedAxes.hidSent ? "OK" : "FAIL"}`
      : "ESP --";
    elements.stickDiagnostic.textContent = `${sent} · ${applied}`;
  } else {
    elements.stickDiagnostic.textContent = "等待 ESP32 回显";
  }
}

function currentAxes() {
  return {
    leftX: stickState.left.x,
    leftY: stickState.left.y,
    rightX: stickState.right.x,
    rightY: stickState.right.y,
  };
}

function currentManualReport() {
  return buildManualReport(activeManualControls, currentAxes());
}

function sendManualState(errorMessage = "手动输入发送失败") {
  const report = currentManualReport();
  lastSentAxes = report;
  macroRecorder.capture(report);
  if (connected) {
    deviceState = "idle";
    devicePhase = "idle";
    setError();
  }
  render();
  if (!connected || !transport) {
    return;
  }
  transport.send(report.command).catch((error) => {
    setError(error?.message || errorMessage);
    render();
  });
}

function applyDeviceMessage(message) {
  if (!message) {
    return;
  }
  if (message.type === "macro" && pendingMacroResponse) {
    if (message.ok === false) {
      pendingMacroResponse.reject(
        new Error(`宏更新失败：${message.error || "未知错误"}`),
      );
    } else if (message.action === pendingMacroResponse.action) {
      pendingMacroResponse.resolve(message);
    }
  }
  if (message.type === "error" && pendingMacroResponse) {
    pendingMacroResponse.reject(new Error(message.message || "设备拒绝了这条指令"));
  }
  if (message.ok === false) {
    if (message?.message) {
      setError(message.message);
    } else if (message.type === "macro") {
      setError(`宏更新失败：${message.error || "未知错误"}`);
    }
    return;
  }
  if (message.type !== "info" && message.type !== "status") {
    if (message.type === "macro_list") {
      activeMacroId = message.active === "custom" ? "custom" : "original";
      customMacroSteps = Number(message.custom_steps) || 0;
      const hasCustom = Boolean(message.custom_available);
      elements.macroSelect.replaceChildren();
      const originalOption = new Option(
        `原始素材宏 · ${Number(message.original_steps) || 48} 步`,
        "original",
      );
      elements.macroSelect.add(originalOption);
      if (hasCustom) {
        elements.macroSelect.add(
          new Option(`自定义宏 · ${customMacroSteps} 步`, "custom"),
        );
      }
      elements.macroSelect.value = activeMacroId;
      render();
    }
    if (message.type === "report") {
      lastAppliedAxes = {
        leftX: Number(message.left_x),
        leftY: Number(message.left_y),
        rightX: Number(message.right_x),
        rightY: Number(message.right_y),
        hidSent: Boolean(message.hid_sent),
      };
      render();
    }
    if (message.type === "macro") {
      if (message.ok === false) {
        setError(`宏更新失败：${message.error || "未知错误"}`);
      } else if (message.action === "commit" || message.action === "reset") {
        customMacro = Boolean(message.custom);
        stepCount = Number(message.steps) || stepCount;
        if (message.action === "reset") {
          currentStep = 0;
          lastRunningStep = 0;
        }
      }
      render();
    }
    return;
  }

  deviceState = message.state === "running" ? "running" : "idle";
  devicePhase = message.phase || "idle";
  const reportedStep = Number(message.step) || 0;
  if (deviceState === "running" && devicePhase === "steps" && reportedStep > 0) {
    currentStep = reportedStep;
    lastRunningStep = reportedStep;
  } else {
    currentStep = lastRunningStep;
  }
  stepCount = Number(message.steps) || 48;
  customMacro = Boolean(message.custom);
  activeMacroId = customMacro ? "custom" : "original";
  if (
    customMacro &&
    ![...elements.macroSelect.options].some(
      (option) => option.value === "custom",
    )
  ) {
    elements.macroSelect.add(
      new Option(`当前自定义宏 · ${stepCount} 步`, "custom"),
    );
    elements.macroSelect.value = "custom";
  }
  elements.statusBadge.dataset.cycle = String(Number(message.cycle) || 0);
  if (Number.isFinite(message.cycle_ms)) {
    elements.durationText.textContent = formatDuration(message.cycle_ms);
  }
  setError();
  render();
}

function onLine(line) {
  applyDeviceMessage(parseDeviceLine(line));
}

function onManualInputChange(activeControls) {
  activeManualControls = activeControls;
  sendManualState();
}

function onUnexpectedDisconnect(error) {
  connected = false;
  busy = false;
  clearInterval(pollTimer);
  pollTimer = null;
  manualInputState.clear();
  resetAllSticks(false);
  setError(error?.message || "串口连接意外断开");
  render();
}

async function connect() {
  busy = true;
  setError();
  render();
  transport = new TransportClass({
    onLine,
    onDisconnect: onUnexpectedDisconnect,
  });
  try {
    await transport.connect();
    connected = true;
    await transport.send("HELLO");
    await transport.send("MACRO_LIST");
    pollTimer = window.setInterval(() => {
      transport?.send("STATUS").catch(onUnexpectedDisconnect);
    }, 1000);
  } catch (error) {
    connected = false;
    transport = null;
    setError(error?.message || "无法连接串口");
  } finally {
    busy = false;
    render();
  }
}

async function disconnect() {
  busy = true;
  clearInterval(pollTimer);
  pollTimer = null;
  resetAllSticks();
  manualInputState.clear();
  render();
  try {
    await transport?.disconnect();
  } catch (error) {
    setError(error?.message || "断开串口时发生错误");
  } finally {
    connected = false;
    transport = null;
    busy = false;
    render();
  }
}

async function sendCommand(command) {
  busy = true;
  setError();
  render();
  try {
    await transport.send(command);
  } catch (error) {
    setError(error?.message || "指令发送失败");
  } finally {
    busy = false;
    render();
  }
}

async function sendMacroCommand(command, expectedAction) {
  const response = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error(`ESP32 未确认 ${command}`)),
      3000,
    );
    pendingMacroResponse = {
      action: expectedAction,
      dispose: () => window.clearTimeout(timeout),
      resolve: (message) => {
        window.clearTimeout(timeout);
        resolve(message);
      },
      reject: (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    };
  });
  try {
    await transport.send(command);
    return await response;
  } finally {
    pendingMacroResponse?.dispose();
    pendingMacroResponse = null;
  }
}

elements.connectionButton.addEventListener("click", () => {
  if (connected) {
    disconnect();
  } else {
    connect();
  }
});
elements.startButton.addEventListener("click", () => {
  currentStep = 0;
  lastRunningStep = 0;
  sendCommand("START");
});
elements.stopButton.addEventListener("click", () => sendCommand("STOP"));
elements.macroSelect.addEventListener("change", render);
elements.selectMacroButton.addEventListener("click", async () => {
  if (!transport || busy) {
    return;
  }
  currentStep = 0;
  lastRunningStep = 0;
  await sendCommand(`MACRO_SELECT ${elements.macroSelect.value.toUpperCase()}`);
  await transport.send("MACRO_LIST").catch(() => {});
});

async function beginRecording(mode) {
  if (!connected || !transport || busy) {
    return;
  }
  recordingMode = mode;
  recordingAnchor =
    mode === "replace" ? 0 : Math.max(0, Math.min(currentStep, stepCount));
  macroRecorder.start(recordingAnchor);
  activeManualControls = new Set();
  setError();
  render();
  try {
    await transport.send("STOP");
  } catch (error) {
    macroRecorder.reset();
    setError(error?.message || "无法开始宏录制");
    render();
  }
}

elements.recordButton.addEventListener("click", () => {
  beginRecording("insert");
});
elements.newMacroRecordButton.addEventListener("click", () => {
  beginRecording("replace");
});

elements.uploadRecordingButton.addEventListener("click", async () => {
  if (!macroRecorder.recording || !transport || busy) {
    return;
  }
  resetAllSticks();
  manualInputState.clear();
  const recordedSteps = macroRecorder.finish();
  const recordedActions =
    recordingMode === "replace" ? macroActionsFromSteps(recordedSteps) : [];
  const hasInput = recordedSteps.some(
    ({ report }) =>
      report.buttons !== 0 ||
      report.dpad !== 15 ||
      report.leftX !== 128 ||
      report.leftY !== 128 ||
      report.rightX !== 128 ||
      report.rightY !== 128,
  );
  if (!hasInput) {
    macroRecorder.reset();
    setError("没有录到按键或方向输入，未修改宏。");
    render();
    return;
  }
  const maximumRecordingSteps =
    recordingMode === "replace" ? 500 : Math.min(500 - stepCount, 500);
  const recordingSize =
    recordingMode === "replace" ? recordedActions.length : recordedSteps.length;
  if (recordingSize > maximumRecordingSteps) {
    macroRecorder.reset();
    setError(
      `录制产生了 ${recordingSize} 个${recordingMode === "replace" ? "完整动作" : "状态片段"}，当前模式最多允许 ${maximumRecordingSteps} 个。`,
    );
    render();
    return;
  }
  busy = true;
  setError();
  render();
  try {
    let confirmation = null;
    const uploadCommands =
      recordingMode === "replace"
        ? macroActionUploadCommands(recordedActions)
        : macroUploadCommands(recordingAnchor, recordedSteps);
    for (const command of uploadCommands) {
      const expectedAction = command.startsWith("MACRO_ACTION_BEGIN")
        ? "action_begin"
        : command.startsWith("MACRO_BEGIN")
          ? "begin"
        : command.startsWith("MACRO_ACTION ")
          ? "action"
        : command.startsWith("MACRO_STEP")
          ? "step"
          : command === "MACRO_ACTION_COMMIT"
            ? "action_commit"
            : "commit";
      confirmation = await sendMacroCommand(command, expectedAction);
    }
    customMacro = Boolean(confirmation.custom);
    stepCount = Number(confirmation.steps) || stepCount;
    elements.recordingDetail.textContent =
      recordingMode === "replace"
        ? `已创建并写入 ${recordedActions.length} 个完整动作。`
        : `已上传 ${recordedSteps.length} 个步骤，插入在第 ${recordingAnchor} 步之后。`;
    await transport.send("STATUS");
    await transport.send("MACRO_LIST");
  } catch (error) {
    await transport.send("MACRO_CANCEL").catch(() => {});
    setError(error?.message || "宏上传失败");
  } finally {
    busy = false;
    render();
  }
});

elements.cancelRecordingButton.addEventListener("click", () => {
  resetAllSticks();
  manualInputState.clear();
  macroRecorder.reset();
  setError();
  render();
});

elements.resetMacroButton.addEventListener("click", async () => {
  if (!transport || busy) {
    return;
  }
  await sendCommand("MACRO_RESET");
});

function setStickPosition(name, vector, pad, send = true) {
  stickState[name].x = vector.x;
  stickState[name].y = vector.y;
  const maxOffset = pad.clientWidth * 0.3;
  const knob = pad.querySelector("[data-stick-knob]");
  knob.style.transform =
    `translate(-50%, -50%) translate(` +
    `${vector.normalizedX * maxOffset}px, ${vector.normalizedY * maxOffset}px)`;
  const output = document.querySelector(`[data-testid="${name}-stick-value"]`);
  output.textContent = `${vector.x}, ${vector.y}`;
  if (send) {
    sendManualState("摇杆输入发送失败");
  } else {
    render();
  }
}

function centerStick(name, pad, send = true) {
  pad.dataset.active = "false";
  setStickPosition(
    name,
    { x: 128, y: 128, normalizedX: 0, normalizedY: 0 },
    pad,
    send,
  );
}

function resetAllSticks(send = true) {
  const hadAnalogInput = !sticksCentered(stickState);
  for (const pad of stickPads) {
    centerStick(pad.dataset.stick, pad, false);
  }
  if (send && hadAnalogInput) {
    sendManualState("摇杆回中发送失败");
  }
}

const activeStickPointers = new Map();

function updateStickFromPointer(name, pad, event) {
    const vector = stickVectorFromPoint(
      event.clientX,
      event.clientY,
      pad.getBoundingClientRect(),
    );
    setStickPosition(name, vector, pad);
}

for (const pad of stickPads) {
  const name = pad.dataset.stick;

  pad.addEventListener("pointerdown", (event) => {
    if (!connected || busy || activeStickPointers.has(event.pointerId)) {
      return;
    }
    event.preventDefault();
    activeStickPointers.set(event.pointerId, { name, pad });
    pad.dataset.active = "true";
    updateStickFromPointer(name, pad, event);
  });
  pad.addEventListener("contextmenu", (event) => event.preventDefault());
}

window.addEventListener(
  "pointermove",
  (event) => {
    const activeStick = activeStickPointers.get(event.pointerId);
    if (!activeStick) {
      return;
    }
    event.preventDefault();
    updateStickFromPointer(activeStick.name, activeStick.pad, event);
  },
  { passive: false },
);

function releaseStickPointer(event) {
  const activeStick = activeStickPointers.get(event.pointerId);
  if (!activeStick) {
    return;
  }
  activeStickPointers.delete(event.pointerId);
  centerStick(activeStick.name, activeStick.pad);
}

window.addEventListener("pointerup", releaseStickPointer);
window.addEventListener("pointercancel", releaseStickPointer);

function pointerSource(pointerId) {
  return `pointer:${pointerId}`;
}

for (const button of manualButtons) {
  const control = button.dataset.control;
  button.addEventListener("pointerdown", (event) => {
    if (
      !connected ||
      busy ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) {
      return;
    }
    event.preventDefault();
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is optional; window blur still releases all controls.
    }
    manualInputState.press(pointerSource(event.pointerId), control);
  });

  const releasePointer = (event) => {
    manualInputState.release(pointerSource(event.pointerId));
  };
  button.addEventListener("pointerup", releasePointer);
  button.addEventListener("pointercancel", releasePointer);
  button.addEventListener("lostpointercapture", releasePointer);
  button.addEventListener("contextmenu", (event) => event.preventDefault());

  button.addEventListener("keydown", (event) => {
    if (
      !connected ||
      busy ||
      (event.code !== "Space" && event.code !== "Enter")
    ) {
      return;
    }
    event.preventDefault();
    manualInputState.press(
      `button:${control}:${event.code}`,
      control,
    );
  });
  button.addEventListener("keyup", (event) => {
    if (event.code !== "Space" && event.code !== "Enter") {
      return;
    }
    event.preventDefault();
    manualInputState.release(`button:${control}:${event.code}`);
  });
  button.addEventListener("blur", () => {
    manualInputState.release(`button:${control}:Space`);
    manualInputState.release(`button:${control}:Enter`);
  });
}

window.addEventListener("keydown", (event) => {
  const control = KEYBOARD_BINDINGS[event.code];
  if (
    !control ||
    !connected ||
    busy ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  ) {
    return;
  }
  event.preventDefault();
  manualInputState.press(`keyboard:${event.code}`, control);
});

window.addEventListener("keyup", (event) => {
  const source = `keyboard:${event.code}`;
  if (!manualInputState.hasSource(source)) {
    return;
  }
  event.preventDefault();
  manualInputState.release(source);
});

window.addEventListener("blur", () => {
  manualInputState.clear();
  resetAllSticks();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    manualInputState.clear();
    resetAllSticks();
  }
});

function gamepadSource(index, control) {
  return `gamepad:${index}:${control}`;
}

function releaseGamepadButtons(index) {
  for (const control of Object.values(GAMEPAD_BUTTON_BINDINGS)) {
    manualInputState.release(gamepadSource(index, control));
  }
}

function pollPhysicalGamepad() {
  const gamepads = navigator.getGamepads?.() || [];
  const gamepad =
    (activeGamepadIndex !== null && gamepads[activeGamepadIndex]) ||
    [...gamepads].find((candidate) => candidate?.connected);

  if (!gamepad) {
    if (activeGamepadIndex !== null) {
      releaseGamepadButtons(activeGamepadIndex);
      activeGamepadIndex = null;
    }
    elements.gamepadStatus.textContent = navigator.getGamepads
      ? "实体手柄：等待连接"
      : "实体手柄：浏览器不支持";
    if (gamepadAxesActive && activeStickPointers.size === 0) {
      gamepadAxesActive = false;
      resetAllSticks();
    }
    window.requestAnimationFrame(pollPhysicalGamepad);
    return;
  }

  if (activeGamepadIndex !== null && activeGamepadIndex !== gamepad.index) {
    releaseGamepadButtons(activeGamepadIndex);
  }
  activeGamepadIndex = gamepad.index;
  elements.gamepadStatus.textContent = `实体手柄：${gamepad.id || `#${gamepad.index}`}`;
  const snapshot = gamepadSnapshot(gamepad);

  if (activeStickPointers.size === 0) {
    const axesChanged =
      stickState.left.x !== snapshot.left.x ||
      stickState.left.y !== snapshot.left.y ||
      stickState.right.x !== snapshot.right.x ||
      stickState.right.y !== snapshot.right.y;
    if (axesChanged) {
      setStickPosition("left", snapshot.left, stickPads[0], false);
      setStickPosition("right", snapshot.right, stickPads[1], false);
      gamepadAxesActive =
        snapshot.left.x !== 128 ||
        snapshot.left.y !== 128 ||
        snapshot.right.x !== 128 ||
        snapshot.right.y !== 128;
      sendManualState("实体手柄摇杆输入发送失败");
    }
  }

  for (const control of Object.values(GAMEPAD_BUTTON_BINDINGS)) {
    const source = gamepadSource(gamepad.index, control);
    if (snapshot.controls.has(control)) {
      manualInputState.press(source, control);
    } else {
      manualInputState.release(source);
    }
  }
  window.requestAnimationFrame(pollPhysicalGamepad);
}

window.requestAnimationFrame(pollPhysicalGamepad);

if (!transportSupported) {
  elements.connectionButton.disabled = true;
  elements.browserNote.textContent =
    "当前浏览器不支持 Web Serial。请用桌面版 Chrome 或 Edge，并通过 localhost 打开本页。";
  elements.browserNote.dataset.warning = "true";
} else if (mockMode) {
  elements.browserNote.textContent =
    "DEMO MODE · 正在使用模拟串口，不会连接真实设备";
}

render();
