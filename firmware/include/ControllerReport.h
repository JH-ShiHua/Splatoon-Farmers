#pragma once

#include <stdint.h>

namespace farmers {

constexpr uint8_t kDpadCentered = 15;
constexpr uint8_t kAxisCentered = 128;

struct ControllerReport {
  uint16_t buttons;
  uint8_t dpad;
  uint8_t leftX;
  uint8_t leftY;
  uint8_t rightX;
  uint8_t rightY;
};

constexpr bool operator==(const ControllerReport& lhs,
                          const ControllerReport& rhs) {
  return lhs.buttons == rhs.buttons && lhs.dpad == rhs.dpad &&
         lhs.leftX == rhs.leftX && lhs.leftY == rhs.leftY &&
         lhs.rightX == rhs.rightX && lhs.rightY == rhs.rightY;
}

constexpr bool operator!=(const ControllerReport& lhs,
                          const ControllerReport& rhs) {
  return !(lhs == rhs);
}

constexpr ControllerReport kNeutralReport{
    0, kDpadCentered, kAxisCentered, kAxisCentered, kAxisCentered,
    kAxisCentered};

}  // namespace farmers
