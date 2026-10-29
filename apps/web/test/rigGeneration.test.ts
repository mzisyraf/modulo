import test from "node:test";
import assert from "node:assert/strict";
import { parseRigGeneration, rigSourceMatches } from "../src/rigGeneration.ts";
import { readFileSync } from "node:fs";
const hash = JSON.parse(readFileSync(new URL("../../../contracts/rig-catalog-hash.json", import.meta.url), "utf8")).sha256;
const tone = { method: "spectral_bands_v1", bands: [.1, .2, .3, .2, .1, .1], centroid_hz: 1000, flatness: .1, crest_db: 18 };
const source = { id: "a".repeat(64), method: "browser_level_v1", duration_seconds: 15, rms_dbfs: -24, peak_dbfs: -6, clipped_fraction: 0, tone_features: tone, origin: "file" };
const ready = () => ({ request_id: "11111111-1111-4111-8111-111111111111", reference_revision: 3, kind: "rig_proposal", status: "ready", source_calibration: source,
  target_tone_features: tone, rig_proposal: { proposal: { proposal_version: "1", name: "Explicit echo", description: "Individual settings", tempo_bpm: 120,
    modules: [{ model_id: "delay.single_tap", enabled: true, parameters: { time_ms: 237, mix: .173 } }] },
  provenance: { kind: "generated", provider: "nebius", model: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B" }, catalog_sha256: hash, quality_flags: ["tone_matching_unverified"] } });
test("rig responses require complete settings, provenance and current source/reference", () => {
  const result = parseRigGeneration(ready(), 3);
  assert.ok(rigSourceMatches(result, result.source_calibration));
  assert.equal(rigSourceMatches(result, { ...result.source_calibration, origin: "live" }), false);
  assert.throws(() => parseRigGeneration(ready(), 4));
  const missing = ready(); delete (missing.rig_proposal.proposal.modules[0].parameters as any).mix;
  assert.throws(() => parseRigGeneration(missing, 3));
  const forged = ready(); forged.rig_proposal.provenance.model = "fixture";
  assert.throws(() => parseRigGeneration(forged, 3));
  assert.throws(() => parseRigGeneration({ ...ready(), target_tone_features: null }, 3));
});
