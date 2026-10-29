import assert from "node:assert/strict";
import { test } from "node:test";
import { driveCurve, driveSettings, saturationCurve, pluckSamples } from "../src/dsp.ts";

test("waveshaping is finite, bounded and symmetric for supported drive values", () => {
  for (const drive of [0, 0.25, 1]) {
    const curve = driveCurve(drive);
    assert.equal(curve[1024], 0);
    for (let i = 0; i < curve.length; i++) {
      assert.ok(Number.isFinite(curve[i]) && Math.abs(curve[i]) <= 1);
      assert.ok(Math.abs(curve[i] + curve[curve.length - i - 1]) < 1e-6);
    }
  }
  assert.throws(() => driveCurve(NaN));
  assert.throws(() => driveCurve(1.01));
});

test("drive zero is identity and near-zero changes have no old gain discontinuity", () => {
  const clean = driveCurve(0);
  const barelyDriven = driveCurve(0.0001);
  for (let i = 0; i < clean.length; i++) {
    const expected = (i * 2) / (clean.length - 1) - 1;
    assert.equal(clean[i], expected);
    assert.ok(Math.abs(barelyDriven[i] - clean[i]) < 0.0001);
  }
});

test("starter drive has bounded small-signal amplification and smooth monotonic transfer", () => {
  const curve = driveCurve(0.25);
  const slope = curve[1025] / (1 / 1024);
  assert.ok(slope > 1 && slope < 2, `starter slope ${slope}; old mapping was about 11`);
  for (const drive of [0, 0.01, 0.25, 0.5, 1]) {
    const values = driveCurve(drive);
    for (let i = 1; i < values.length; i++) assert.ok(values[i] >= values[i - 1]);
    const settings = driveSettings(drive);
    assert.equal(settings.clean + settings.distorted, 1);
    assert.ok(settings.preGain >= 1 && settings.preGain <= 8);
    assert.ok(settings.postGain > 0 && settings.postGain <= 1);
  }
  assert.equal(saturationCurve()[1024], 0);
});

test("synthetic pluck starts quietly and decays, with bounded output", () => {
  const samples = pluckSamples(48000);
  assert.equal(samples.length, 96000);
  assert.equal(samples[0], 0);
  let earlyEnergy = 0;
  let lateEnergy = 0;
  for (let i = 0; i < samples.length; i++) {
    assert.ok(Number.isFinite(samples[i]) && Math.abs(samples[i]) <= 0.35);
    if (i < 24000) earlyEnergy += samples[i] ** 2;
    if (i >= 72000) lateEnergy += samples[i] ** 2;
  }
  assert.ok(earlyEnergy > lateEnergy * 100);
  assert.throws(() => pluckSamples(0));
});
