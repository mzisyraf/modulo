// Local separation and reference-scoped starting-preset boundary.
import { parsePreset, type Preset } from "@modulo/contracts";

export interface PresetGeneration {
  request_id: string;
  reference_revision: number;
  status: "generating" | "ready" | "failed";
  preset?: Preset;
  error?: { code: string; message: string; retryable: boolean };
}

export interface ReferencePassage {
  start_seconds: number;
  end_seconds: number;
  quality_flags: string[];
  explanation: string;
}

export interface SeparationJob {
  job_id: string;
  status: "queued" | "running" | "ready" | "failed";
  stage: string;
  expires_at: number;
  generation?: PresetGeneration;
  error?: { code: string; message: string; retryable: boolean };
  result?: {
    duration_seconds: number;
    sample_rate: number;
    artifacts: Record<"mix" | "guitar" | "backing", string>;
    provenance: { kind: "local_separation"; model: string; device: string };
    common_gain_linear: number;
    quality_flags: string[];
    reference: ReferencePassage | null;
    reference_revision?: number;
    suggestion: ReferencePassage | null;
  };
}

export const isJobId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

export async function apiJson(url: string, options: RequestInit) {
  const response = await fetch(url, options);
  const value = await response.json().catch(() => { throw new Error("The API did not return JSON. Start the local API and reconnect."); });
  if (!response.ok) throw Object.assign(new Error(typeof value?.error?.message === "string" ? value.error.message : `The local API returned HTTP ${response.status}.`), { status: response.status });
  return value;
}

export function parsePresetGeneration(value: unknown, revision: number): PresetGeneration {
  const generation = value as PresetGeneration;
  if (!generation || !isJobId(generation.request_id) || generation.reference_revision !== revision
    || !["generating", "ready", "failed"].includes(generation.status)) throw new Error("The preset belongs to an invalid or outdated passage.");
  if (generation.status === "ready") {
    const preset = parsePreset(generation.preset);
    if (preset.provenance.kind !== "generated" || preset.provenance.provider !== "nebius"
      || !["source_calibration_missing", "target_energy_only", "tone_matching_unverified"].every((flag) => preset.quality_flags.includes(flag))) throw new Error("The starting preset is missing its required provenance or calibration warnings.");
    return { ...generation, preset };
  }
  if (generation.preset !== undefined || (generation.status === "failed" && typeof generation.error?.message !== "string")) throw new Error("Unsuccessful generation must not contain a preset.");
  return generation;
}

export function referenceBounds(start: string, end: string, duration: number) {
  const first = Number(start), last = Number(end);
  if (!/^\d+$/.test(start) || !/^\d+$/.test(end) || first < 0 || last > Math.floor(duration) || last - first < 10 || last - first > 20) {
    throw new Error("Choose a whole-second passage lasting 10–20 seconds within the song.");
  }
  return { start_seconds: first, end_seconds: last };
}

export function parseSeparationJob(value: unknown): SeparationJob {
  const job = value as SeparationJob;
  const strings = (items: unknown): items is string[] => Array.isArray(items) && items.every((item) => typeof item === "string");
  if (!job || !isJobId(job.job_id) || !["queued", "running", "ready", "failed"].includes(job.status) || typeof job.stage !== "string" || !Number.isFinite(job.expires_at)) {
    throw new Error("The API returned an invalid separation job.");
  }
  if (job.status === "failed" && (!job.error || typeof job.error.message !== "string")) throw new Error("The API returned an invalid job error.");
  if (job.status === "ready") {
    const result = job.result;
    if (!result || !Number.isFinite(result.duration_seconds) || result.duration_seconds < 10 || result.duration_seconds > 295
      || result.sample_rate !== 44100 || result.provenance?.kind !== "local_separation"
      || typeof result.provenance.model !== "string" || typeof result.provenance.device !== "string"
      || !Number.isFinite(result.common_gain_linear) || result.common_gain_linear <= 0 || result.common_gain_linear > 1 || !strings(result.quality_flags)
      || ["mix", "guitar", "backing"].some((name) => result.artifacts?.[name as keyof typeof result.artifacts] !== `/api/jobs/${job.job_id}/audio/${name}`)) {
      throw new Error("The API returned invalid separation artifacts or provenance.");
    }
    for (const passage of [result.reference, result.suggestion]) {
      if (passage === null) continue;
      if (!passage || !Number.isInteger(passage.start_seconds) || !Number.isInteger(passage.end_seconds)
        || !strings(passage.quality_flags) || typeof passage.explanation !== "string") throw new Error("The API returned an invalid reference passage.");
      referenceBounds(String(passage.start_seconds), String(passage.end_seconds), result.duration_seconds);
    }
    const revision = result.reference_revision ?? 0;
    if (!Number.isInteger(revision) || revision < 0) throw new Error("The reference revision is invalid.");
    if (job.generation !== undefined) {
      if (!result.reference) throw new Error("A preset requires a confirmed reference.");
      job.generation = parsePresetGeneration(job.generation, revision);
    }
  } else if (job.result !== undefined) throw new Error("Unfinished separation must not contain a result.");
  return job;
}
