import { encodeMonoWav } from "./localAudio.ts";
import { toneFeatures, type ToneFeatures } from "./audioFeatures.ts";

export interface SourceCalibration {
  id: string;
  method: "browser_level_v1";
  duration_seconds: number;
  rms_dbfs: number;
  peak_dbfs: number;
  clipped_fraction: number;
  tone_features?: ToneFeatures;
}
export interface CalibratedRecording {
  file: File;
  originalName: string;
  skippedSeconds: number;
  measurements: SourceCalibration;
  inputGainDb: number;
}

export function calibrationKey(source?: SourceCalibration): string {
  if(!source)return "";
  const tone=source.tone_features;
  return JSON.stringify([source.id,source.method,source.duration_seconds,source.rms_dbfs,source.peak_dbfs,source.clipped_fraction,
    tone?[tone.method,...tone.bands,tone.centroid_hz,tone.flatness,tone.crest_db]:null]);
}

export function recordingLevels(samples: Float32Array, rate: number) {
  if (!Number.isInteger(rate) || rate < 8000 || rate > 192000 || samples.length < rate * 3 || samples.length > rate * 90) throw new Error("Use a guitar recording lasting 3–90 seconds.");
  const block = Math.round(rate / 20);
  let first = -1, last = 0;
  for (let i = 0; i < samples.length; i += block) {
    let energy = 0;
    const end = Math.min(samples.length, i + block);
    for (let j = i; j < end; j++) {
      if (!Number.isFinite(samples[j])) throw new Error("The input contains invalid samples.");
      energy += samples[j] ** 2;
    }
    if (energy / (end - i) >= 1e-5) { if (first < 0) first = i; last = end; }
  }
  if (first < 0 || last - first < rate * 3) throw new Error("Play at least three seconds of clear guitar; this input is too quiet or short.");
  const trimmed = samples.slice(first, last);
  let energy = 0, peak = 0, clipped = 0;
  for (const sample of trimmed) { energy += sample * sample; peak = Math.max(peak, Math.abs(sample)); if (Math.abs(sample) >= 0.999) clipped++; }
  const rms_dbfs = 10 * Math.log10(energy / trimmed.length), peak_dbfs = 20 * Math.log10(peak), clipped_fraction = clipped / trimmed.length;
  if (peak > 1 || rms_dbfs < -50) throw new Error("Use a clear recording below full scale, without clipped peaks or long silent gaps.");
  if (clipped_fraction >= 0.01) throw new Error("The input is clipped. Calibrate again at a lower input level.");
  const inputGainDb = Math.round(Math.max(-24, Math.min(12, -24 - rms_dbfs, -6 - peak_dbfs)) * 10) / 10;
  return { trimmed, skippedSeconds: first / rate, inputGainDb, levels: { duration_seconds: trimmed.length / rate, rms_dbfs, peak_dbfs, clipped_fraction } };
}

/** Measure only PCM captured from the connected instrument, before effects. */
export async function calibrateLiveInput(samples: Float32Array, sampleRate: number): Promise<CalibratedRecording> {
  const measured = recordingLevels(samples, sampleRate);
  const prepared = encodeMonoWav(measured.trimmed, sampleRate);
  const bytes = await prepared.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const id = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  return { file: new File([prepared], "live-calibration.wav", { type: "audio/wav" }), originalName: "Live guitar calibration",
    skippedSeconds: measured.skippedSeconds, inputGainDb: measured.inputGainDb,
    measurements: { id, method: "browser_level_v1", ...measured.levels, tone_features: toneFeatures(measured.trimmed, sampleRate) } };
}
