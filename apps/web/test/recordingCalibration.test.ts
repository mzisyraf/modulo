import assert from "node:assert/strict";
import { test } from "node:test";
import { recordingLevels,calibrationKey } from "../src/recordingCalibration.ts";

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

test("the same file with newly measured spectra cannot reuse a level-only candidate",()=>{
 const source={id:"a".repeat(64),method:"browser_level_v1" as const,duration_seconds:15,rms_dbfs:-24,peak_dbfs:-6,clipped_fraction:0};
 const tone={method:"spectral_bands_v1" as const,bands:[.1,.2,.3,.2,.1,.1],centroid_hz:1000,flatness:.1,crest_db:18};
 assert.notEqual(calibrationKey(source),calibrationKey({...source,tone_features:tone}));
 assert.equal(calibrationKey({...source,tone_features:tone}),calibrationKey({...source,tone_features:{...tone}}));
});

test("silent, clipped, nonfinite, very short and overlong recordings cannot calibrate", () => {
  for (const samples of [new Float32Array(8000 * 4), new Float32Array(8000 * 4).fill(1), new Float32Array(8000 * 4).fill(NaN), new Float32Array(8000), new Float32Array(8000 * 91)]) {
    assert.throws(() => recordingLevels(samples, 8000));
  }
});

test("live PCM supplies source level/spectra and a temporary comparison sample without file input", async () => {
  const { calibrateLiveInput } = await import("../src/recordingCalibration.ts");
  const rate = 44100, samples = Float32Array.from({length:rate*4}, (_,i) => .15*Math.sin(2*Math.PI*220*i/rate));
  const result = await calibrateLiveInput(samples, rate);
  assert.equal(result.originalName, "Live guitar calibration");
  assert.equal(result.measurements.method, "browser_level_v1");
  assert.equal(result.measurements.origin, "live");
  assert.equal(result.measurements.duration_seconds, 4);
  assert.match(result.measurements.id, /^[a-f0-9]{64}$/);
  assert.equal(result.measurements.tone_features?.bands.length, 6);
  assert.ok(result.measurements.peak_dbfs + result.inputGainDb <= -6);
  assert.equal(result.file.type, "audio/wav");
  await assert.rejects(calibrateLiveInput(new Float32Array(rate*4),rate));
});
