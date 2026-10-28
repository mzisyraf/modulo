import assert from "node:assert/strict";
import { test } from "node:test";
import { recordingLevels } from "../src/recordingCalibration.ts";

test("calibration skips leading quiet audio and leaves bounded peak headroom", () => {
  const rate = 8000, audio = new Float32Array(rate * 8);
  for (let i = rate * 4; i < audio.length; i++) audio[i] = 0.2 * Math.sin(i * 2 * Math.PI * 110 / rate);
  const result = recordingLevels(audio, rate);
  assert.equal(result.skippedSeconds, 4);
  assert.equal(result.trimmed.length, rate * 4);
  assert.ok(result.inputGainDb >= -24 && result.inputGainDb <= 12);
  assert.ok(result.levels.peak_dbfs + result.inputGainDb <= -5.9);
  assert.ok(result.levels.rms_dbfs + result.inputGainDb <= -23.9);
});

test("silent, clipped, nonfinite, very short and overlong recordings cannot calibrate", () => {
  for (const samples of [new Float32Array(8000 * 4), new Float32Array(8000 * 4).fill(1), new Float32Array(8000 * 4).fill(NaN), new Float32Array(8000), new Float32Array(8000 * 91)]) {
    assert.throws(() => recordingLevels(samples, 8000));
  }
});
