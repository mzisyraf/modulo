import { moduleDefinition } from "./catalog.ts";
import type { RigModule } from "./preset.ts";

export interface UserIR { id: string; name: string; sampleRate: number; channels: Float32Array[]; hash: string; source: "user" }
export class CabinetIRLibrary {
  private entries = new Map<string, UserIR>();
  private pending = new Set<string>();
  private generation = 0;
  list(): Omit<UserIR, "channels">[] { return Array.from(this.entries.values(), ({ channels, ...info }) => ({ ...info })); }
  remove(id: string): void { this.entries.delete(id); }
  clear(): void { this.generation++; this.entries.clear(); this.pending.clear(); }
  async load(id: string, file: File, context: BaseAudioContext): Promise<Omit<UserIR, "channels">> {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || id === "none") throw new Error("Use a safe custom IR ID.");
    if (file.size <= 0 || file.size > 2 * 1024 * 1024) throw new Error("IR files must be at most 2 MiB.");
    if (this.pending.has(id)) throw new Error("This IR is already importing.");
    if (!this.entries.has(id) && new Set([...this.entries.keys(), ...this.pending]).size >= 12) throw new Error("At most 12 custom IRs may be loaded.");
    this.pending.add(id); const generation = this.generation;
    try {
    const bytes = await file.arrayBuffer();
    const decoded = await context.decodeAudioData(bytes.slice(0));
    if (decoded.duration > 0.5 || decoded.numberOfChannels > 2 || decoded.length < 1) throw new Error("Cabinet IR must be mono/stereo and no longer than 500 ms.");
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel).slice());
    let total = 0;
    for (const channel of channels) for (const value of channel) {
      if (!Number.isFinite(value)) throw new Error("IR contains non-finite samples."); total += Math.abs(value);
    }
    if (total < 1e-8) throw new Error("IR is silent.");
    // Bounded average channel L1 norm; preserve this bound when resampling below.
    const normalization = Math.max(1, total / channels.length);
    for (const channel of channels) for (let i = 0; i < channel.length; i++) channel[i] /= normalization;
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
    if (generation !== this.generation) throw new DOMException("IR import canceled.", "AbortError");
    this.entries.set(id, { id, name: file.name.slice(0, 120), channels, sampleRate: decoded.sampleRate, hash, source: "user" });
    return this.list().find(item => item.id === id)!;
    } finally { if (generation === this.generation) this.pending.delete(id); }
  }
  buffer(id: string, context: BaseAudioContext): AudioBuffer {
    const entry = this.entries.get(id); if (!entry) throw new Error(`Custom IR ${id} is not loaded. Import it before applying this rig.`);
    const length = Math.max(1, Math.round(entry.channels[0].length * context.sampleRate / entry.sampleRate));
    const buffer = context.createBuffer(entry.channels.length, length, context.sampleRate);
    for (let channel = 0; channel < entry.channels.length; channel++) {
      const target = buffer.getChannelData(channel), source = entry.channels[channel];
      let sourceNorm = 0, targetNorm = 0;
      for (const value of source) sourceNorm += Math.abs(value);
      for (let i = 0; i < length; i++) {
        const position = i * entry.sampleRate / context.sampleRate; const left = Math.min(source.length - 1, Math.floor(position));
        target[i] = source[left] + (source[Math.min(left + 1, source.length - 1)] - source[left]) * (position - left);
        targetNorm += Math.abs(target[i]);
      }
      const scale = targetNorm > 0 ? sourceNorm / targetNorm : 1;
      for (let i = 0; i < length; i++) target[i] *= scale;
    }
    return buffer;
  }
}

export function cabinetImpulse(module: RigModule, context: BaseAudioContext, second = false): AudioBuffer {
  const model = moduleDefinition("cabinet").models.find(item => item.id === module.model)!;
  const p = module.parameters, position = Number(second ? p.mic2_position : p.position), distance = Number(second ? p.mic2_distance : p.distance);
  const mic = String(second ? p.mic2 : p.mic);
  const decay = model.coefficients.decay * (1 + distance);
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.16), context.sampleRate);
  const data = buffer.getChannelData(0);
  const cutoff = model.coefficients.brightness * (1 - 0.5 * position) * (mic === "ribbon" ? 0.7 : mic === "condenser" ? 1.3 : 1);
  // Deterministic damped resonances + low-passed pulse. Original synthetic design, not a captured cabinet.
  const alpha = 1 - Math.exp(-2 * Math.PI * cutoff / context.sampleRate);
  let low = 0, sum = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / context.sampleRate;
    low += alpha * ((i === 0 ? 1 : 0) - low);
    data[i] = low + 1.2 / (context.sampleRate * decay) * Math.exp(-t / decay) * (Math.sin(2 * Math.PI * model.coefficients.resonance * t) + 0.4 * Math.sin(2 * Math.PI * 730 * t));
    sum += Math.abs(data[i]);
  }
  for (let i = 0; i < data.length; i++) data[i] /= Math.max(1, sum);
  return buffer;
}

export function reverbImpulse(module: RigModule, context: BaseAudioContext): AudioBuffer {
  const seconds = Number(module.parameters.decay_s);
  const buffer = context.createBuffer(2, Math.ceil(context.sampleRate * seconds), context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    let seed = 2107 + channel * 57, low = 0;
    const alpha = 1 - Math.exp(-2 * Math.PI * (module.model === "room" ? 1700 : 4500) / context.sampleRate);
    for (let i = 0; i < buffer.length; i++) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      const noise = seed / 2147483648 - 1, t = i / context.sampleRate;
      const signal = module.model === "spring" ? 0.65 * Math.sin((1200 + 500 * t) * t * 2 * Math.PI) + noise * 0.35 : noise;
      low += alpha * (signal - low);
      buffer.getChannelData(channel)[i] = low * Math.exp(-6.91 * t / seconds) * 0.06;
    }
  }
  // Convolver normalization is enabled for reverbs; output wet level still bounded by mix.
  return buffer;
}
