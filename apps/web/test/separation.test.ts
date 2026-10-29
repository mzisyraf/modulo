import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePresetGeneration, parseSeparationJob, referenceBounds } from "../src/separation.ts";
import fixture from "../../../fixtures/preset.example.json" with { type: "json" };

test("reference confirmation rejects blank, fractional, short and out-of-song bounds", () => {
  assert.deepEqual(referenceBounds("30", "45", 145.4), { start_seconds: 30, end_seconds: 45 });
  for (const [start, end] of [["", "15"], ["0.5", "15"], ["0", "9"], ["0", "21"], ["135", "146"]]) {
    assert.throws(() => referenceBounds(start, end, 145.4));
  }
});

test("starting presets require matching passage revision and trusted missing-calibration flags", () => {
  const preset = { ...structuredClone(fixture), provenance: { kind: "generated", provider: "nebius", model: "test model" }, quality_flags: ["source_calibration_missing", "target_energy_only", "tone_matching_unverified"] };
  const generation = { request_id: "11111111-1111-4111-8111-111111111111", reference_revision: 2, status: "ready", preset };
  assert.equal(parsePresetGeneration(generation, 2).preset?.parameters.drive, fixture.parameters.drive);
  assert.throws(() => parsePresetGeneration(generation, 3));
  assert.throws(() => parsePresetGeneration({ ...generation, preset: { ...preset, quality_flags: [] } }, 2));
  assert.throws(() => parsePresetGeneration({ ...generation, preset: fixture }, 2));
  assert.throws(() => parsePresetGeneration({ ...generation, status: "generating" }, 2));
  assert.throws(() => parsePresetGeneration({ ...generation, preset: { ...preset, parameters: { ...preset.parameters, drive: 99 } } }, 2));
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
  const cloud = { ...pending, backend: "modal", status: "ready", result: { ...result, provenance: { ...result.provenance, kind: "cloud_separation", provider: "modal" } } };
  assert.equal(parseSeparationJob(cloud).result?.provenance.provider, "modal");
  assert.throws(() => parseSeparationJob({ ...cloud, backend: "local" }));
  assert.throws(() => parseSeparationJob({ ...cloud, result }));
  assert.throws(() => parseSeparationJob({ ...cloud, result: { ...cloud.result, provenance: { ...cloud.result.provenance, provider: "unknown" } } }));
  assert.throws(() => parseSeparationJob({ ...pending, status: "ready", result: { ...result, artifacts: { ...result.artifacts, guitar: "https://other.example/audio" } } }));
  assert.throws(() => parseSeparationJob({ ...pending, status: "ready", result: { ...result, provenance: { ...result.provenance, kind: "generated" } } }));
});

test("level-calibrated presets require source metadata and honest spectral warnings", () => {
  const source = { id: "a".repeat(64), method: "browser_level_v1", duration_seconds: 20, rms_dbfs: -27, peak_dbfs: -4, clipped_fraction: 0 };
  const preset = { ...structuredClone(fixture), provenance: { kind: "generated", provider: "nebius", model: "test model" }, quality_flags: ["source_level_calibrated", "spectral_calibration_missing", "target_energy_only", "tone_matching_unverified"] };
  const generation = { request_id: "11111111-1111-4111-8111-111111111111", reference_revision: 2, status: "ready", source_calibration: source, preset };
  assert.ok(parsePresetGeneration(generation, 2).source_calibration);
  assert.throws(() => parsePresetGeneration({ ...generation, source_calibration: { ...source, rms_dbfs: Infinity } }, 2));
  assert.throws(() => parsePresetGeneration({ ...generation, preset: { ...preset, quality_flags: ["source_level_calibrated"] } }, 2));
});
