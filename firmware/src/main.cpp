#include <Arduino.h>

#include <stdio.h>
#include <string.h>

#include "ControllerReport.h"
#include "MaterialFarmMacro.h"
#include "MacroEngine.h"
#include "switch_ESP32.h"

/*
 * Hardware topology:
 *   ESP32-S3 native USB (GPIO19 D-, GPIO20 D+) -> Nintendo Switch dock
 *   ESP32-S3 UART0 through the board's USB-UART bridge -> browser/PC
 *
 * This deliberately uses a UART-backed serial port. The native USB peripheral
 * is reserved for switch_ESP32's Nintendo Switch HID device.
 */
#ifndef ATT_CONTROL_SERIAL
#define ATT_CONTROL_SERIAL Serial
#endif

namespace {

constexpr uint32_t kControlBaudRate = 115200;
constexpr char kFirmwareVersion[] = "SplatoonFarmers/1.0.0";

NSGamepad Gamepad;
farmers::MacroEngine Macro(
    farmers::kMaterialFarmMacro, farmers::kMaterialFarmStepCount,
    farmers::kMaterialFarmLoopGapMs, true);

char LineBuffer[128];
size_t LineLength = 0;
bool LineOverflow = false;

uint8_t clampAxis(unsigned long value) {
  return value > 255 ? 255 : static_cast<uint8_t>(value);
}

uint8_t normalizeDpad(unsigned long value) {
  if (value <= NSGAMEPAD_DPAD_UP_LEFT ||
      value == NSGAMEPAD_DPAD_CENTERED) {
    return static_cast<uint8_t>(value);
  }
  return NSGAMEPAD_DPAD_CENTERED;
}

void applyReport(const farmers::ControllerReport& report) {
  Gamepad.buttons(report.buttons & 0x3fff);
  Gamepad.dPad(normalizeDpad(report.dpad));
  Gamepad.leftXAxis(report.leftX);
  Gamepad.leftYAxis(report.leftY);
  Gamepad.rightXAxis(report.rightX);
  Gamepad.rightYAxis(report.rightY);
  Gamepad.write();
}

void applyRawReport(unsigned long buttons, unsigned long dpad,
                    unsigned long leftX, unsigned long leftY,
                    unsigned long rightX, unsigned long rightY) {
  const farmers::ControllerReport report{
      static_cast<uint16_t>(buttons & 0x3fff),
      normalizeDpad(dpad),
      clampAxis(leftX),
      clampAxis(leftY),
      clampAxis(rightX),
      clampAxis(rightY),
  };
  applyReport(report);
}

const char* phaseName(farmers::MacroPhase phase) {
  switch (phase) {
    case farmers::MacroPhase::kSteps:
      return "steps";
    case farmers::MacroPhase::kLoopGap:
      return "gap";
    default:
      return "idle";
  }
}

void emitState(const char* type) {
  const size_t visibleStep =
      Macro.phase() == farmers::MacroPhase::kSteps ? Macro.stepIndex() + 1 : 0;
  ATT_CONTROL_SERIAL.printf(
      "{\"type\":\"%s\",\"ok\":true,\"firmware\":\"%s\","
      "\"routine\":\"material-farm\",\"embedded\":true,\"state\":\"%s\","
      "\"phase\":\"%s\",\"step\":%u,\"steps\":%u,\"cycle\":%lu,"
      "\"duration_ms\":%lu,\"loop_gap_ms\":%lu,\"cycle_ms\":%lu}\n",
      type, kFirmwareVersion, Macro.running() ? "running" : "idle",
      phaseName(Macro.phase()), static_cast<unsigned int>(visibleStep),
      static_cast<unsigned int>(farmers::kMaterialFarmStepCount),
      static_cast<unsigned long>(Macro.cycleCount()),
      static_cast<unsigned long>(farmers::kMaterialFarmDurationMs),
      static_cast<unsigned long>(farmers::kMaterialFarmLoopGapMs),
      static_cast<unsigned long>(farmers::kMaterialFarmCycleMs));
}

void flushMacroReport() {
  if (Macro.consumeReportChanged()) {
    applyReport(Macro.report());
  }
}

void handleLine(char* line) {
  if (strcmp(line, "PING") == 0) {
    ATT_CONTROL_SERIAL.println("PONG");
    return;
  }
  if (strcmp(line, "HELLO") == 0 || strcmp(line, "INFO") == 0) {
    emitState("info");
    return;
  }
  if (strcmp(line, "STATUS") == 0) {
    emitState("status");
    return;
  }
  if (strcmp(line, "START") == 0) {
    Macro.start(millis());
    flushMacroReport();
    emitState("status");
    return;
  }
  if (strcmp(line, "STOP") == 0) {
    Macro.stop();
    flushMacroReport();
    emitState("status");
    return;
  }

  char command[8] = {0};
  unsigned long buttons = 0;
  unsigned long dpad = NSGAMEPAD_DPAD_CENTERED;
  unsigned long leftX = farmers::kAxisCentered;
  unsigned long leftY = farmers::kAxisCentered;
  unsigned long rightX = farmers::kAxisCentered;
  unsigned long rightY = farmers::kAxisCentered;
  const int parsed =
      sscanf(line, "%7s %lu %lu %lu %lu %lu %lu", command, &buttons, &dpad,
             &leftX, &leftY, &rightX, &rightY);

  if (parsed == 7 &&
      (strcmp(command, "R") == 0 || strcmp(command, "REPORT") == 0)) {
    // Raw reports power manual input and leave a fallback path for future
    // computer-loaded routines. Entering this mode stops the embedded routine.
    Macro.stop();
    Macro.consumeReportChanged();
    applyRawReport(buttons, dpad, leftX, leftY, rightX, rightY);
    ATT_CONTROL_SERIAL.println("OK");
    return;
  }

  ATT_CONTROL_SERIAL.println("ERR");
}

void readControlSerial() {
  while (ATT_CONTROL_SERIAL.available() > 0) {
    const char character = static_cast<char>(ATT_CONTROL_SERIAL.read());
    if (character == '\n' || character == '\r') {
      if (LineOverflow) {
        ATT_CONTROL_SERIAL.println("ERR");
      } else if (LineLength > 0) {
        LineBuffer[LineLength] = '\0';
        handleLine(LineBuffer);
      }
      LineLength = 0;
      LineOverflow = false;
      continue;
    }

    if (LineOverflow) {
      continue;
    }
    if (LineLength < sizeof(LineBuffer) - 1) {
      LineBuffer[LineLength++] = character;
    } else {
      LineOverflow = true;
    }
  }
}

}  // namespace

void setup() {
  ATT_CONTROL_SERIAL.begin(kControlBaudRate);
  Gamepad.begin();
  USB.begin();
  applyReport(farmers::kNeutralReport);
}

void loop() {
  readControlSerial();
  Macro.tick(millis());
  flushMacroReport();
  Gamepad.loop();
}
