import assert from "node:assert/strict";
import test from "node:test";

import { formatDuration, parseDeviceLine } from "../../web/protocol.js";
import { MockSerialTransport } from "../../web/serial-transport.js";

test("parses firmware status JSON", () => {
  const message = parseDeviceLine(
    '{"type":"status","ok":true,"state":"running","step":9,"steps":48}',
  );
  assert.equal(message.type, "status");
  assert.equal(message.state, "running");
  assert.equal(message.step, 9);
});

test("handles compatibility responses and malformed input", () => {
  assert.deepEqual(parseDeviceLine("PONG\r"), { type: "pong", ok: true });
  assert.deepEqual(parseDeviceLine("OK"), { type: "ack", ok: true });
  assert.equal(parseDeviceLine("ERR").ok, false);
  assert.equal(parseDeviceLine("{broken").type, "unknown");
  assert.equal(parseDeviceLine(""), null);
});

test("formats the complete embedded cycle", () => {
  assert.equal(formatDuration(63595), "01:03.595");
});

test("mock transport follows HELLO, START, STATUS and STOP", async () => {
  const lines = [];
  const transport = new MockSerialTransport({
    onLine: (line) => lines.push(parseDeviceLine(line)),
    onDisconnect: () => assert.fail("mock should not disconnect"),
  });

  await transport.connect();
  await transport.send("HELLO");
  await transport.send("START");
  await transport.send("STATUS");
  await transport.send("STOP");

  assert.equal(lines[0].type, "info");
  assert.equal(lines[0].state, "idle");
  assert.equal(lines[1].state, "running");
  assert.equal(lines[2].state, "running");
  assert.equal(lines[3].state, "idle");
  assert.equal(lines[3].routine, "material-farm");
});

test("manual raw report stops the mock macro and is acknowledged", async () => {
  const lines = [];
  const transport = new MockSerialTransport({
    onLine: (line) => lines.push(parseDeviceLine(line)),
    onDisconnect: () => assert.fail("mock should not disconnect"),
  });

  await transport.connect();
  await transport.send("START");
  await transport.send("R 20 0 128 128 128 128");
  await transport.send("STATUS");

  assert.equal(transport.lastReport, "R 20 0 128 128 128 128");
  assert.deepEqual(lines[1], {
    type: "report",
    ok: true,
    hid_sent: true,
    buttons: 20,
    dpad: 0,
    left_x: 128,
    left_y: 128,
    right_x: 128,
    right_y: 128,
  });
  assert.equal(lines[2].state, "idle");
});

test("mock transport accepts a recorded macro insertion", async () => {
  const lines = [];
  const transport = new MockSerialTransport({
    onLine: (line) => lines.push(parseDeviceLine(line)),
    onDisconnect: () => assert.fail("mock should not disconnect"),
  });

  await transport.connect();
  await transport.send("MACRO_BEGIN 5 2");
  await transport.send("MACRO_STEP 100 4 15 128 128 128 128");
  await transport.send("MACRO_STEP 80 0 15 128 128 128 128");
  await transport.send("MACRO_COMMIT");

  assert.equal(transport.steps, 50);
  assert.equal(transport.custom, true);
  assert.equal(lines.at(-2).action, "commit");
  assert.equal(lines.at(-1).steps, 50);
});
