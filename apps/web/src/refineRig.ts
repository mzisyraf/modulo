import { compileRigProposal, createGearModule, getGearModel, modelValues, normalizeModelValue, denormalizeModelValue, parseRigProposal, renderRigFile, type RigProposal } from "@modulo/audio";
import { toneFeatures, detailedToneDistance, validToneFeatures, type ToneFeatures } from "./audioFeatures.ts";
import { encodeMonoWav } from "./localAudio.ts";
import { temporalFeatures, temporalDistance, type TemporalFeatures } from "./temporalFeatures.ts";

export interface RigScore { loss: number; safe: boolean; peak: number; guardFraction: number; rmsDbfs: number }
export async function scoreRig(file: File, proposal: RigProposal, inputGainDb: number, target: ToneFeatures, signal?: AbortSignal, temporal?: TemporalFeatures, outputLevelDb = -18): Promise<RigScore> {
  const rendered = await renderRigFile(file, compileRigProposal(proposal, inputGainDb, outputLevelDb), { sampleRate: 44100, tailSeconds: 0, signal });
  const channels = Array.from({ length: rendered.buffer.numberOfChannels }, (_, i) => rendered.buffer.getChannelData(i));
  const mono = new Float32Array(rendered.buffer.length); let peak = 0, guarded = 0, energy = 0;
  for (let i = 0; i < mono.length; i++) {
    for (const channel of channels) { if (!Number.isFinite(channel[i])) throw Error("Nonfinite rig output."); peak = Math.max(peak, Math.abs(channel[i])); if (Math.abs(channel[i]) >= .949) guarded++; mono[i] += channel[i] / channels.length; }
    energy += mono[i] ** 2;
  }
  const guardFraction = guarded / (mono.length * channels.length), safe = peak <= .951 && guardFraction < .01;
  return { loss: detailedToneDistance(toneFeatures(mono, rendered.buffer.sampleRate), target) + (temporal ? 3 * temporalDistance(temporalFeatures(mono, rendered.buffer.sampleRate), temporal) : 0), safe, peak, guardFraction, rmsDbfs: 10 * Math.log10(Math.max(1e-24, energy / mono.length)) };
}
export function neutralRigProposal(): RigProposal {
  return { proposal_version: "1", name: "Neutral reference", description: "No added EQ or saturation", tempo_bpm: 120,
    modules: [{ model_id: "eq.tilt", enabled: true, parameters: modelValues(createGearModule("eq.tilt")) }] };
}
export async function refineRig(file: File, value: RigProposal, inputGainDb: number, target: ToneFeatures,
  options: { signal?: AbortSignal; progress?: (renders: number) => void; temporal?: TemporalFeatures; targetRmsDbfs?: number } = {}) {
  const original = parseRigProposal(value); if (!validToneFeatures(target)) throw Error("Invalid target spectrum.");
  if (options.targetRmsDbfs !== undefined && (!Number.isFinite(options.targetRmsDbfs) || options.targetRmsDbfs < -100 || options.targetRmsDbfs > 0)) throw Error("Invalid target level.");
  if (!file.size || file.size > 20 * 1024 * 1024) throw Error("Choose guitar audio up to 20 MiB.");
  const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await file.arrayBuffer());
  if (decoded.numberOfChannels !== 1 || decoded.duration < 3 || decoded.duration > 90) throw Error("Use the prepared mono calibration recording.");
  const clip = new File([encodeMonoWav(decoded.getChannelData(0).slice(0, 44100 * 10), 44100)], "rig-search.wav", { type: "audio/wav" });
  const cache = new Map<string, RigScore>(); let renders = 0;
  async function score(proposal: RigProposal) {
    options.signal?.throwIfAborted(); const key = JSON.stringify(proposal.modules);
    if (cache.has(key)) return cache.get(key)!;
    if (renders >= 78) return { loss: Infinity, safe: false, peak: 0, guardFraction: 1, rmsDbfs: -100 };
    const result = await scoreRig(clip, proposal, inputGainDb, target, options.signal, options.temporal); cache.set(key, result); renders++; options.progress?.(renders); return result;
  }
  let proposal = original, best = await score(proposal); const before = best.loss;
  async function consider(candidate: RigProposal) {
    const result = await score(candidate);
    if (result.safe && (!best.safe || result.loss < best.loss - 1e-5)) { proposal = candidate; best = result; }
  }
  // Test effect bypasses first; extra effects must earn their place on measured output.
  for (let index = 0; index < original.modules.length; index++) {
    const candidate = structuredClone(proposal); candidate.modules[index].enabled = !candidate.modules[index].enabled; await consider(candidate);
  }
  for (const step of [.2, .08, .03]) {
    for (let index = 0; index < proposal.modules.length; index++) {
      if (!proposal.modules[index].enabled) continue;
      const model = getGearModel(proposal.modules[index].model_id);
      for (const parameter of model.parameters) {
        if (parameter.type !== "number" || renders >= 78) continue;
        const position = normalizeModelValue(parameter, proposal.modules[index].parameters[parameter.id] as number);
        for (const delta of [-step, step]) {
          if (renders >= 78) break;
          const candidate = structuredClone(proposal);
          candidate.modules[index].parameters[parameter.id] = denormalizeModelValue(parameter, Math.max(0, Math.min(1, position + delta)));
          try { parseRigProposal(candidate); } catch { continue; }
          await consider(candidate);
        }
      }
    }
  }
  if (!best.safe) throw Error("No safe rig candidate found. Lower source gain or remove gain-stacking effects.");
  const searchLoss = best.loss;
  let outputLevelDb = -18;
  if (options.targetRmsDbfs !== undefined) {
    // Calibrate output separately from timbre; retain the input baseline and peak headroom.
    const full = await scoreRig(file, proposal, inputGainDb, target, options.signal, options.temporal); renders++;
    outputLevelDb = Math.max(-36, Math.min(-6, -18 + options.targetRmsDbfs - full.rmsDbfs, -18 + 20 * Math.log10(.9 / Math.max(full.peak, 1e-12))));
    best = await scoreRig(file, proposal, inputGainDb, target, options.signal, options.temporal, outputLevelDb); renders++; options.progress?.(renders);
    if (!best.safe) throw Error("Output level could not be calibrated safely.");
  }
  return { proposal, outputLevelDb, before, after: searchLoss, renders, score: best };
}
