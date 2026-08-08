#include <Arduino.h>
#include <Preferences.h>

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
constexpr size_t kMaxMacroSteps = 160;
constexpr size_t kMaxUploadedSteps = 96;
constexpr uint32_t kMaxStepDurationMs = 600000;

NSGamepad Gamepad;
farmers::MacroStep ActiveMacro[kMaxMacroSteps];
farmers::MacroStep UploadedSteps[kMaxUploadedSteps];
size_t ActiveMacroStepCount = 0;
size_t UploadedStepCount = 0;
size_t UploadExpectedCount = 0;
size_t UploadAnchor = 0;
bool UploadActive = false;
bool CustomMacroLoaded = false;
bool SavedCustomAvailable = false;
Preferences MacroPreferences;
farmers::MacroEngine Macro(ActiveMacro, 0, farmers::kMaterialFarmLoopGapMs,
                           true);

char LineBuffer[128];
size_t LineLength = 0;
bool LineOverflow = false;

uint32_t activeMacroDurationMs() {
  uint32_t total = 0;
  for (size_t index = 0; index < ActiveMacroStepCount; ++index) {
    total += ActiveMacro[index].durationMs;
  }
  return total;
}

void loadEmbeddedMacro() {
  memcpy(ActiveMacro, farmers::kMaterialFarmMacro,
         sizeof(farmers::kMaterialFarmMacro));
  ActiveMacroStepCount = farmers::kMaterialFarmStepCount;
  CustomMacroLoaded = false;
}

bool loadSavedMacro() {
  const size_t savedCount = MacroPreferences.getUShort("count", 0);
  const size_t savedBytes = MacroPreferences.getBytesLength("steps");
  if (savedCount == 0 || savedCount > kMaxMacroSteps ||
      savedBytes != savedCount * sizeof(farmers::MacroStep)) {
    return false;
  }
  if (MacroPreferences.getBytes("steps", ActiveMacro, savedBytes) !=
      savedBytes) {
    return false;
  }
  for (size_t index = 0; index < savedCount; ++index) {
    if (ActiveMacro[index].durationMs == 0 ||
        ActiveMacro[index].durationMs > kMaxStepDurationMs) {
      return false;
    }
  }
  ActiveMacroStepCount = savedCount;
  CustomMacroLoaded = true;
  SavedCustomAvailable = true;
  return true;
}

bool saveActiveMacro() {
  const size_t bytes = ActiveMacroStepCount * sizeof(farmers::MacroStep);
  if (MacroPreferences.putBytes("steps", ActiveMacro, bytes) != bytes) {
    return false;
  }
  const bool saved = MacroPreferences.putUShort(
             "count", static_cast<uint16_t>(ActiveMacroStepCount)) ==
         sizeof(uint16_t);
  SavedCustomAvailable = saved;
  return saved;
}

void emitMacroList() {
  const size_t savedCount = MacroPreferences.getUShort("count", 0);
  ATT_CONTROL_SERIAL.printf(
      "{\"type\":\"macro_list\",\"ok\":true,\"active\":\"%s\"," 
      "\"original_steps\":%u,\"custom_available\":%s,\"custom_steps\":%u}\n",
      CustomMacroLoaded ? "custom" : "original",
      static_cast<unsigned int>(farmers::kMaterialFarmStepCount),
      SavedCustomAvailable ? "true" : "false",
      static_cast<unsigned int>(SavedCustomAvailable ? savedCount : 0));
}

void emitMacroResult(bool ok, const char* action, const char* error = "") {
  ATT_CONTROL_SERIAL.printf(
      "{\"type\":\"macro\",\"ok\":%s,\"action\":\"%s\"," 
      "\"error\":\"%s\",\"steps\":%u,\"custom\":%s}\n",
      ok ? "true" : "false", action, error,
      static_cast<unsigned int>(ActiveMacroStepCount),
      CustomMacroLoaded ? "true" : "false");
}

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

bool applyReport(const farmers::ControllerReport& report) {
  Gamepad.buttons(report.buttons & 0x3fff);
  Gamepad.dPad(normalizeDpad(report.dpad));
  Gamepad.leftXAxis(report.leftX);
  Gamepad.leftYAxis(report.leftY);
  Gamepad.rightXAxis(report.rightX);
  Gamepad.rightYAxis(report.rightY);
  return Gamepad.write();
}

bool applyRawReport(unsigned long buttons, unsigned long dpad,
                    unsigned long leftX, unsigned long leftY,
                    unsigned long rightX, unsigned long rightY,
                    farmers::ControllerReport* appliedReport = nullptr) {
  const farmers::ControllerReport report{
      static_cast<uint16_t>(buttons & 0x3fff),
      normalizeDpad(dpad),
      clampAxis(leftX),
      clampAxis(leftY),
      clampAxis(rightX),
      clampAxis(rightY),
  };
  if (appliedReport != nullptr) {
    *appliedReport = report;
  }
  return applyReport(report);
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
      "\"routine\":\"material-farm\",\"embedded\":true,\"custom\":%s,"
      "\"state\":\"%s\"," 
      "\"phase\":\"%s\",\"step\":%u,\"steps\":%u,\"cycle\":%lu,"
      "\"duration_ms\":%lu,\"loop_gap_ms\":%lu,\"cycle_ms\":%lu}\n",
      type, kFirmwareVersion, CustomMacroLoaded ? "true" : "false",
      Macro.running() ? "running" : "idle",
      phaseName(Macro.phase()), static_cast<unsigned int>(visibleStep),
      static_cast<unsigned int>(ActiveMacroStepCount),
      static_cast<unsigned long>(Macro.cycleCount()),
      static_cast<unsigned long>(activeMacroDurationMs()),
      static_cast<unsigned long>(farmers::kMaterialFarmLoopGapMs),
      static_cast<unsigned long>(activeMacroDurationMs() +
                                 farmers::kMaterialFarmLoopGapMs));
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
  if (strcmp(line, "MACRO_LIST") == 0) {
    emitMacroList();
    return;
  }
  if (strcmp(line, "MACRO_SELECT ORIGINAL") == 0) {
    Macro.stop();
    flushMacroReport();
    loadEmbeddedMacro();
    Macro.configure(ActiveMacro, ActiveMacroStepCount,
                    farmers::kMaterialFarmLoopGapMs);
    emitMacroList();
    emitState("status");
    return;
  }
  if (strcmp(line, "MACRO_SELECT CUSTOM") == 0) {
    Macro.stop();
    flushMacroReport();
    if (!loadSavedMacro()) {
      emitMacroResult(false, "select", "custom_not_found");
      return;
    }
    Macro.configure(ActiveMacro, ActiveMacroStepCount,
                    farmers::kMaterialFarmLoopGapMs);
    emitMacroList();
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

  size_t anchor = 0;
  size_t expected = 0;
  if (sscanf(line, "MACRO_BEGIN %u %u", &anchor, &expected) == 2) {
    if (anchor > ActiveMacroStepCount || expected == 0 ||
        expected > kMaxUploadedSteps ||
        ActiveMacroStepCount + expected > kMaxMacroSteps) {
      emitMacroResult(false, "begin", "invalid_size_or_anchor");
      return;
    }
    Macro.stop();
    flushMacroReport();
    UploadAnchor = anchor;
    UploadExpectedCount = expected;
    UploadedStepCount = 0;
    UploadActive = true;
    emitMacroResult(true, "begin");
    return;
  }

  unsigned long duration = 0;
  unsigned long uploadButtons = 0;
  unsigned long uploadDpad = 0;
  unsigned long uploadLeftX = 0;
  unsigned long uploadLeftY = 0;
  unsigned long uploadRightX = 0;
  unsigned long uploadRightY = 0;
  if (sscanf(line, "MACRO_STEP %lu %lu %lu %lu %lu %lu %lu", &duration,
             &uploadButtons, &uploadDpad, &uploadLeftX, &uploadLeftY,
             &uploadRightX, &uploadRightY) == 7) {
    if (!UploadActive || UploadedStepCount >= UploadExpectedCount ||
        duration == 0 || duration > kMaxStepDurationMs) {
      emitMacroResult(false, "step", "invalid_step");
      return;
    }
    UploadedSteps[UploadedStepCount++] = farmers::MacroStep{
        static_cast<uint32_t>(duration),
        farmers::ControllerReport{
            static_cast<uint16_t>(uploadButtons & 0x3fff),
            normalizeDpad(uploadDpad), clampAxis(uploadLeftX),
            clampAxis(uploadLeftY), clampAxis(uploadRightX),
            clampAxis(uploadRightY)}};
    emitMacroResult(true, "step");
    return;
  }

  if (strcmp(line, "MACRO_COMMIT") == 0) {
    if (!UploadActive || UploadedStepCount != UploadExpectedCount) {
      emitMacroResult(false, "commit", "incomplete_upload");
      return;
    }
    const size_t suffixCount = ActiveMacroStepCount - UploadAnchor;
    memmove(&ActiveMacro[UploadAnchor + UploadedStepCount],
            &ActiveMacro[UploadAnchor],
            suffixCount * sizeof(farmers::MacroStep));
    memcpy(&ActiveMacro[UploadAnchor], UploadedSteps,
           UploadedStepCount * sizeof(farmers::MacroStep));
    ActiveMacroStepCount += UploadedStepCount;
    UploadActive = false;
    CustomMacroLoaded = true;
    SavedCustomAvailable = true;
    Macro.configure(ActiveMacro, ActiveMacroStepCount,
                    farmers::kMaterialFarmLoopGapMs);
    if (!saveActiveMacro()) {
      emitMacroResult(false, "commit", "save_failed");
      return;
    }
    emitMacroResult(true, "commit");
    emitState("status");
    return;
  }

  if (strcmp(line, "MACRO_CANCEL") == 0) {
    UploadActive = false;
    UploadedStepCount = 0;
    UploadExpectedCount = 0;
    emitMacroResult(true, "cancel");
    return;
  }

  if (strcmp(line, "MACRO_RESET") == 0) {
    Macro.stop();
    flushMacroReport();
    MacroPreferences.clear();
    SavedCustomAvailable = false;
    loadEmbeddedMacro();
    Macro.configure(ActiveMacro, ActiveMacroStepCount,
                    farmers::kMaterialFarmLoopGapMs);
    UploadActive = false;
    emitMacroResult(true, "reset");
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
    farmers::ControllerReport appliedReport{};
    const bool hidSent =
        applyRawReport(buttons, dpad, leftX, leftY, rightX, rightY,
                       &appliedReport);
    ATT_CONTROL_SERIAL.printf(
        "{\"type\":\"report\",\"ok\":true,\"hid_sent\":%s,"
        "\"buttons\":%u,\"dpad\":%u,\"left_x\":%u,\"left_y\":%u,"
        "\"right_x\":%u,\"right_y\":%u}\n",
        hidSent ? "true" : "false",
        static_cast<unsigned int>(appliedReport.buttons),
        static_cast<unsigned int>(appliedReport.dpad),
        static_cast<unsigned int>(appliedReport.leftX),
        static_cast<unsigned int>(appliedReport.leftY),
        static_cast<unsigned int>(appliedReport.rightX),
        static_cast<unsigned int>(appliedReport.rightY));
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
  MacroPreferences.begin("splatoonfarm", false);
  SavedCustomAvailable =
      MacroPreferences.getUShort("count", 0) > 0 &&
      MacroPreferences.getBytesLength("steps") > 0;
  if (!loadSavedMacro()) {
    loadEmbeddedMacro();
  }
  Macro.configure(ActiveMacro, ActiveMacroStepCount,
                  farmers::kMaterialFarmLoopGapMs);
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
