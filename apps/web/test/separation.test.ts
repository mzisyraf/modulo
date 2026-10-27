import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSeparationJob, referenceBounds } from "../src/separation.ts";

test("reference confirmation rejects blank, fractional, short and out-of-song bounds", () => {
  assert.deepEqual(referenceBounds("30", "45", 145.4), { start_seconds: 30, end_seconds: 45 });
  for (const [start, end] of [["", "15"], ["0.5", "15"], ["0", "9"], ["0", "21"], ["135", "146"]]) {
    assert.throws(() => referenceBounds(start, end, 145.4));
  }
});

test("job parser rejects invented preset success and foreign artifact URLs", () => {
  const job_id = "11111111-1111-4111-8111-111111111111";
  const pending = { job_id, status: "running", stage: "separating", expires_at: 100 };
  assert.equal(parseSeparationJob(pending).status, "running");
  assert.throws(() => parseSeparationJob({ ...pending, result: { preset: "generated" } }));
  const result = {
    duration_seconds: 15, sample_rate: 44100, common_gain_linear: 0.9,
    artifacts: Object.fromEntries(["mix", "guitar", "backing"].map((name) => [name, `/api/jobs/${job_id}/audio/${name}`])),
    provenance: { kind: "local_separation", model: "htdemucs_6s", device: "test GPU" },
    quality_flags: ["separation_quality_unverified"], reference: null, suggestion: null,
  };
  assert.equal(parseSeparationJob({ ...pending, status: "ready", result }).result?.reference, null);
  assert.throws(() => parseSeparationJob({ ...pending, status: "ready", result: { ...result, artifacts: { ...result.artifacts, guitar: "https://other.example/audio" } } }));
  assert.throws(() => parseSeparationJob({ ...pending, status: "ready", result: { ...result, provenance: { ...result.provenance, kind: "generated" } } }));
});
