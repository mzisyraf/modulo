import assert from "node:assert/strict";
import { test } from "node:test";
import { dragInterval, parseReferenceOptions } from "../src/referenceSelection.ts";

test("manual drag and resize preserve 10–20 whole seconds inside song", () => {
  assert.deepEqual(dragInterval("start", 40, 20, 20, 35, 90), [25, 35]);
  assert.deepEqual(dragInterval("end", 90, 35, 20, 35, 90), [20, 40]);
  assert.deepEqual(dragInterval("move", 100, 20, 20, 35, 90), [75, 90]);
  assert.deepEqual(dragInterval("new", 100, 85, 0, 15, 90), [80, 90]);
  assert.deepEqual(dragInterval("new", 5, 30, 0, 15, 90), [5, 25]);
  for (const duration of [10, 12.5, 295]) for (const at of [-50, 0, 8, 25, 400]) {
    for (const kind of ["start", "end", "move", "new"] as const) {
      const [start, end] = dragInterval(kind, at, 0, 0, Math.min(15, Math.floor(duration)), duration);
      assert.ok(Number.isInteger(start) && Number.isInteger(end));
      assert.ok(start >= 0 && end <= Math.floor(duration) && end - start >= 10 && end - start <= 20);
    }
  }
});

test("reference options reject foreign duration, oversized peaks and invalid intervals", () => {
  const value = { method: "signal_contrast_v1", duration_seconds: 60, options: [{ start_seconds: 0, end_seconds: 15, label: "Starting passage", explanation: "Measured contrast, not identified guitars", quality_flags: ["tone_difference_unverified"] }], waveforms: { mix: [0, 0.8], guitar: [0, 0.3] } };
  assert.equal(parseReferenceOptions(value, 60).options.length, 1);
  assert.throws(() => parseReferenceOptions(value, 61));
  assert.throws(() => parseReferenceOptions({ ...value, options: [{ ...value.options[0], start_seconds: "0" }] }, 60));
  assert.throws(() => parseReferenceOptions({ ...value, options: [{ ...value.options[0], end_seconds: 30 }] }, 60));
  assert.throws(() => parseReferenceOptions({ ...value, waveforms: { ...value.waveforms, guitar: Array(401).fill(0) } }, 60));
  for (const peak of [NaN, Infinity, -0.1, 1.1, "0.1"]) assert.throws(() => parseReferenceOptions({ ...value, waveforms: { ...value.waveforms, guitar: [peak] } }, 60));
  assert.throws(() => parseReferenceOptions({ ...value, options: [value.options[0], { ...value.options[0], start_seconds: 5, end_seconds: 20 }] }, 60));
});
