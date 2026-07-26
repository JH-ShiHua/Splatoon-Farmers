# Splatoon Farmers

An unofficial ESP32-S3 wired controller and browser console for material
farming in [Splatoon Raiders](https://www.nintendo.com/us/store/products/splatoon-raiders-switch-2/).
It is intentionally small: connect the board, open the page, and start the
board-resident routine.

![](./images/banner.png)
Check this video for tutorial: [bilibili](https://www.bilibili.com/video/BV12P3J6hE4h/)

## What it does

- Emulates a wired Nintendo Switch controller over the ESP32-S3 native USB port.
- Keeps the complete 48-step, `63.595 s` loop in firmware Flash.
- Continues a running loop if the browser or USB-UART connection drops.
- Starts, stops, and reports progress through a Web Serial page.
- Provides every digital controller button and D-pad direction for mouse,
  touch, and keyboard input.
- Leaves both analog sticks centered during manual input.

The browser sends only high-level `START`, `STOP`, and status commands during
automatic operation. Timing is owned by the microcontroller, so normal serial
jitter cannot break a sequence halfway through.

## Hardware

The recommended board is an `ESP32-S3-DevKitC-1` with separate native USB and
USB-UART connectors.

| Link | Board connection | Purpose |
| --- | --- | --- |
| Native USB | GPIO19 D- / GPIO20 D+ | Wired controller to the Switch dock |
| USB-UART | UART0 through the onboard bridge | Browser control from the computer |

Both links can stay connected at the same time. See the
[ESP32-S3-DevKitC-1 user guide](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.0.html)
for connector placement.

If the board exposes only native USB, connect an external USB-UART adapter:

- GPIO43 / TX0 to adapter RX
- GPIO44 / RX0 to adapter TX
- GND to GND

Do not connect the adapter VCC when the board is already powered from the
Switch. For the strongest protection against host-side reset signals, use only
TX, RX, and GND.

## Build and flash

Install Python 3 and [PlatformIO Core](https://docs.platformio.org/en/latest/core/index.html):

```bash
python3 -m pip install platformio==6.1.19
pio run
```

The environment targets `ESP32-S3-DevKitC-1-N8`, Arduino-ESP32 2.0.17, and
pins [`switch_ESP32`](https://github.com/esp32beans/switch_ESP32) to a known
working commit. Flash through the board's USB-UART connector:

```bash
pio run -t upload --upload-port /dev/cu.usbserial-XXXX
```

Use a port such as `COM5` on Windows or `/dev/ttyUSB0` on Linux. After flashing:

1. Connect native USB to the Nintendo Switch dock.
2. Connect USB-UART to the computer.
3. Start the local WebUI.

```bash
npm run serve
```

Open <http://localhost:4173> in desktop Chrome or Edge. Web Serial requires a
secure context, so opening `web/index.html` directly is not supported.

## Use

1. Select **连接手柄** and choose the DevKitC-1 USB-UART port.
2. Wait for **已连接 · 待命**.
3. Select **开始刷取**. The routine restarts at step 1 and loops until stopped.
4. Select **停止** to immediately send a neutral controller report.

Disconnecting USB-UART does not stop an already running routine. Reconnect and
stop it, reset the board, or remove power when you need to end it.

### Manual controls

Manual input stops the automatic routine before sending a raw controller
report. Buttons support hold, multi-key combinations, mouse, multitouch, and
keyboard. Losing focus or hiding the tab releases all browser-held inputs.

| Controller | Keyboard | Controller | Keyboard |
| --- | --- | --- | --- |
| X / Y / B / A | I / J / K / L | D-pad | Arrow keys |
| L / R | Q / E | ZL / ZR | 1 / 3 |
| L3 / R3 | Z / X | − / + | − / = |
| Capture / Home | C / H | | |

If USB-UART is physically unplugged while a button is held, the browser cannot
send the final neutral report. Reset the board to release that last state.

## Serial protocol

The control link is `115200 baud`, ASCII, one command per line.

| Command | Behavior |
| --- | --- |
| `HELLO` / `INFO` | Return firmware, routine metadata, and current state as JSON |
| `START` | Restart the board-resident routine from step 1 |
| `STOP` | Stop and send a fully neutral controller report |
| `STATUS` | Return phase, step, cycle count, and timing |
| `PING` | Return `PONG` |
| `R buttons dpad lx ly rx ry` | Stop the routine and send one complete HID report |

The raw report command keeps the firmware useful for future computer-loaded
routines without changing the board protocol.

## Development

```bash
npm test
pio run
```

The test suite covers:

- Embedded step count, duration, action boundaries, and compact Flash size
- Loop-gap boundaries, stop neutralization, and `millis()` wraparound
- Status parsing and the simulated serial transport
- All 14 button bits, cardinal/diagonal D-pad input, keyboard mapping, and
  multi-source press/release behavior

Project layout:

- `firmware/include/MaterialFarmMacro.h` — board-resident routine
- `firmware/src/MacroEngine.cpp` — non-blocking loop engine
- `firmware/src/main.cpp` — USB HID, serial protocol, and device main loop
- `web/` — dependency-free Web Serial console
- `tests/` — host-side firmware and browser-logic tests

## License and disclaimer

This project is released under the
[GNU General Public License v3.0](./LICENSE). Third-party attribution is in
[NOTICE.md](./NOTICE.md).

This is an unofficial fan project and is not affiliated with, endorsed by, or
sponsored by Nintendo. Splatoon, Splatoon Raiders, Nintendo Switch, and related
names and marks belong to their respective owners. Use automation responsibly;
the project is intended for offline, single-player material farming.
