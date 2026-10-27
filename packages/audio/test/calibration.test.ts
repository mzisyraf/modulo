import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { CalibrationBuffer, calibrationFrameLimit, inputLevel } from "../src/calibration.ts";

test("level readings handle silence, RMS, clipping and non-finite samples", () => {
  assert.deepEqual(inputLevel(new Float32Array()), { peak: 0, rms: 0, clipping: false });
  assert.deepEqual(inputLevel(new Float32Array([0.5, -0.5])), { peak: 0.5, rms: 0.5, clipping: false });
  assert.equal(inputLevel(new Float32Array([-1])).clipping, true);
  assert.ok(Number.isFinite(inputLevel(new Float32Array([NaN, Infinity])).rms));
});

test("calibration quality distinguishes usable, silent, clipped, short and invalid takes", () => {
  const capture = (values: Float32Array) => {
    const buffer = new CalibrationBuffer(1000, 2); buffer.append(values); return buffer.finish();
  };
  const good = capture(new Float32Array(2000).fill(0.1));
  assert.equal(good.usable, true);
  assert.equal(good.durationSeconds, 2);
  assert.equal(good.sampleRate, 1000);
  assert.deepEqual(good.qualityFlags, []);
  assert.deepEqual(capture(new Float32Array(2000)).qualityFlags, ["silence"]);
  assert.deepEqual(capture(new Float32Array(2000).fill(1)).qualityFlags, ["clipping"]);
  assert.deepEqual(capture(new Float32Array(500).fill(0.1)).qualityFlags, ["too_short"]);
  const invalid = new Float32Array(2000).fill(0.1); invalid[0] = NaN;
  const result = capture(invalid);
  assert.equal(result.usable, false);
  assert.deepEqual(result.qualityFlags, ["invalid_samples"]);
  assert.ok(result.samples.every(Number.isFinite));
});

test("capture storage is bounded and does not retain caller buffers", () => {
  const buffer = new CalibrationBuffer(1000, 2);
  const block = new Float32Array(3000).fill(0.25);
  buffer.append(block); block.fill(1); buffer.append(block);
  const take = buffer.finish();
  assert.equal(take.samples.length, 2000);
  assert.equal(take.level.peak, 0.25);
  take.samples.fill(0);
  assert.equal(buffer.finish().level.peak, 0.25);
  for (const seconds of [0, 1, 16, NaN, Infinity]) assert.throws(() => calibrationFrameLimit(48000, seconds));
  for (const rate of [0, -1, NaN, Infinity]) assert.throws(() => calibrationFrameLimit(rate, 10));
});

function processor(maxFrames: number) {
  let Processor: any;
  class Base {
    messages: any[] = [];
    port = { postMessage: (data: any) => { this.messages.push(data); }, onmessage: undefined as any };
  }
  runInNewContext(readFileSync(new URL("../src/calibration-worklet.js", import.meta.url), "utf8"), {
    AudioWorkletProcessor: Base, Float32Array,
    registerProcessor: (name: string, implementation: any) => { assert.equal(name, "modulo-calibration"); Processor = implementation; },
  });
  return new Processor({ processorOptions: { maxFrames } });
}

test("worklet captures selected mono PCM exactly to the limit, in order, without writing output", () => {
  const capture = processor(1500);
  const input = new Float32Array(128).fill(0.125);
  const output = new Float32Array(128);
  for (let block = 0; block < 12; block++) capture.process([[input]], [[output]]);
  const chunks = capture.messages.filter((message: any) => message.samples);
  assert.equal(chunks.reduce((total: number, message: any) => total + message.samples.length, 0), 1500);
  assert.ok(chunks.every((message: any) => message.samples.every((value: number) => value === 0.125)));
  assert.equal(capture.messages.at(-1).done, true);
  assert.ok(output.every((value) => value === 0));
  assert.equal(capture.process([[input]]), false);
});

test("explicit worklet finish flushes partial blocks once; no-input waits without fabricated samples", () => {
  const capture = processor(48000);
  capture.process([]);
  assert.equal(capture.messages.length, 0);
  capture.process([[new Float32Array(128).fill(0.25)]]);
  capture.port.onmessage({ data: "finish" });
  capture.port.onmessage({ data: "finish" });
  assert.equal(capture.messages.length, 2);
  assert.equal(capture.messages[0].samples.length, 128);
  assert.equal(capture.messages[1].done, true);
});
