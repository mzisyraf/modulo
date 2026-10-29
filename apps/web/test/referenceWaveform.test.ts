import assert from "node:assert/strict";
import test from "node:test";
import { demoPassageBounds, formatAudioTime, passageWaveformBars, waveformBars } from "../src/referenceWaveform.ts";

test("uses the 42–57 second demo passage when the song is long enough", () => {
  assert.deepEqual(demoPassageBounds(108), { start: 42, end: 57 });
});

test("keeps the demo passage inside shorter songs", () => {
  assert.deepEqual(demoPassageBounds(50), { start: 35, end: 50 });
  assert.deepEqual(demoPassageBounds(8), { start: 0, end: 8 });
  assert.deepEqual(demoPassageBounds(Number.NaN), { start: 0, end: 0 });
});

test("formats audio time without rounding past the current second", () => {
  assert.equal(formatAudioTime(0), "0:00");
  assert.equal(formatAudioTime(65.9), "1:05");
});

test("builds normalized waveform bars from real sample peaks", () => {
  const bars = waveformBars([new Float32Array([0, 0.25, 0.5, 1])], 2);
  assert.deepEqual(bars, [0.25, 1]);
  assert.deepEqual(waveformBars([], 10), []);
});

test("extracts the selected region from the full waveform", () => {
  assert.deepEqual(passageWaveformBars([0.1, 0.2, 0.3, 0.4], 40, { start: 10, end: 30 }), [0.2, 0.3]);
});
