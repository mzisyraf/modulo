import { parseRigPreset, type RigPreset } from "./preset.ts";
import { RigGraph, prepareRig } from "./graph.ts";
import { CabinetIRLibrary } from "./impulses.ts";

export function encodeRigWav(buffer: AudioBuffer): Blob {
  if (buffer.numberOfChannels < 1 || buffer.numberOfChannels > 2 || buffer.length * buffer.numberOfChannels * 2 + 44 > 50 * 1024 * 1024) throw new Error("Rendered WAV exceeds supported bounds.");
  const bytes = new ArrayBuffer(44 + buffer.length * buffer.numberOfChannels * 2), view = new DataView(bytes);
  const text = (offset: number, value: string) => Array.from(value).forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  const channels = buffer.numberOfChannels, block = channels * 2;
  text(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * block, true); view.setUint16(32, block, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, bytes.byteLength - 44, true);
  const sources = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  for (let index = 0; index < buffer.length; index++) for (let channel = 0; channel < channels; channel++) {
    const sample = sources[channel][index]; if (!Number.isFinite(sample)) throw new Error("Render contains non-finite samples.");
    view.setInt16(44 + (index * channels + channel) * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true);
  }
  return new Blob([bytes], { type: "audio/wav" });
}

export interface RigRenderOptions { sampleRate?: number; channel?: 0 | 1; tailSeconds?: number; signal?: AbortSignal }
export async function renderRigFile(file: File, value: RigPreset, options: RigRenderOptions = {}, irs = new CabinetIRLibrary()) {
  const rig = parseRigPreset(value), rate = options.sampleRate ?? 48000, tail = options.tailSeconds ?? 2, channel = options.channel ?? 0;
  if (![44100, 48000, 96000].includes(rate) || !Number.isFinite(tail) || tail < 0 || tail > 8 || ![0, 1].includes(channel)) throw new Error("Invalid offline render options.");
  if (file.size <= 0 || file.size > 20 * 1024 * 1024) throw new Error("Render input must be at most 20 MiB.");
  const aborted = () => { if (options.signal?.aborted) throw new DOMException("Rig render canceled.", "AbortError"); };
  aborted();
  const decoder = new OfflineAudioContext(1, 1, rate), decoded = await decoder.decodeAudioData(await file.arrayBuffer()); aborted();
  if (decoded.duration > 180 || channel >= decoded.numberOfChannels || decoded.numberOfChannels > 2) throw new Error("Render supports mono/stereo inputs up to 180 seconds and an available input channel.");
  const frames = Math.ceil((decoded.duration + tail) * rate);
  if (frames * 4 + 44 > 50 * 1024 * 1024) throw new Error("Rendered WAV would exceed 50 MiB.");
  const context = new OfflineAudioContext(2, frames, rate); await prepareRig(context, rig); aborted();
  const graph = new RigGraph(context, rig, irs), source = context.createBufferSource();
  const mono = context.createBuffer(1, decoded.length, rate); mono.copyToChannel(decoded.getChannelData(channel), 0); source.buffer = mono;
  const guard = context.createWaveShaper(); guard.curve = new Float32Array([-0.95, 0, 0.95]); source.connect(graph.input); graph.output.connect(guard).connect(context.destination);
  const onAbort = () => { try { source.stop(); } catch { /* Not started yet. */ } graph.dispose(); };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const start = performance.now();
  try {
    source.start(); const buffer = await context.startRendering(); aborted();
    return { blob: encodeRigWav(buffer), mimeType: "audio/wav", sampleRate: rate, durationSeconds: buffer.duration, renderMilliseconds: performance.now() - start, buffer };
  } finally { options.signal?.removeEventListener("abort", onAbort); graph.dispose(); source.disconnect(); guard.disconnect(); }
}
