import { DEVICE_BAUD_RATE } from "./protocol.js";

export class SerialTransport {
  constructor({ onLine, onDisconnect }) {
    this.onLine = onLine;
    this.onDisconnect = onDisconnect;
    this.port = null;
    this.reader = null;
    this.readTask = null;
    this.writeChain = Promise.resolve();
    this.connected = false;
    this.intentionalClose = false;
  }

  static isSupported() {
    return "serial" in navigator;
  }

  async connect() {
    if (!SerialTransport.isSupported()) {
      throw new Error("当前浏览器不支持 Web Serial，请使用桌面版 Chrome 或 Edge。");
    }

    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: DEVICE_BAUD_RATE, bufferSize: 255 });
    try {
      await this.port.setSignals({
        dataTerminalReady: false,
        requestToSend: false,
      });
    } catch {
      // Some USB-UART drivers do not expose modem control lines. The data
      // channel still works, and avoiding a hard failure is safer here.
    }
    this.intentionalClose = false;
    this.connected = true;
    this.readTask = this.readLoop();
  }

  send(command) {
    const write = async () => {
      if (!this.connected || !this.port?.writable) {
        throw new Error("串口尚未连接");
      }
      const writer = this.port.writable.getWriter();
      try {
        await writer.write(new TextEncoder().encode(`${command}\n`));
      } finally {
        writer.releaseLock();
      }
    };
    const result = this.writeChain.then(write, write);
    this.writeChain = result.catch(() => {});
    return result;
  }

  async disconnect() {
    if (!this.port) {
      return;
    }
    this.intentionalClose = true;
    this.connected = false;

    await this.writeChain.catch(() => {});
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        // The physical port may already be gone.
      }
    }
    if (this.readTask) {
      try {
        await this.readTask;
      } catch {
        // readLoop reports unexpected failures through onDisconnect.
      }
    }
    try {
      await this.port.close();
    } finally {
      this.port = null;
      this.readTask = null;
      this.intentionalClose = false;
    }
  }

  async readLoop() {
    let buffered = "";
    try {
      while (this.connected && this.port?.readable) {
        this.reader = this.port.readable.getReader();
        try {
          while (this.connected) {
            const { value, done } = await this.reader.read();
            if (done) {
              break;
            }
            buffered += new TextDecoder().decode(value, { stream: true });
            const lines = buffered.split(/\r?\n/);
            buffered = lines.pop() ?? "";
            for (const line of lines) {
              if (line.trim()) {
                this.onLine(line);
              }
            }
          }
        } finally {
          this.reader.releaseLock();
          this.reader = null;
        }
      }
    } catch (error) {
      if (!this.intentionalClose && this.connected) {
        this.connected = false;
        this.onDisconnect(error);
      }
      return;
    }

    if (!this.intentionalClose && this.connected) {
      this.connected = false;
      this.onDisconnect(new Error("串口数据流已经断开"));
    }
  }
}

export class MockSerialTransport {
  constructor({ onLine, onDisconnect }) {
    this.onLine = onLine;
    this.onDisconnect = onDisconnect;
    this.connected = false;
    this.state = "idle";
    this.phase = "idle";
    this.step = 0;
    this.cycle = 0;
    this.lastReport = null;
    this.custom = false;
    this.customAvailable = false;
    this.customSteps = 0;
    this.steps = 48;
    this.pendingMacro = null;
    this.activeMacro = "original";
  }

  static isSupported() {
    return true;
  }

  async connect() {
    this.connected = true;
  }

  async send(command) {
    if (!this.connected) {
      throw new Error("模拟串口尚未连接");
    }
    if (command === "START") {
      this.state = "running";
      this.phase = "steps";
      this.step = 1;
      this.emit("status");
    } else if (command === "STOP") {
      this.state = "idle";
      this.phase = "idle";
      this.step = 0;
      this.emit("status");
    } else if (command === "HELLO" || command === "INFO") {
      this.emit("info");
    } else if (command === "STATUS") {
      this.emit("status");
    } else if (command === "MACRO_LIST") {
      this.emitMacroList();
    } else if (command === "MACRO_SELECT ORIGINAL") {
      this.activeMacro = "original";
      this.custom = false;
      this.steps = 48;
      this.emitMacroList();
      this.emit("status");
    } else if (command === "MACRO_SELECT CUSTOM") {
      if (!this.customAvailable) {
        this.emitMacro("select", false, "custom_not_found");
      } else {
        this.activeMacro = "custom";
        this.custom = true;
        this.steps = this.customSteps;
        this.emitMacroList();
        this.emit("status");
      }
    } else if (command === "PING") {
      this.onLine("PONG");
    } else if (/^R \d+ \d+ \d+ \d+ \d+ \d+$/.test(command)) {
      this.state = "idle";
      this.phase = "idle";
      this.step = 0;
      this.lastReport = command;
      const [, buttons, dpad, leftX, leftY, rightX, rightY] = command
        .split(" ")
        .map(Number);
      this.onLine(
        JSON.stringify({
          type: "report",
          ok: true,
          hid_sent: true,
          buttons,
          dpad,
          left_x: leftX,
          left_y: leftY,
          right_x: rightX,
          right_y: rightY,
        }),
      );
    } else if (/^MACRO_BEGIN \d+ \d+$/.test(command)) {
      const [, anchor, count] = command.split(" ").map(Number);
      this.pendingMacro = { anchor, count, received: 0 };
      this.emitMacro("begin", true);
    } else if (/^MACRO_STEP \d+ \d+ \d+ \d+ \d+ \d+ \d+$/.test(command)) {
      if (!this.pendingMacro) {
        this.emitMacro("step", false, "invalid_step");
      } else {
        this.pendingMacro.received += 1;
        this.emitMacro("step", true);
      }
    } else if (command === "MACRO_COMMIT") {
      if (
        !this.pendingMacro ||
        this.pendingMacro.received !== this.pendingMacro.count
      ) {
        this.emitMacro("commit", false, "incomplete_upload");
      } else {
        this.steps += this.pendingMacro.count;
        this.pendingMacro = null;
        this.custom = true;
        this.customAvailable = true;
        this.customSteps = this.steps;
        this.activeMacro = "custom";
        this.emitMacro("commit", true);
        this.emit("status");
      }
    } else if (command === "MACRO_CANCEL") {
      this.pendingMacro = null;
      this.emitMacro("cancel", true);
    } else if (command === "MACRO_RESET") {
      this.pendingMacro = null;
      this.custom = false;
      this.customAvailable = false;
      this.customSteps = 0;
      this.activeMacro = "original";
      this.steps = 48;
      this.emitMacro("reset", true);
      this.emit("status");
    } else {
      this.onLine("ERR");
    }
  }

  async disconnect() {
    this.connected = false;
  }

  emit(type) {
    this.onLine(
      JSON.stringify({
        type,
        ok: true,
        firmware: "SplatoonFarmers/mock",
        routine: "material-farm",
        embedded: true,
        custom: this.custom,
        state: this.state,
        phase: this.phase,
        step: this.step,
        steps: this.steps,
        cycle: this.cycle,
        duration_ms: 61010,
        loop_gap_ms: 2585,
        cycle_ms: 63595,
      }),
    );
  }

  emitMacroList() {
    this.onLine(
      JSON.stringify({
        type: "macro_list",
        ok: true,
        active: this.activeMacro,
        original_steps: 48,
        custom_available: this.customAvailable,
        custom_steps: this.customAvailable ? this.customSteps : 0,
      }),
    );
  }

  emitMacro(action, ok, error = "") {
    this.onLine(
      JSON.stringify({
        type: "macro",
        ok,
        action,
        error,
        steps: this.steps,
        custom: this.custom,
      }),
    );
  }
}
