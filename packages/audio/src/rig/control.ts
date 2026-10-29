import { moduleDefinition } from "./catalog.ts";
import { allRigModules, parseRigPreset, validateControl, type MidiBinding, type RigPreset } from "./preset.ts";

export function expressionValue(binding: Pick<MidiBinding, "min" | "max" | "curve">, position: number): number {
  if (!Number.isFinite(position) || position < 0 || position > 1) throw new Error("Expression position must be between 0 and 1.");
  if (!Number.isFinite(binding.min) || !Number.isFinite(binding.max) || !["linear", "squared"].includes(binding.curve)) throw new Error("Invalid expression range or curve.");
  return binding.min + (binding.max - binding.min) * (binding.curve === "squared" ? position * position : position);
}

interface MidiTarget {
  get: () => RigPreset;
  parameter: (module: string, parameter: string, value: number) => void;
  snapshot: (id: string) => Promise<unknown>;
  binding: (binding: MidiBinding) => void;
}
export class RigMidiController {
  private readonly target: MidiTarget;
  private generation = 0;
  private access?: MIDIAccess;
  private attached = new Map<string, MIDIInput>();
  private learnTarget?: Omit<MidiBinding, "channel" | "cc">;
  onError?: (error: unknown) => void;
  onLearn?: (binding: MidiBinding) => void;
  constructor(target: MidiTarget) { this.target = target; }
  learn(module: string, parameter: string, min: number, max: number, curve: "linear" | "squared" = "linear"): void {
    const rig = this.target.get(), item = allRigModules(rig).find(item => item.id === module);
    if (!item || moduleDefinition(item.type).controls[parameter]?.kind !== "number") throw new Error("Choose a numeric realtime MIDI target.");
    validateControl(item.type, parameter, min, true); validateControl(item.type, parameter, max, true);
    this.learnTarget = { module, parameter, min, max, curve, toggle: false };
  }
  cancelLearn(): void { this.learnTarget = undefined; }
  async handle(data: ArrayLike<number>): Promise<void> {
    if (data.length < 2) return;
    const status = data[0], channel = status & 15;
    if (!Number.isInteger(status) || status < 0x80 || status > 0xef || !Number.isInteger(data[1]) || data[1] < 0 || data[1] > 127) return;
    if ((status & 0xf0) === 0xc0) {
      const entry = this.target.get().midi.programs.find(item => item.channel === channel && item.program === data[1]);
      if (entry) await this.target.snapshot(entry.snapshot);
    }
    if ((status & 0xf0) !== 0xb0 || data.length < 3 || !Number.isInteger(data[2]) || data[2] < 0 || data[2] > 127) return;
    if (this.learnTarget) {
      const binding = { ...this.learnTarget, channel, cc: data[1] };
      this.target.binding(binding); this.learnTarget = undefined; this.onLearn?.(binding);
    }
    for (const binding of this.target.get().midi.bindings) if (binding.channel === channel && binding.cc === data[1]) {
      this.target.parameter(binding.module, binding.parameter, expressionValue(binding, data[2] / 127));
    }
  }
  private message = (event: MIDIMessageEvent) => { if (event.data) void this.handle(event.data).catch(error => this.onError?.(error)); };
  private refresh = () => {
    for (const input of this.attached.values()) input.removeEventListener("midimessage", this.message);
    this.attached.clear();
    for (const input of this.access?.inputs.values() ?? []) if (input.state === "connected") {
      input.addEventListener("midimessage", this.message); this.attached.set(input.id, input);
    }
  };
  /** Must be initiated by the user; no MIDI permission is requested during rig construction. */
  async connect(): Promise<{ id: string; name: string }[]> {
    this.target.get();
    if (!globalThis.navigator?.requestMIDIAccess) throw new Error("Web MIDI is unavailable in this browser.");
    this.disconnect(); const generation = this.generation;
    const access = await navigator.requestMIDIAccess({ sysex: false });
    if (generation !== this.generation) return [];
    this.access = access;
    this.access.addEventListener("statechange", this.refresh); this.refresh();
    return Array.from(this.attached.values(), input => ({ id: input.id, name: input.name || "MIDI input" }));
  }
  disconnect(): void {
    this.generation++;
    this.access?.removeEventListener("statechange", this.refresh);
    for (const input of this.attached.values()) input.removeEventListener("midimessage", this.message);
    this.attached.clear(); this.access = undefined; this.cancelLearn();
  }
}

export function addMidiBinding(preset: RigPreset, binding: MidiBinding): RigPreset {
  const next = structuredClone(preset);
  next.midi.bindings = [...next.midi.bindings.filter(item => !(item.channel === binding.channel && item.cc === binding.cc && item.module === binding.module && item.parameter === binding.parameter)), binding];
  return parseRigPreset(next);
}

export interface TunerReading { frequencyHz: number; midiNote: number; note: string; cents: number; confidence: number }
export function estimatePitch(samples: Float32Array, sampleRate: number, referenceHz = 440): TunerReading | null {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || !Number.isFinite(referenceHz) || referenceHz < 430 || referenceHz > 450) throw new Error("Invalid tuner settings.");
  const size = Math.min(samples.length, 8192);
  if (size < 1024) return null;
  let mean = 0; for (let i = 0; i < size; i++) { if (!Number.isFinite(samples[i])) return null; mean += samples[i]; } mean /= size;
  let energy = 0; for (let i = 0; i < size; i++) energy += (samples[i] - mean) ** 2;
  if (Math.sqrt(energy / size) < 0.002) return null;
  const first = Math.floor(sampleRate / 1400), last = Math.min(Math.floor(sampleRate / 60), Math.floor(size / 2));
  const correlations = new Float64Array(last + 1); let best = 0;
  for (let lag = first; lag <= last; lag++) {
    let cross = 0, a = 0, b = 0;
    for (let i = 0; i < size - lag; i++) { const x = samples[i] - mean, y = samples[i + lag] - mean; cross += x * y; a += x * x; b += y * y; }
    correlations[lag] = cross / Math.sqrt(Math.max(1e-20, a * b)); best = Math.max(best, correlations[lag]);
  }
  if (best < 0.85) return null;
  let lag = first + 1;
  for (; lag < last; lag++) if (correlations[lag] >= best * 0.97 && correlations[lag] >= correlations[lag - 1] && correlations[lag] >= correlations[lag + 1]) break;
  if (lag >= last) return null;
  const left = correlations[lag - 1], center = correlations[lag], right = correlations[lag + 1];
  const denominator = left - 2 * center + right;
  const offset = Math.abs(denominator) > 1e-12 ? 0.5 * (left - right) / denominator : 0;
  const frequencyHz = sampleRate / (lag + offset), fractional = 69 + 12 * Math.log2(frequencyHz / referenceHz), midiNote = Math.round(fractional);
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  return { frequencyHz, midiNote, note: names[((midiNote % 12) + 12) % 12] + (Math.floor(midiNote / 12) - 1), cents: (fractional - midiNote) * 100, confidence: center };
}
