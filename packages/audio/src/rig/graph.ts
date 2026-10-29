import { moduleDefinition, type Values } from "./catalog.ts";
import { allRigModules, parseRigPreset, validateControl, type RigModule, type RigPreset } from "./preset.ts";
import { cabinetImpulse, reverbImpulse, CabinetIRLibrary } from "./impulses.ts";

const db = (value: number) => 10 ** (value / 20);
const prepared = new WeakMap<BaseAudioContext, Promise<void>>();
export async function prepareRig(context: BaseAudioContext, preset: RigPreset): Promise<void> {
  if (!allRigModules(preset).some(item => ["gate", "pitch"].includes(item.type))) return;
  if (!context.audioWorklet || typeof AudioWorkletNode === "undefined") throw new Error("This rig requires AudioWorklet in HTTPS or localhost.");
  let pending = prepared.get(context);
  if (!pending) {
    pending = context.audioWorklet.addModule(new URL("./processor.js", import.meta.url).href).catch(error => { prepared.delete(context); throw error; });
    prepared.set(context, pending);
  }
  await pending;
}

interface Stage { input: GainNode; output: GainNode; update: (module: RigModule, time: number) => void; automate: (module: RigModule, key: string, time: number) => void }
function signature(preset: RigPreset): string {
  return JSON.stringify({ chain: preset.chain.map(item => [item.id, item.type, item.model]), parallel: preset.parallel && {
    after: preset.parallel.after, paths: preset.parallel.paths.map(path => [path.id, path.level_db, path.pan, path.chain.map(item => [item.id, item.type, item.model])]),
  }, buffers: allRigModules(preset).map(item => Object.entries(item.parameters).filter(([key]) => !moduleDefinition(item.type).controls[key].realtime)) });
}

export class RigGraph {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly nodes = new Set<AudioNode>();
  private readonly oscillators: AudioScheduledSourceNode[] = [];
  private readonly stages = new Map<string, Stage>();
  private readonly worklets: AudioWorkletNode[] = [];
  private readonly compressors: DynamicsCompressorNode[] = [];
  private wet!: GainNode;
  private dry!: GainNode;
  private active!: GainNode;
  private bypass = false;
  private disposed = false;
  private quantumFrames: number | null = null;
  private convolutionSeconds = 0;
  preset: RigPreset;
  onError?: (message: string) => void;
  private readonly context: BaseAudioContext;
  private readonly irs: CabinetIRLibrary;

  constructor(context: BaseAudioContext, preset: RigPreset, irs: CabinetIRLibrary) {
    this.context = context; this.irs = irs;
    this.preset = parseRigPreset(preset);
    this.input = this.gain(); this.output = this.gain();
    try {
      const input = this.stage(this.preset.chain[0]); this.input.connect(input.input);
      const output = this.stage(this.preset.chain.at(-1)!);
      this.wet = this.gain(); this.dry = this.gain(0); this.active = this.gain();
      this.dry.connect(output.input); this.wet.connect(output.input); output.output.connect(this.active).connect(this.output);
      input.output.connect(this.dry);
      let previous: AudioNode = input.output;
      const split = (node: AudioNode, after: string): AudioNode => {
        if (this.preset.parallel?.after !== after) return node;
        const merged = this.gain();
        for (const path of this.preset.parallel.paths) {
          let end: AudioNode = node;
          for (const item of path.chain) { const stage = this.stage(item); end.connect(stage.input); end = stage.output; }
          const pan = this.own(context.createStereoPanner()); pan.pan.value = path.pan;
          end.connect(this.gain(db(path.level_db))).connect(pan).connect(merged);
        }
        return merged;
      };
      previous = split(previous, this.preset.chain[0].id);
      for (const item of this.preset.chain.slice(1, -1)) {
        const stage = this.stage(item); previous.connect(stage.input); previous = split(stage.output, item.id);
      }
      previous.connect(this.wet);
    } catch (error) { this.dispose(); throw error; }
  }
  private own<T extends AudioNode>(node: T): T { this.nodes.add(node); return node; }
  private gain(value = 1): GainNode { const gain = this.own(this.context.createGain()); gain.gain.value = value; return gain; }
  private filter(type: BiquadFilterType, hz: number, q = Math.SQRT1_2, gain = 0): BiquadFilterNode {
    const node = this.own(this.context.createBiquadFilter()); node.type = type; node.frequency.value = Math.min(hz, this.context.sampleRate * 0.45); node.Q.value = q; node.gain.value = gain; return node;
  }
  private oscillator(type: OscillatorType = "sine"): OscillatorNode {
    const node = this.own(this.context.createOscillator()); node.type = type; this.oscillators.push(node); node.start(); return node;
  }
  private convolver(buffer: AudioBuffer, normalize = false): ConvolverNode {
    this.convolutionSeconds += buffer.duration;
    const node = this.own(this.context.createConvolver()); node.normalize = normalize; node.buffer = buffer; return node;
  }
  private stage(module: RigModule): Stage {
    const context = this.context, definition = moduleDefinition(module.type), model = definition.models.find(item => item.id === module.model)!;
    const input = this.gain(), output = this.gain(), bypass = this.gain(), enabled = this.gain();
    input.connect(bypass).connect(output);
    // Preserve unity below ±8, bound pathological stacks before the next processor.
    const headroom = this.gain(0.125), guard = this.own(context.createWaveShaper());
    guard.curve = new Float32Array([-8, 0, 8]); enabled.connect(headroom).connect(guard).connect(output);
    let initializing = true;
    const set = (parameter: AudioParam, value: number, time: number) => {
      if (initializing) parameter.value = value;
      else {
        if (time <= context.currentTime) parameter.cancelAndHoldAtTime(context.currentTime);
        parameter.setTargetAtTime(value, time, 0.015);
      }
    };
    const hz = (value: number) => Math.min(value, context.sampleRate * 0.45);
    const updates: { keys: Set<string>; apply: (p: Values, time: number) => void }[] = [];
    const bind = (parameter: AudioParam, value: (p: Values) => number) => {
      const keys = new Set<string>();
      value(new Proxy(module.parameters, { get(target, key: string) { keys.add(key); return target[key]; } }));
      updates.push({ keys, apply: (p, time) => set(parameter, value(p), time) });
    };
    const mixed = (start: AudioNode, end: AudioNode, value: (p: Values) => number = p => Number(p.mix)) => {
      const dry = this.gain(), wet = this.gain(); input.connect(dry).connect(enabled); input.connect(start); end.connect(wet).connect(enabled);
      bind(dry.gain, p => 1 - value(p)); bind(wet.gain, value);
    };
    const coeff = model.coefficients;
    switch (module.type) {
      case "input": {
        const gain = this.gain(); input.connect(gain).connect(enabled);
        bind(gain.gain, p => p.mute ? 0 : db(Number(p.trim_db)) * (p.invert ? -1 : 1)); break;
      }
      case "gate": case "pitch": {
        const worklet = this.own(new AudioWorkletNode(context, "modulo-rig-dsp", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { ...module.parameters, ...coeff, mode: module.type } }));
        this.worklets.push(worklet);
        worklet.port.onmessage = ({ data }) => { if (Number.isFinite(data.quantumFrames)) this.quantumFrames = data.quantumFrames; };
        worklet.onprocessorerror = () => this.onError?.(`Rig ${module.type} processor failed. Stop and reload the rig.`);
        updates.push({ keys: new Set(Object.keys(module.parameters)), apply: p => worklet.port.postMessage({ parameters: p }) });
        if (module.type === "gate") input.connect(worklet).connect(enabled); else mixed(worklet, worklet);
        break;
      }
      case "compressor": {
        const compressor = this.own(context.createDynamicsCompressor()); this.compressors.push(compressor);
        const makeup = this.gain(); compressor.connect(makeup); mixed(compressor, makeup);
        bind(compressor.threshold, p => Number(p.threshold_db)); bind(compressor.ratio, p => Number(p.ratio));
        bind(compressor.attack, p => Number(p.attack_ms) / 1000); bind(compressor.release, p => Number(p.release_ms) / 1000);
        bind(compressor.knee, p => Math.max(0, Math.min(40, Number(p.knee_db) + coeff.knee)));
        bind(makeup.gain, p => db(Number(p.makeup_db))); break;
      }
      case "boost": {
        const hp = this.filter("highpass", coeff.highpass), tone = this.filter("peaking", 1400, 0.8), gain = this.gain();
        input.connect(hp).connect(tone).connect(gain).connect(enabled);
        bind(tone.gain, p => coeff.tilt + (Number(p.tone) - 0.5) * 8); bind(gain.gain, p => db(Number(p.gain_db))); break;
      }
      case "overdrive": case "distortion": case "fuzz": case "amp": {
        const hp = this.filter("highpass", coeff.highpass), pre = this.gain(), shaper = this.own(context.createWaveShaper()), post = this.gain();
        const curve = new Float32Array(4097);
        for (let i = 0; i < curve.length; i++) {
          const x = i / 2048 - 1;
          curve[i] = coeff.shape === 1 ? Math.atan(4 * x) / Math.atan(4) : coeff.shape === 2 ? Math.max(-1, Math.min(1, 3 * x)) : coeff.shape === 3 ? (Math.tanh(4 * (x + 0.1)) - Math.tanh(0.4)) / 1.4 : Math.tanh(3 * x) / Math.tanh(3);
        }
        shaper.curve = curve; shaper.oversample = "4x";
        const dc = this.filter("highpass", 30), mid = this.filter("peaking", module.type === "overdrive" ? 750 : 1000, 0.8, coeff.mid), tone = this.filter("lowpass", coeff.cutoff);
        hp.connect(pre).connect(shaper).connect(dc).connect(post).connect(mid).connect(tone);
        if (module.type === "amp") {
          const bass = this.filter("lowshelf", 180), middle = this.filter("peaking", 850, 0.8), treble = this.filter("highshelf", 2800), presence = this.filter("highshelf", 4500), resonance = this.filter("lowshelf", 100);
          const power = this.own(context.createWaveShaper()); power.curve = curve.slice(); power.oversample = "2x";
          const master = this.gain(); input.connect(hp); tone.connect(bass).connect(middle).connect(treble).connect(presence).connect(resonance).connect(power).connect(master).connect(enabled);
          bind(pre.gain, p => 1 + coeff.pre * Number(p.gain) ** 2); bind(post.gain, p => 1 / Math.sqrt(1 + coeff.pre * Number(p.gain) ** 2));
          bind(bass.gain, p => Number(p.bass_db)); bind(middle.gain, p => Number(p.mid_db)); bind(treble.gain, p => Number(p.treble_db) + (p.bright ? 3 : 0));
          bind(presence.gain, p => Number(p.presence_db)); bind(resonance.gain, p => Number(p.resonance_db)); bind(master.gain, p => db(Number(p.master_db)));
        } else {
          const level = this.gain(); tone.connect(level); mixed(hp, level);
          bind(pre.gain, p => 1 + coeff.pre * Number(p.drive) ** 2); bind(post.gain, p => 1 / Math.sqrt(1 + coeff.pre * Number(p.drive) ** 2));
          bind(tone.frequency, p => hz(coeff.cutoff * (0.3 + 1.2 * Number(p.tone)))); bind(level.gain, p => db(Number(p.level_db)));
          if (module.type === "fuzz") {
            const bias = this.own(context.createConstantSource()); bias.connect(shaper); bias.start(); this.oscillators.push(bias);
            bind(bias.offset, p => Number(p.bias));
          }
        }
        break;
      }
      case "wah": {
        const filter = this.filter("bandpass", 1000, 5), gain = this.gain(); filter.connect(gain); mixed(filter, gain);
        bind(filter.frequency, p => hz(coeff.low * (coeff.high / coeff.low) ** Number(p.position))); bind(filter.Q, p => Number(p.q)); bind(gain.gain, p => db(Number(p.level_db))); break;
      }
      case "cabinet": {
        const hp = this.filter("highpass", 70), lp = this.filter("lowpass", 6500), level = this.gain(); hp.connect(lp).connect(level);
        const summed = this.gain(); summed.connect(hp);
        for (const second of [false, true]) {
          const buffer = module.model === "custom" ? this.irs.buffer(String(module.parameters.ir_id), context) : cabinetImpulse(module, context, second);
          const convolver = this.convolver(buffer), micFilter = this.filter("lowpass", 6500), micGain = this.gain(), delay = this.own(context.createDelay(0.02));
          input.connect(convolver).connect(micFilter).connect(delay).connect(micGain).connect(summed);
          const p = module.parameters, mic = String(second ? p.mic2 : p.mic), position = Number(second ? p.mic2_position : p.position), distance = Number(second ? p.mic2_distance : p.distance);
          micFilter.frequency.value = hz((mic === "ribbon" ? 4500 : mic === "condenser" ? 11000 : 7500) * (1 - 0.4 * position) / (1 + distance * 0.4));
          bind(micGain.gain, p => (second ? Number(p.mic_blend) * (p.mic2_invert ? -1 : 1) : 1 - Number(p.mic_blend)));
          bind(delay.delayTime, p => second ? Number(p.mic2_delay_ms) / 1000 : 0);
        }
        const dry = this.gain(), wet = this.gain(); input.connect(dry).connect(enabled); level.connect(wet).connect(enabled);
        bind(dry.gain, p => 1 - Number(p.mix)); bind(wet.gain, p => Number(p.mix)); bind(hp.frequency, p => hz(Number(p.low_cut_hz))); bind(lp.frequency, p => hz(Number(p.high_cut_hz))); bind(level.gain, p => db(Number(p.level_db))); break;
      }
      case "eq": {
        const hp = this.filter("highpass", 25), bass = this.filter("lowshelf", coeff.shelf || 250), mid = this.filter("peaking", 1000, 0.8), treble = this.filter("highshelf", 3000), lp = this.filter("lowpass", 16000);
        input.connect(hp).connect(bass).connect(mid).connect(treble).connect(lp).connect(enabled);
        bind(hp.frequency, p => hz(Number(p.low_cut_hz))); bind(bass.gain, p => Number(p.bass_db)); bind(mid.frequency, p => hz(Number(p.mid_hz))); bind(mid.Q, p => Number(p.mid_q)); bind(mid.gain, p => Number(p.mid_db)); bind(treble.gain, p => Number(p.treble_db)); bind(lp.frequency, p => hz(Number(p.high_cut_hz))); break;
      }
      case "chorus": case "flanger": {
        const sum = this.gain(), lfo = this.oscillator();
        for (let voice = 0; voice < 2; voice++) {
          const delay = this.own(context.createDelay(0.08)), filter = this.filter("lowpass", coeff.filter || 12000), pan = this.own(context.createStereoPanner()), voiceGain = this.gain(0.5 * (coeff.polarity || 1)), modulation = this.gain();
          input.connect(delay).connect(filter).connect(pan).connect(voiceGain).connect(sum); pan.pan.value = voice ? 0.8 : -0.8;
          lfo.connect(modulation).connect(delay.delayTime);
          bind(delay.delayTime, p => Number(p.delay_ms) / 1000);
          bind(modulation.gain, p => Number(p.depth_ms) / 1000 * (voice && (coeff.phase || coeff.stereo) ? -1 : 1));
          if (module.type === "flanger") { const feedback = this.gain(); filter.connect(feedback).connect(delay); bind(feedback.gain, p => Number(p.feedback)); }
        }
        const dry = this.gain(), wet = this.gain(); input.connect(dry).connect(enabled); sum.connect(wet).connect(enabled);
        bind(dry.gain, p => 1 - Number(p.mix)); bind(wet.gain, p => Number(p.mix)); bind(lfo.frequency, p => Number(p.rate_hz)); break;
      }
      case "phaser": {
        const first = this.filter("allpass", 500), lfo = this.oscillator(); let last = first;
        for (let i = 0; i < coeff.stages; i++) {
          const node = i === 0 ? first : this.filter("allpass", 500); if (i) last.connect(node); last = node;
          const depth = this.gain(); lfo.connect(depth).connect(node.frequency);
          bind(node.frequency, p => Number(p.center_hz) * (0.75 + i * 0.08)); bind(depth.gain, p => Number(p.center_hz) * Number(p.depth) * 0.5);
        }
        mixed(first, last); bind(lfo.frequency, p => Number(p.rate_hz)); break;
      }
      case "tremolo": {
        const gain = this.gain(), lfo = this.oscillator(coeff.wave === 1 ? "triangle" : coeff.wave === 2 ? "square" : "sine"), depth = this.gain();
        lfo.connect(depth).connect(gain.gain); mixed(gain, gain);
        bind(gain.gain, p => 1 - Number(p.depth) / 2); bind(depth.gain, p => Number(p.depth) / 2); bind(lfo.frequency, p => Number(p.rate_hz)); break;
      }
      case "delay": {
        const a = this.own(context.createDelay(2.1)), filter = this.filter("lowpass", 6000), feedback = this.gain();
        a.connect(filter);
        let tail: AudioNode = filter;
        if (coeff.pingpong) {
          const b = this.own(context.createDelay(2.1)), left = this.own(context.createStereoPanner()), right = this.own(context.createStereoPanner()), sum = this.gain();
          left.pan.value = -1; right.pan.value = 1; filter.connect(left).connect(sum); filter.connect(b).connect(right).connect(sum); b.connect(feedback).connect(a); tail = sum;
          bind(b.delayTime, p => this.delaySeconds(p));
        } else filter.connect(feedback).connect(a);
        mixed(a, tail); bind(a.delayTime, p => this.delaySeconds(p)); bind(feedback.gain, p => Number(p.feedback)); bind(filter.frequency, p => hz(Number(p.tone_hz) * coeff.dark)); break;
      }
      case "reverb": {
        const predelay = this.own(context.createDelay(0.3)), convolver = this.convolver(reverbImpulse(module, context), true), damping = this.filter("lowpass", 5000);
        predelay.connect(convolver).connect(damping); mixed(predelay, damping); bind(predelay.delayTime, p => Number(p.predelay_ms) / 1000); bind(damping.frequency, p => hz(Number(p.damping_hz))); break;
      }
      case "output": {
        const splitter = this.own(context.createChannelSplitter(2)), merger = this.own(context.createChannelMerger(2));
        const stereo = this.gain(); stereo.channelCount = 2; stereo.channelCountMode = "explicit"; input.connect(stereo).connect(splitter);
        for (const [source, target] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
          const gain = this.gain(); splitter.connect(gain, source); gain.connect(merger, 0, target); bind(gain.gain, p => (1 + (source === target ? 1 : -1) * Number(p.width)) / 2);
        }
        const pan = this.own(context.createStereoPanner()), level = this.gain(), limiter = this.own(context.createDynamicsCompressor()); this.compressors.push(limiter);
        limiter.ratio.value = 20; limiter.knee.value = 0; limiter.attack.value = 0.001;
        merger.connect(pan).connect(level).connect(limiter).connect(enabled);
        bind(pan.pan, p => Number(p.pan)); bind(level.gain, p => p.mute ? 0 : db(Number(p.level_db))); bind(limiter.threshold, p => Number(p.limiter_db)); bind(limiter.release, p => Number(p.limiter_release_ms) / 1000); break;
      }
    }
    const stage: Stage = { input, output, update: (next, time) => {
      set(bypass.gain, next.on ? 0 : 1, time); set(enabled.gain, next.on ? 1 : 0, time);
      for (const update of updates) update.apply(next.parameters, time);
    }, automate: (next, key, time) => {
      for (const update of updates) if (update.keys.has(key)) update.apply(next.parameters, time);
    } };
    stage.update(module, context.currentTime); initializing = false; this.stages.set(module.id, stage); return stage;
  }
  private delaySeconds(p: Values): number {
    const factor = p.division === "eighth" ? 0.5 : p.division === "dotted_eighth" ? 0.75 : p.division === "triplet" ? 1 / 3 : 1;
    return Math.min(2, p.sync ? 60 / this.preset.tempo_bpm * factor : Number(p.time_ms) / 1000);
  }
  canUpdate(preset: RigPreset): boolean { return signature(this.preset) === signature(preset); }
  update(preset: RigPreset): void {
    if (!this.canUpdate(preset)) throw new Error("Rig topology/buffers changed; rebuild required.");
    this.preset = parseRigPreset(preset);
    for (const module of allRigModules(this.preset)) this.stages.get(module.id)!.update(module, this.context.currentTime);
  }
  setParameter(id: string, parameter: string, value: number | boolean, atTime = this.context.currentTime): void {
    const module = allRigModules(this.preset).find(item => item.id === id); if (!module) throw new Error("Unknown rig module.");
    validateControl(module.type, parameter, value, true);
    if (!Number.isFinite(atTime) || atTime < this.context.currentTime - 0.02 || atTime > this.context.currentTime + 60) throw new Error("Automation must be within the next 60 seconds.");
    atTime = Math.max(atTime, this.context.currentTime);
    if (["gate", "pitch"].includes(module.type) && atTime > this.context.currentTime + 0.01) throw new Error("Worklet controls support immediate/MIDI changes; future automation requires native controls.");
    module.parameters[parameter] = value; this.stages.get(id)!.automate(module, parameter, atTime);
  }
  setBypass(value: boolean): void {
    this.bypass = value; const time = this.context.currentTime;
    this.wet.gain.setTargetAtTime(value ? 0 : 1, time, 0.015); this.dry.gain.setTargetAtTime(value ? 1 : 0, time, 0.015);
  }
  setActive(value: boolean): void { this.active.gain.setTargetAtTime(value ? 1 : 0, this.context.currentTime, 0.005); }
  silence(): void { this.active.gain.cancelScheduledValues(this.context.currentTime); this.active.gain.setValueAtTime(0, this.context.currentTime); }
  fadeIn(): void { this.active.gain.value = 0; this.active.gain.setTargetAtTime(1, this.context.currentTime, 0.01); }
  diagnostics() { return { moduleCount: this.stages.size, nodeCount: this.nodes.size, convolutionSeconds: this.convolutionSeconds, renderQuantumFrames: this.quantumFrames, bypass: this.bypass, compressorReductionDb: this.compressors.map(item => item.reduction) }; }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    for (const worklet of this.worklets) { worklet.port.postMessage({ dispose: true }); worklet.port.onmessage = null; worklet.onprocessorerror = null; worklet.port.close(); }
    for (const source of this.oscillators) { try { source.stop(); } catch { /* Already stopped. */ } }
    for (const node of this.nodes) node.disconnect(); this.nodes.clear();
  }
}
