# Splatoon Farmers

> [!WARNING]
> This is not a plug-and-play project. Before running the automated routine,
> you must first beat the game, manually farm enough materials and crystals, and
> use them to complete the required initial gear setup. The script assumes that setup
> has already been finished and will not perform it for you.

An unofficial ESP32-S3 wired controller and browser console for material
farming in [Splatoon Raiders](https://www.nintendo.com/us/store/products/splatoon-raiders-switch-2/).
It is intentionally small: connect the board, open the page, and start the
board-resident routine.

![](./images/banner.png)

Check this video for tutorial: [Bilibili](https://www.bilibili.com/video/BV12P3J6hE4h/)

Required gears described in this video: [Bilibili](https://www.bilibili.com/video/BV1Hp3G6KEfs/)

## What it does

- Emulates a wired Nintendo Switch controller over the ESP32-S3 native USB port.
- Keeps the complete 48-step, `63.595 s` loop in firmware Flash.
- Continues a running loop if the browser or USB-UART connection drops.
- Starts, stops, and reports progress through a Web Serial page.
- Provides every digital controller button, D-pad direction, and two analog
  virtual sticks for mouse, touch, and keyboard-assisted input.
- Records manual buttons and analog-stick movement in the browser, inserts the
  recording after the stopped step, and preserves the unexecuted macro suffix.
- Stores a persistent custom macro in ESP32 NVS and switches between the
  embedded original macro and the saved custom macro from the WebUI.
- Waits for Nintendo Switch USB HID enumeration after power-on, then starts the
  active board-resident macro automatically without a computer or WebUI.

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

The firmware can also run completely offline. When the native USB HID link is
mounted by the Switch, the board waits two seconds and automatically starts the
active macro from step 1. USB-UART and the WebUI are only needed for monitoring,
manual control, editing, or stopping the routine.

```bash
npm run serve
```

Open <http://localhost:4173> in desktop Chrome or Edge. Web Serial requires a
secure context, so opening `web/index.html` directly is not supported.

### Start the WebUI after a Windows restart

The local web server is a normal computer process and does not survive a
Windows restart. It does not depend on Codex. On this Windows installation,
double-click [`start-webui.cmd`](./start-webui.cmd); it starts the no-cache
server with `D:\Python\pythonw.exe` and opens <http://localhost:4173/>.

The equivalent manual command is:

```powershell
D:\Python\python.exe tools\serve_web.py
```

Keep that terminal open while using the page. The double-click launcher uses
`pythonw.exe`, so it runs without a visible terminal window. To launch the page
automatically at Windows sign-in, place a shortcut to `start-webui.cmd` in
`shell:startup`.

## Use

1. Select **连接手柄** and choose the DevKitC-1 USB-UART port.
2. Wait for **已连接 · 待命**.
3. Select **开始刷取**. The routine restarts at step 1 and loops until stopped.
4. Select **停止** to immediately send a neutral controller report.

The step counter, progress bar, large **STEPS** value, cycle duration, and active
macro name are updated from the ESP32 response rather than from a fixed browser
constant.

After **开始刷取** has been accepted, execution belongs to the ESP32. Switching
to another tab or minimizing the browser does not stop the running routine. The
page sends a neutral report on focus loss only when a browser-held button or
virtual stick is actually active. Closing the serial port should also leave the
board-resident routine running, but some onboard USB-UART bridges toggle reset
signals when a port opens or closes; use a TX/RX/GND-only external adapter when
that hardware behavior must be avoided. Reconnect and select **停止**, reset the
board, or remove power when you need to end a routine.

### Board macro list

The **BOARD MACROS / 板载脚本** selector lists routines currently available on
the ESP32:

- **原始素材宏** is the immutable 48-step routine compiled into firmware.
- **自定义宏** is the latest edited routine stored in NVS. It appears after a
  recording has been successfully committed.

Choose a routine and select **刷写并切换**. The ESP32 stops the current run,
activates the selected routine, and returns its real step count and duration.
Switching to the original routine does not delete the saved custom routine, so
you can switch back later. **恢复原始宏** is different: it deletes the saved
custom routine and restores the embedded original.

### Manual controls

Manual input stops the automatic routine before sending a raw controller
report. Buttons support hold, multi-key combinations, mouse, multitouch, and
keyboard. Losing focus or hiding the tab releases all browser-held inputs.
The left virtual stick controls `lx/ly`, the right virtual stick controls
`rx/ry`, and both return to `128,128` when released. Two touch pointers can
operate both sticks simultaneously. Analog movements are also captured by the
WebUI macro recorder.

### Physical gamepad mapping

Connect a standard USB or Bluetooth gamepad to the computer, then press one of
its buttons so Chrome or Edge exposes it through the browser Gamepad API. The
WebUI shows the detected controller name beside the virtual sticks. Physical
gamepad input uses the same manual-report and macro-recording path as the
on-screen controls, so buttons and analog movement can be recorded directly
into inserted or replacement macros.

| Standard gamepad input | Switch output |
| --- | --- |
| Bottom / right / left / top face buttons | B / A / Y / X |
| LB / RB | L / R |
| LT / RT | ZL / ZR |
| Back / Start | Minus / Plus |
| Left-stick / right-stick click | L3 / R3 |
| D-pad | D-pad |
| Guide / extra button, when exposed | Home / Capture |
| Axes 0-1 / axes 2-3 | Left stick / right stick |

A radial `12%` deadzone is applied to both physical sticks. Browser and
controller drivers may hide the Guide/Home button from web pages; that is a
platform restriction rather than an ESP32 mapping failure.

Physical gamepads can report tiny axis changes up to the browser refresh rate.
To keep recorded macros within the 160-segment device limit, recording quantizes
analog axes and stores pure stick movement at most once every `50 ms`. Digital
button and D-pad changes are always captured immediately. This compression
affects only recorded macro data; live controller reports remain responsive at
the browser polling rate.

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
| `MACRO_BEGIN anchor count` | Begin uploading steps to insert after `anchor` existing steps |
| `MACRO_REPLACE_BEGIN count` | Begin uploading a completely new custom macro that replaces the previous custom routine |
| `MACRO_STEP ms buttons dpad lx ly rx ry` | Append one timed controller report to the pending upload |
| `MACRO_COMMIT` | Insert, activate, and persist the uploaded steps in NVS |
| `MACRO_CANCEL` | Discard a pending upload |
| `MACRO_RESET` | Restore the embedded 48-step routine |
| `MACRO_LIST` | List the original and saved custom routines, their step counts, and the active routine |
| `MACRO_SELECT ORIGINAL` | Activate the embedded original without deleting the saved custom routine |
| `MACRO_SELECT CUSTOM` | Load and activate the saved NVS custom routine |

The raw report command keeps the firmware useful for future computer-loaded
routines without changing the board protocol.

### Record and insert a macro from the WebUI

1. Start the selected routine and wait until the progress bar reaches the place
   where the new actions should be inserted.
2. Select **停止**. The WebUI freezes the last running step instead of resetting
   the insertion point to zero.
3. Select **开始录制**. The frozen step is remembered as the insertion anchor.
4. Use the manual buttons, keyboard, D-pad, or either virtual stick. Presses,
   releases, combinations, analog positions, and neutral delays are recorded
   with millisecond timing.
5. Select **完成并写入**. Commands are sent one at a time; the next step is not
   sent until the ESP32 acknowledges the previous one. The page reports success
   only after `MACRO_COMMIT` has been confirmed and saved.
6. Confirm that **自定义宏已保存** appears and that every step-count display has
   increased. Select **开始刷取** to run the updated routine from step 1.

For example, if the original routine is stopped at step 17 and the recording
contains four steps, the saved order is:

```text
original 1-17 -> recorded 4 steps -> original 18-48
```

The resulting macro is stored in ESP32 NVS and survives reset or power loss.
Use **恢复原始宏** to delete it and return to the embedded routine. A macro may
contain up to 160 total steps; insertion mode allows as many recorded segments
as remain before that total limit.

### Record a completely new macro from controller input

Use this mode when the desired routine should contain only newly recorded
actions rather than the original farming sequence:

1. Connect the board and select **新建宏录制**.
2. Use the WebUI controller buttons, D-pad, keyboard, and virtual sticks in the
   exact order and timing that the new routine should replay.
3. Select **完成并写入**. The page sends `MACRO_REPLACE_BEGIN`, each recorded
   controller state, and `MACRO_COMMIT`, waiting for an ESP32 acknowledgement
   after every command.
4. After the commit succeeds, the recording appears as **自定义宏** in the board
   macro list and is stored in NVS. The next automatic boot runs that custom
   macro without requiring the computer.

A newly recorded replacement macro may contain up to 160 state segments. The
embedded original remains in firmware and can still be selected at any time.

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
- Virtual-stick coordinate mapping and analog reports
- Macro recording timing, insertion commands, persistence acknowledgements,
  and board macro selection

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

## Credits

Thanks to [我的茕茕孑立](https://space.bilibili.com/35615481) for the original game controller macro.
