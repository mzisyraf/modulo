import { parsePreset, type Preset } from "@modulo/contracts";
import { driveCurve, pluckSamples } from "./dsp.ts";

export class AudioEngine {
  private context?: AudioContext;
  private input?: GainNode;
  private shaper?: WaveShaperNode;
  private bass?: BiquadFilterNode;
  private mid?: BiquadFilterNode;
  private treble?: BiquadFilterNode;
  private wet?: GainNode;
  private dry?: GainNode;
  private master?: GainNode;
  private source?: AudioBufferSourceNode;
  private preset: Preset;
  private request = 0;
  private disposed = false;
  private bypass = false;
  onEnded?: () => void;

  constructor(preset: Preset) {
    this.preset = parsePreset(preset);
  }

  applyPreset(value: Preset): void {
    this.preset = parsePreset(value);
    if (!this.context) return;
    const parameters = this.preset.parameters;
    const time = this.context.currentTime;
    this.input!.gain.setTargetAtTime(10 ** (parameters.input_gain_db / 20), time, 0.015);
    this.shaper!.curve = driveCurve(parameters.drive);
    this.bass!.gain.setTargetAtTime(parameters.bass_db, time, 0.015);
    this.mid!.gain.setTargetAtTime(parameters.mid_db, time, 0.015);
    this.treble!.gain.setTargetAtTime(parameters.treble_db, time, 0.015);
    this.master!.gain.setTargetAtTime(10 ** (parameters.master_gain_db / 20), time, 0.015);
  }

  setBypass(bypass: boolean): void {
    this.bypass = bypass;
    if (!this.context) return;
    this.wet!.gain.setTargetAtTime(bypass ? 0 : 1, this.context.currentTime, 0.015);
    this.dry!.gain.setTargetAtTime(bypass ? 1 : 0, this.context.currentTime, 0.015);
  }

  private async initialize(): Promise<AudioContext> {
    if (this.disposed) throw new Error("Audio engine is closed.");
    if (!this.context) {
      const context = new AudioContext({ latencyHint: "interactive" });
      this.context = context;
      this.input = context.createGain();
      this.shaper = context.createWaveShaper();
      this.shaper.oversample = "2x";
      this.bass = context.createBiquadFilter();
      this.bass.type = "lowshelf";
      this.bass.frequency.value = 250;
      this.mid = context.createBiquadFilter();
      this.mid.type = "peaking";
      this.mid.frequency.value = 1000;
      this.mid.Q.value = 0.8;
      this.treble = context.createBiquadFilter();
      this.treble.type = "highshelf";
      this.treble.frequency.value = 3000;
      this.wet = context.createGain();
      this.dry = context.createGain();
      this.master = context.createGain();
      this.input.gain.value = 10 ** (this.preset.parameters.input_gain_db / 20);
      this.master.gain.value = 10 ** (this.preset.parameters.master_gain_db / 20);
      this.wet.gain.value = this.bypass ? 0 : 1;
      this.dry.gain.value = this.bypass ? 1 : 0;
      this.input.connect(this.shaper).connect(this.bass).connect(this.mid).connect(this.treble).connect(this.wet).connect(this.master);
      this.input.connect(this.dry).connect(this.master);
      // Bound the output even when stacked EQ boosts exceed full scale.
      const outputGuard = context.createWaveShaper();
      outputGuard.curve = new Float32Array([-0.95, 0, 0.95]);
      this.master.connect(outputGuard).connect(context.destination);
      this.applyPreset(this.preset);
      this.setBypass(this.bypass);
    }
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }

  private async play(createBuffer: (context: AudioContext) => Promise<AudioBuffer> | AudioBuffer): Promise<boolean> {
    this.stop();
    const request = this.request;
    const context = await this.initialize();
    const buffer = await createBuffer(context);
    if (request !== this.request || this.disposed) return false;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.input!);
    this.source = source;
    source.onended = () => { this.stop(); this.onEnded?.(); };
    source.start();
    return true;
  }

  playTestSignal(): Promise<boolean> {
    return this.play((context) => {
      const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      buffer.copyToChannel(pluckSamples(context.sampleRate), 0);
      return buffer;
    });
  }

  playFile(file: File): Promise<boolean> {
    if (file.size > 20 * 1024 * 1024) return Promise.reject(new Error("Use a dry recording under 20 MB."));
    return this.play(async (context) => context.decodeAudioData(await file.arrayBuffer()));
  }

  stop(): void {
    this.request++;
    if (!this.source) return;
    this.source.onended = null;
    this.source.stop();
    this.source.disconnect();
    this.source = undefined;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.stop();
    await this.context?.close();
    this.context = undefined;
  }
}
