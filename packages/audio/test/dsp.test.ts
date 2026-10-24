import assert from "node:assert/strict";
import { test } from "node:test";
import { driveCurve, pluckSamples } from "../src/dsp.ts";

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
