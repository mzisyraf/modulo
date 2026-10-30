import { parseRigProposal, type RigProposal } from "@modulo/audio";
import { validToneFeatures, type ToneFeatures } from "./audioFeatures.ts";
import { calibrationKey, type SourceCalibration } from "./recordingCalibration.ts";
import { validTemporalFeatures, type TemporalFeatures } from "./temporalFeatures.ts";
import catalogHash from "../../../contracts/rig-catalog-hash.json" with { type: "json" };
import type { RigTargetWindow } from "./refineRig.ts";

export interface GeneratedRig { proposal: RigProposal; provenance: { kind: "generated"; provider: "nebius"; model: string }; catalog_sha256: string; quality_flags: string[]; prompt_version?: string }
export interface RigGeneration {
  request_id: string; reference_revision: number; kind: "rig_proposal"; status: "generating" | "ready" | "failed";
  source_calibration: SourceCalibration; rig_proposal?: GeneratedRig; target_tone_features?: ToneFeatures;
  target_rms_dbfs?: number; error?: { code: string; message: string; retryable: boolean };
  target_temporal_features?: TemporalFeatures;
  target_feature_windows?: RigTargetWindow[];
}
export function parseRigGeneration(value: unknown, revision: number): RigGeneration {
  const generation = value as RigGeneration;
  if (!generation || generation.kind !== "rig_proposal" || !/^[0-9a-f-]{36}$/.test(generation.request_id) || generation.reference_revision !== revision
    || !["generating", "ready", "failed"].includes(generation.status) || !generation.source_calibration || !validToneFeatures(generation.source_calibration.tone_features)) throw Error("Invalid or stale rig generation.");
  const source = generation.source_calibration;
  if ((source.temporal_features !== undefined && !validTemporalFeatures(source.temporal_features)) || (generation.target_temporal_features !== undefined && !validTemporalFeatures(generation.target_temporal_features))) throw Error("Invalid rig timing descriptors.");
  if(generation.target_feature_windows!==undefined&&(!Array.isArray(generation.target_feature_windows)||generation.target_feature_windows.length!==2||generation.target_feature_windows.some(w=>!validToneFeatures(w.tone)||(w.temporal!==undefined&&!validTemporalFeatures(w.temporal)))))throw Error("Invalid rig validation windows.");
  if (!/^[0-9a-f]{64}$/.test(source.id) || source.method !== "browser_level_v1" || ![source.rms_dbfs, source.peak_dbfs, source.duration_seconds, source.clipped_fraction].every(Number.isFinite)
    || source.rms_dbfs < -50 || source.rms_dbfs > source.peak_dbfs || source.peak_dbfs > 0 || source.duration_seconds < 3 || source.duration_seconds > 90 || source.clipped_fraction < 0 || source.clipped_fraction >= .01
    || (source.origin !== undefined && !["file", "live"].includes(source.origin))) throw Error("Invalid rig source calibration.");
  if (generation.status === "ready") {
    const rig = generation.rig_proposal;
    if (!rig || rig.provenance?.kind !== "generated" || rig.provenance.provider !== "nebius"
      || !["nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", "nvidia/nemotron-3-super-120b-a12b"].includes(rig.provenance.model)
      || rig.catalog_sha256 !== catalogHash.sha256 || !Array.isArray(rig.quality_flags) || !rig.quality_flags.includes("tone_matching_unverified")
      || !validToneFeatures(generation.target_tone_features)) throw Error("Missing rig provenance or measured target.");
    parseRigProposal(rig.proposal);
  } else if (generation.rig_proposal !== undefined || (generation.status === "failed" && typeof generation.error?.message !== "string")) throw Error("Invalid unsuccessful rig generation.");
  return generation;
}
export const rigSourceMatches = (generation: RigGeneration, source: SourceCalibration) => calibrationKey(generation.source_calibration) === calibrationKey(source);
