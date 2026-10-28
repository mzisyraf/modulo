import { referenceBounds, type ReferencePassage } from "./separation.ts";

export interface ReferenceOptions {
  method: "signal_contrast_v1";
  duration_seconds: number;
  options: Array<ReferencePassage & { label: string }>;
  waveforms: Record<"mix" | "guitar", number[]>;
}

export function parseReferenceOptions(value: unknown, duration: number): ReferenceOptions {
  const result = value as ReferenceOptions;
  if (!result || result.method !== "signal_contrast_v1" || result.duration_seconds !== duration
    || !Array.isArray(result.options) || result.options.length > 3) throw new Error("The API returned invalid reference options.");
  for (const option of result.options) {
    if (!option || !Number.isInteger(option.start_seconds) || !Number.isInteger(option.end_seconds)
      || typeof option.label !== "string" || !option.label.length || option.label.length > 80
      || typeof option.explanation !== "string" || !Array.isArray(option.quality_flags)
      || !option.quality_flags.every((flag) => typeof flag === "string")) throw new Error("The API returned an invalid passage.");
    referenceBounds(String(option.start_seconds), String(option.end_seconds), duration);
  }
  if (result.options.some((option, index) => result.options.slice(0, index).some((other) => option.start_seconds < other.end_seconds && option.end_seconds > other.start_seconds))) {
    throw new Error("Suggested passages must not overlap.");
  }
  for (const track of ["mix", "guitar"] as const) {
    const peaks = result.waveforms?.[track];
    if (!Array.isArray(peaks) || !peaks.length || peaks.length > 400 || peaks.some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1)) {
      throw new Error("The API returned an invalid waveform.");
    }
  }
  return result;
}

export function dragInterval(kind: "start" | "end" | "move" | "new", at: number, anchor: number, start: number, end: number, duration: number) {
  const limit = Math.floor(duration);
  const point = Math.max(0, Math.min(limit, Math.round(at)));
  if (kind === "start") return [Math.max(0, Math.min(end - 10, Math.max(end - 20, point))), end];
  if (kind === "end") return [start, Math.min(limit, Math.max(start + 10, Math.min(start + 20, point)))];
  const length = kind === "move" ? end - start : Math.min(20, Math.max(10, Math.abs(point - anchor)));
  const first = kind === "move" ? start + point - anchor : Math.min(point, anchor);
  const bounded = Math.max(0, Math.min(limit - length, Math.round(first)));
  return [bounded, bounded + length];
}

export const referenceTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
