import assert from "node:assert/strict";
import test from "node:test";
import { demoPassageBounds, formatAudioTime, movePassage, passageWaveformBars, resizePassage, waveformBars } from "../src/referenceWaveform.ts";

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

test("builds normalized waveform bars from real sample energy", () => {
  const bars = waveformBars([new Float32Array([0, 0.25, 0.5, 1])], 2);
  assert.ok(Math.abs((bars[0] ?? 0) - Math.sqrt(0.05)) < 0.000001);
  assert.equal(bars[1], 1);
  assert.deepEqual(waveformBars([], 10), []);
});

test("extracts the selected region from the full waveform", () => {
  assert.deepEqual(passageWaveformBars([0.1, 0.2, 0.3, 0.4], 40, { start: 10, end: 30 }), [0.2, 0.3]);
});

test("resizes either passage edge without crossing the minimum length", () => {
  assert.deepEqual(resizePassage({ start: 10, end: 25 }, "start", 24, 60), { start: 22, end: 25 });
  assert.deepEqual(resizePassage({ start: 10, end: 25 }, "start", -5, 60), { start: 0, end: 25 });
  assert.deepEqual(resizePassage({ start: 10, end: 25 }, "end", 11, 60), { start: 10, end: 13 });
  assert.deepEqual(resizePassage({ start: 10, end: 25 }, "end", 70, 60), { start: 10, end: 60 });
});

test("moves a passage without changing its length or leaving the song", () => {
  assert.deepEqual(movePassage({ start: 10, end: 25 }, 8, 60), { start: 18, end: 33 });
  assert.deepEqual(movePassage({ start: 10, end: 25 }, -20, 60), { start: 0, end: 15 });
  assert.deepEqual(movePassage({ start: 50, end: 60 }, 20, 60), { start: 50, end: 60 });
});
