import test from "node:test";
import assert from "node:assert/strict";
import { temporalFeatures, temporalDistance, validTemporalFeatures } from "../src/temporalFeatures.ts";
test("timing descriptors ignore pure gain and distinguish echoes without interpreting notes", () => {
  const rate = 8000, dry = new Float32Array(rate * 3), wet = new Float32Array(dry.length);
  for (let i = 0; i < dry.length; i++) dry[i] = .2 * Math.sin(i * 2 * Math.PI * 220 / rate) * Math.exp(-(i % rate) / 400);
  for (let i = 0; i < wet.length; i++) wet[i] = dry[i] + (i >= 1600 ? .6 * dry[i - 1600] : 0);
  const a = temporalFeatures(dry, rate), scaled = temporalFeatures(dry.map(x => x * .1), rate), b = temporalFeatures(wet, rate);
  assert.ok(validTemporalFeatures(a)); assert.ok(temporalDistance(a, scaled) < 1e-7); assert.ok(temporalDistance(a, b) > .01);
  assert.throws(() => temporalFeatures(new Float32Array(rate * 3), rate));
  assert.throws(() => temporalDistance(a, { ...b, correlations: [Infinity] }));
});
