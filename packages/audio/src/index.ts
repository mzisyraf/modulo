import { parsePreset, type Preset } from "@modulo/contracts";
import { driveSettings, saturationCurve, pluckSamples } from "./dsp.ts";
import { CalibrationBuffer, calibrationFrameLimit, inputLevel, type CalibrationAudio, type InputLevel } from "./calibration.ts";
export type { CalibrationAudio, CalibrationFlag, InputLevel } from "./calibration.ts";
import { recordProcessedOutput, type ProcessedRecording, type PerformanceRecordingOptions, type PerformanceTake } from "./recording.ts";
export { MAX_RECORDING_SECONDS, MAX_RECORDING_BYTES } from "./recording.ts";
export type { PerformanceTake, PerformanceRecordingOptions } from "./recording.ts";
import { RigGraph, prepareRig } from "./rig/graph.ts";
import { CabinetIRLibrary } from "./rig/impulses.ts";
import { allRigModules, parseRigPreset, applyRigSnapshot, snapshotRig, validateControl, type RigPreset } from "./rig/preset.ts";
import { RigMidiController, addMidiBinding, estimatePitch, expressionValue } from "./rig/control.ts";
import { renderRigFile, type RigRenderOptions } from "./rig/render.ts";
import { recordRig, type RigRecording, type RigRecordingOptions, type RigTake } from "./rig/recording.ts";
export * from "./rig/catalog.ts";
export * from "./rig/preset.ts";
export * from "./rig/control.ts";
export { factoryRigPresets } from "./rig/factory.ts";
export * from "./rig/models.ts";
export * from "./rig/proposal.ts";
import { modelFor, parameterToDSP } from "./rig/models.ts";
export { editRig, recommendedModels, type RigEdit } from "./rig/editor.ts";
export { CabinetIRLibrary } from "./rig/impulses.ts";
export { renderRigFile, renderRigBuffer, encodeRigWav, type RigRenderOptions } from "./rig/render.ts";
export type { RigTake, RigRecordingOptions } from "./rig/recording.ts";

export interface LiveInputInfo {
  /** Zero-based hardware input channel. */
  channel: 0 | 1;
  trackLabel: string;
  settings: MediaTrackSettings;
  contextSampleRate: number;
  /** Browser estimates in seconds, not measured round-trip latency. */
  baseLatencySeconds?: number;
  outputLatencySeconds?: number;
}

export interface CalibrationTake extends CalibrationAudio {
  input: LiveInputInfo;
}

export class AudioEngine {
  private context?: AudioContext | OfflineAudioContext;
  private input?: GainNode;
  private shaper?: WaveShaperNode;
  private drivePre?: GainNode;
  private drivePost?: GainNode;
  private driveClean?: GainNode;
  private driveWet?: GainNode;
  private bass?: BiquadFilterNode;
  private mid?: BiquadFilterNode;
  private treble?: BiquadFilterNode;
  private wet?: GainNode;
  private dry?: GainNode;
  private master?: GainNode;
  private outputGuard?: WaveShaperNode;
  private performanceRecording?: ProcessedRecording;
  private rigRecording?: RigRecording;
  private rawTap?: GainNode;
  private rig?: RigGraph;
  private rigRequest = 0;
  private rigNeedsReset = false;
  private retiredRigs = new Map<RigGraph, ReturnType<typeof setTimeout>>();
  private readonly irs = new CabinetIRLibrary();
  private tunerMuted = false;
  private tunerSamples = new Float32Array(4096);
  private tuner?: AnalyserNode;
  readonly midi: RigMidiController;
  onRigError?: (message: string) => void;
  /** UI subscription; callbacks must not throw into the audio-engine lifecycle. */
  onRigChange?: (preset: RigPreset | null) => void;
  private source?: AudioBufferSourceNode;
  private liveSource?: MediaStreamAudioSourceNode;
  private liveSplitter?: ChannelSplitterNode;
  private liveStream?: MediaStream;
  private liveEnded?: () => void;
  private liveInfo?: LiveInputInfo;
  private meter?: AnalyserNode;
  private meterSamples = new Float32Array(2048);
  private calibration?: { finish: () => void; cancel: () => void };
  private calibrationModule?: Promise<void>;
  private preset: Preset;
  private request = 0;
  private disposed = false;
  private bypass = false;
  private dryListeningGain = 1;
  private wetListeningGain = 1;
  onEnded?: () => void;

  constructor(preset: Preset) {
    this.preset = parsePreset(preset);
    this.midi = new RigMidiController({
      get: () => this.requireRig(), parameter: (id, key, value) => this.setRigParameter(id, key, value),
      snapshot: id => this.loadRigSnapshot(id),
      binding: binding => { this.rig!.preset = addMidiBinding(this.requireRig(), binding); this.notifyRig(); },
    });
  }

  applyPreset(value: Preset): void {
    this.preset = parsePreset(value);
    this.rigRequest++;
    if (this.rig) {
      this.releaseRig(this.rig); this.rig = undefined; this.rigNeedsReset = false;
      this.input!.connect(this.drivePre!); this.input!.connect(this.driveClean!);
    }
    this.clearRetiredRigs(); this.midi.disconnect();
    this.updateLegacyPreset(); this.setBypass(this.bypass);
    this.notifyRig();
  }

  private notifyRig(): void { try { this.onRigChange?.(this.getRigPreset()); } catch { /* UI observers cannot break audio cleanup or controls. */ } }

  private updateLegacyPreset(): void {
    if (!this.context) return;
    const parameters = this.preset.parameters;
    const time = this.context.currentTime;
    this.input!.gain.setTargetAtTime(10 ** (parameters.input_gain_db / 20), time, 0.015);
    const drive = driveSettings(parameters.drive);
    this.drivePre!.gain.setTargetAtTime(drive.preGain, time, 0.015);
    this.drivePost!.gain.setTargetAtTime(drive.postGain, time, 0.015);
    this.driveClean!.gain.setTargetAtTime(drive.clean, time, 0.015);
    this.driveWet!.gain.setTargetAtTime(drive.distorted, time, 0.015);
    this.bass!.gain.setTargetAtTime(parameters.bass_db, time, 0.015);
    this.mid!.gain.setTargetAtTime(parameters.mid_db, time, 0.015);
    this.treble!.gain.setTargetAtTime(parameters.treble_db, time, 0.015);
    this.master!.gain.setTargetAtTime(this.tunerMuted ? 0 : 10 ** (parameters.master_gain_db / 20), time, 0.015);
  }

  setBypass(bypass: boolean): void {
    this.bypass = bypass;
    if (!this.context) return;
    if (this.rig) { this.rig.setBypass(bypass); return; }
    this.wet!.gain.setTargetAtTime(bypass ? 0 : this.wetListeningGain, this.context.currentTime, 0.015);
    this.dry!.gain.setTargetAtTime(bypass ? this.dryListeningGain : 0, this.context.currentTime, 0.015);

  }

  /** Transient file-comparison levels after effects, before master/output protection; not preset parameters. */
  setListeningGains(originalDb: number, processedDb: number): void {
    if (![originalDb,processedDb].every(x=>Number.isFinite(x)&&x>=-48&&x<=48)) throw new Error("Listening gains must be between -48 and +48 dB.");
    this.dryListeningGain=10**(originalDb/20);this.wetListeningGain=10**(processedDb/20);
    this.setBypass(this.bypass);
  }

  private initialize(): Promise<AudioContext>;
  private initialize(offline: OfflineAudioContext): Promise<OfflineAudioContext>;
  private async initialize(offline?: OfflineAudioContext): Promise<AudioContext | OfflineAudioContext> {
    if (this.disposed) throw new Error("Audio engine is closed.");
    if (!this.context) {
      const context = offline ?? new AudioContext({ latencyHint: "interactive" });
      this.context = context;
      this.input = context.createGain();
      this.rawTap = context.createGain();
      this.rawTap.connect(this.input);
      this.shaper = context.createWaveShaper();
      this.shaper.oversample = "4x";
      this.shaper.curve = saturationCurve();
      this.drivePre = context.createGain();
      this.drivePost = context.createGain();
      this.driveClean = context.createGain();
      this.driveWet = context.createGain();
      const drive = driveSettings(this.preset.parameters.drive);
      this.drivePre.gain.value = drive.preGain;
      this.drivePost.gain.value = drive.postGain;
      this.driveClean.gain.value = drive.clean;
      this.driveWet.gain.value = drive.distorted;
      const driveHighpass = context.createBiquadFilter();
      driveHighpass.type = "highpass";
      driveHighpass.frequency.value = 50;
      driveHighpass.Q.value = Math.SQRT1_2;
      const driveLowpass = context.createBiquadFilter();
      driveLowpass.type = "lowpass";
      driveLowpass.frequency.value = 6500;
      driveLowpass.Q.value = Math.SQRT1_2;
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
      this.wet.gain.value = this.bypass ? 0 : this.wetListeningGain;
      this.dry.gain.value = this.bypass ? this.dryListeningGain : 0;
      this.input.connect(this.drivePre).connect(this.shaper).connect(this.drivePost)
        .connect(driveHighpass).connect(driveLowpass).connect(this.driveWet).connect(this.bass);
      this.input.connect(this.driveClean).connect(this.bass);
      this.bass.connect(this.mid).connect(this.treble).connect(this.wet).connect(this.master);

      this.input.connect(this.dry).connect(this.master);
      // Bound the output even when stacked EQ boosts exceed full scale.
      const outputGuard = context.createWaveShaper();
      this.outputGuard = outputGuard;
      outputGuard.curve = new Float32Array([-0.95, 0, 0.95]);
      this.master.connect(outputGuard).connect(context.destination);
      this.updateLegacyPreset();
      this.setBypass(this.bypass);
    }
    if (this.rig && this.rigNeedsReset) {
      const replacement = new RigGraph(this.context, this.rig.preset, this.irs);
      this.releaseRig(this.rig); this.rig = replacement; this.connectRig(replacement); this.rigNeedsReset = false;
    }
    if (!offline && this.context.state === "suspended") await this.context.resume();

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
    source.connect(this.rawTap!);
    this.source = source;
    source.onended = () => { this.stop(); this.onEnded?.(); };
    source.start();
    this.rig?.setActive(true);
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

  /** Render the same protected amp graph without a speaker/microphone context. */
  static async renderFile(file: File, preset: Preset, bypass = false): Promise<AudioBuffer> {
    if (!file.size || file.size > 20*1024*1024) throw new Error("Use a nonempty recording up to 20 MiB.");
    const engine = new AudioEngine(preset);
    engine.setBypass(bypass);
    const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await file.arrayBuffer());
    if (decoded.numberOfChannels > 2 || decoded.duration > 90 || decoded.duration < .1) throw new Error("Render mono/stereo audio lasting 0.1–90 seconds.");
    const context = new OfflineAudioContext(decoded.numberOfChannels, decoded.length, decoded.sampleRate);
    try {
      await engine.initialize(context);
      const source = context.createBufferSource(); source.buffer = decoded;
      source.connect(engine.input!); source.start();
      const rendered = await context.startRendering();
      source.disconnect();
      return rendered;
    } finally { await engine.dispose(); }
  }

  /** Call from a user gesture. False means a newer start/stop canceled this request. */
  async startLive(deviceId?: string, channel: number = 0, monitor = true): Promise<LiveInputInfo | false> {
    if (this.disposed) throw new Error("Audio engine is closed.");
    if (channel !== 0 && channel !== 1) throw new Error("Choose input channel 0 or 1.");
    this.stop();
    const request = this.request;
    let stream: MediaStream | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let splitter: ChannelSplitterNode | undefined;
    try {
      const context = await this.initialize();
      if (request !== this.request || this.disposed) return false;
      if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
        throw new Error("Live input requires media capture in HTTPS or localhost.");
      }
      stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          channelCount: { ideal: 2 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (request !== this.request || this.disposed) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState === "ended") throw new Error("No active audio input was returned.");
      const settings = track.getSettings();
      // Do not silently route a missing/unconfirmed right channel as silence.
      if (channel === 1 && !(settings.channelCount && settings.channelCount >= 2)) {
        throw new Error("The browser did not confirm a second input channel. Choose channel 0.");
      }
      // A single-track stream removes any ambiguity about which track is routed.
      source = context.createMediaStreamSource(new MediaStream([track]));
      splitter = context.createChannelSplitter(2);
      source.connect(splitter);
      if (monitor) splitter.connect(this.rawTap!, channel, 0);

      const ended = () => {
        if (this.liveStream !== stream) return;
        this.stop();
        this.onEnded?.();
      };
      this.liveStream = stream;
      this.liveSource = source;
      this.liveSplitter = splitter;
      this.liveEnded = ended;
      track.addEventListener("ended", ended);
      const info: LiveInputInfo = {
        channel,
        trackLabel: track.label,
        settings,
        contextSampleRate: context.sampleRate,
        baseLatencySeconds: context.baseLatency,
        outputLatencySeconds: context.outputLatency,
      };
      this.liveInfo = info;
      this.rig?.setActive(true);
      return structuredClone(info);
    } catch (error) {
      source?.disconnect();
      splitter?.disconnect();
      stream?.getTracks().forEach((track) => track.stop());
      if (request !== this.request || this.disposed) return false;
      throw error;
    }
  }

  /** Poll from the UI (e.g. requestAnimationFrame); null means no live input. */
  getInputLevel(): InputLevel | null {
    if (!this.context || !this.liveSplitter || !this.liveInfo) return null;
    if (!this.meter) {
      this.meter = this.context.createAnalyser();
      this.meter.fftSize = this.meterSamples.length;
      this.liveSplitter.connect(this.meter, this.liveInfo.channel, 0);
    }
    this.meter.getFloatTimeDomainData(this.meterSamples);
    return inputLevel(this.meterSamples);
  }

  /** Capture an already-started live input; does not request permission or upload audio. */
  async startCalibration(maxSeconds = 10): Promise<CalibrationTake> {
    const context = this.context;
    const splitter = this.liveSplitter;
    const info = this.liveInfo;
    if (!context || !splitter || !info) throw new Error("Start live input before calibration.");
    const maxFrames = calibrationFrameLimit(context.sampleRate, maxSeconds);
    if (this.calibration) throw new Error("Calibration is already running.");
    if (!context.audioWorklet || typeof AudioWorkletNode === "undefined") {
      throw new Error("Calibration requires AudioWorklet support in HTTPS or localhost.");
    }
    // Reserve the session before asynchronous module loading so stop/cancel also wins here.
    return new Promise<CalibrationTake>((resolve, reject) => {
      let node: AudioWorkletNode | undefined;
      let connected = false;
      let settled = false;
      let finishRequested = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        clearTimeout(timer);
        if (node) {
          if (connected) splitter.disconnect(node);
          node.disconnect();
          node.port.onmessage = null;
          node.onprocessorerror = null;
          node.port.close();
        }
        if (this.calibration === session) this.calibration = undefined;
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const session = {
        finish: () => {
          finishRequested = true;
          node?.port.postMessage("finish");
        },
        cancel: () => fail(new DOMException("Calibration canceled; retry with live input active.", "AbortError")),
      };
      this.calibration = session;
      // A suspended/stalled context cannot leave a pending capture indefinitely.
      timer = setTimeout(() => fail(new Error("Calibration stalled. Check audio input and retry.")), (maxSeconds + 5) * 1000);
      this.calibrationModule ??= context.audioWorklet.addModule(new URL("./calibration-worklet.js", import.meta.url).href)
        .catch((error) => { this.calibrationModule = undefined; throw error; });
      void this.calibrationModule.then(() => {
        if (settled) return;
        if (finishRequested) { session.cancel(); return; }
        const buffer = new CalibrationBuffer(context.sampleRate, maxSeconds);
        node = new AudioWorkletNode(context, "modulo-calibration", {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
          channelCount: 1, channelCountMode: "explicit", processorOptions: { maxFrames },
        });
        node.onprocessorerror = () => fail(new Error("Calibration processor failed. Retry capture."));
        node.port.onmessage = ({ data }: MessageEvent<{ samples?: Float32Array; done?: boolean }>) => {
          if (settled) return;
          if (data.samples) buffer.append(data.samples);
          if (data.done) {
            settled = true;
            cleanup();
            resolve({ ...buffer.finish(), input: structuredClone(info) });
          }
        };
        splitter.connect(node, info.channel, 0);
        connected = true;
        // The worklet emits silence; connecting it keeps processing scheduled, without a dry echo.
        node.connect(context.destination);
      }).catch(fail);
    });
  }

  /** Finish the take without stopping live monitoring. Await the startCalibration promise. */
  finishCalibration(): void { this.calibration?.finish(); }

  /** Discard a pending take; its start promise rejects with AbortError. */
  cancelCalibration(): void { this.calibration?.cancel(); }

  /** Resolve with an encoded processed take on finish/limit/source stop; catch cancellation. */
  async startPerformanceRecording(options?: PerformanceRecordingOptions): Promise<PerformanceTake> {
    if (!this.context || !("createMediaStreamDestination" in this.context) || this.context.state !== "running" || !this.outputGuard || (!this.liveStream && !this.source)) {
      throw new Error("Start live input or sample playback before recording a performance.");
    }
    if (this.performanceRecording || this.rigRecording) throw new Error("A performance recording is already recording or finalizing.");
    const session = recordProcessedOutput(this.context, this.outputGuard, options);
    this.performanceRecording = session;
    try { return await session.result; }
    finally { if (this.performanceRecording === session) this.performanceRecording = undefined; }
  }

  /** Finish the file; live monitoring continues. Await the original start promise. */
  finishPerformanceRecording(): void { this.performanceRecording?.stop(); }

  cancelPerformanceRecording(): void { this.performanceRecording?.cancel(); }

  getPerformanceRecordingState(): "idle" | "recording" | "stopping" {
    return this.performanceRecording?.state() ?? "idle";
  }

  private requireRig(): RigPreset {
    if (this.disposed) throw new Error("Audio engine is closed.");
    if (!this.rig) throw new Error("Apply an engine rig first.");
    return structuredClone(this.rig.preset);
  }

  private releaseRig(graph: RigGraph): void {
    this.input?.disconnect(graph.input); graph.dispose();
  }
  private clearRetiredRigs(): void {
    for (const [graph, timer] of this.retiredRigs) { clearTimeout(timer); this.releaseRig(graph); }
    this.retiredRigs.clear();
  }
  private connectRig(graph: RigGraph): void {
    graph.onError = message => { this.stop(); this.onRigError?.(message); };
    this.input!.connect(graph.input); graph.output.connect(this.wet!); graph.setBypass(this.bypass);
    this.input!.gain.cancelScheduledValues(this.context!.currentTime); this.input!.gain.value = 1;
    this.master!.gain.cancelScheduledValues(this.context!.currentTime); this.master!.gain.value = this.tunerMuted ? 0 : 1;
    this.wet!.gain.cancelScheduledValues(this.context!.currentTime); this.wet!.gain.value = 1;
    this.dry!.gain.cancelScheduledValues(this.context!.currentTime); this.dry!.gain.value = 0;
    if (!this.source && !this.liveStream) graph.silence();
  }

  /** Call from a gesture. Rig changes are validated before replacing the audible graph. */
  async applyRigPreset(value: RigPreset): Promise<boolean> {
    const preset = parseRigPreset(value), token = ++this.rigRequest, request = this.request;
    const context = await this.initialize();
    await prepareRig(context, preset);
    if (this.disposed || token !== this.rigRequest || request !== this.request) return false;
    if (this.rig?.canUpdate(preset)) { this.rig.update(preset); this.notifyRig(); return true; }
    const next = new RigGraph(context, preset, this.irs), previous = this.rig;
    // Build first: missing IRs or unsupported nodes leave the current rig intact.
    this.clearRetiredRigs();
    if (!previous) { this.input!.disconnect(this.drivePre!); this.input!.disconnect(this.driveClean!); }
    this.rig = next; this.rigNeedsReset = false; this.connectRig(next);
    if (previous) {
      if (this.source || this.liveStream) next.fadeIn();
      previous.setActive(false);
      const timer = setTimeout(() => { this.releaseRig(previous); this.retiredRigs.delete(previous); }, 100);
      this.retiredRigs.set(previous, timer);
    }
    this.notifyRig(); return true;
  }
  getRigPreset(): RigPreset | null { return this.rig ? structuredClone(this.rig.preset) : null; }
  /** Model-owned parameter IDs; the legacy setRigParameter wire API remains available. */
  async setModelParameter(id: string, parameter: string, value: number | boolean | string, atTime?: number): Promise<boolean> {
    const next = this.requireRig(), module = allRigModules(next).find(item => item.id === id);
    if (!module) throw new Error("Unknown rig module.");
    const mapped = parameterToDSP(modelFor(module), parameter, value);
    if (mapped.realtime && typeof mapped.value !== "string") { this.setRigParameter(id, mapped.target, mapped.value, atTime); return true; }
    if (atTime !== undefined) throw new Error("This model control requires an immediate graph rebuild.");
    module.parameters[mapped.target] = mapped.value;
    return this.applyRigPreset(next);
  }
  /** Learn a numeric model-owned control; descriptor mapping also applies to pedal endpoints. */
  learnModelMidi(id: string, parameter: string, min: number, max: number, curve: "linear" | "squared" = "linear"): void {
    const module = allRigModules(this.requireRig()).find(item => item.id === id); if (!module) throw new Error("Unknown rig module.");
    const model = modelFor(module), low = parameterToDSP(model, parameter, min), high = parameterToDSP(model, parameter, max);
    if (!low.realtime || typeof low.value !== "number" || typeof high.value !== "number") throw new Error("MIDI learn requires a realtime numeric model control.");
    this.midi.learn(id, low.target, low.value, high.value, curve);
  }
  setRigParameter(id: string, parameter: string, value: number | boolean, atTime?: number): void {
    const next = this.requireRig(), module = allRigModules(next).find(item => item.id === id);
    if (!module) throw new Error("Unknown rig module.");
    module.parameters[parameter] = value; parseRigPreset(next);
    this.rig!.setParameter(id, parameter, value, atTime);
    this.notifyRig();
  }
  setRigModuleEnabled(id: string, enabled: boolean): void {
    const next = this.requireRig(), module = allRigModules(next).find(item => item.id === id);
    if (!module) throw new Error("Unknown rig module.");
    module.on = enabled; this.rig!.update(parseRigPreset(next)); this.notifyRig();
  }
  setRigTempo(bpm: number): void { const next = this.requireRig(); next.tempo_bpm = bpm; this.rig!.update(parseRigPreset(next)); this.notifyRig(); }
  saveRigSnapshot(id: string, name: string): void {
    const next = this.requireRig(); next.snapshots = [...next.snapshots.filter(item => item.id !== id), snapshotRig(next, id, name)];
    this.rig!.preset = parseRigPreset(next); this.notifyRig();
  }
  loadRigSnapshot(id: string): Promise<boolean> { return this.applyRigPreset(applyRigSnapshot(this.requireRig(), id)); }
  setRigExpression(id: string, parameter: string, position: number, min: number, max: number, curve: "linear" | "squared" = "linear"): void {
    const module = allRigModules(this.requireRig()).find(item => item.id === id);
    if (!module) throw new Error("Unknown rig module.");
    validateControl(module.type, parameter, min, true); validateControl(module.type, parameter, max, true);
    this.setRigParameter(id, parameter, expressionValue({ min, max, curve }, position));
  }
  async loadCabinetIR(id: string, file: File) {
    if (this.rig && allRigModules(this.rig.preset).some(item => item.type === "cabinet" && item.parameters.ir_id === id)) throw new Error("Use a new IR identifier or remove it from the rig before replacing it.");
    return this.irs.load(id, file, await this.initialize());
  }
  listCabinetIRs() { return this.irs.list(); }
  removeCabinetIR(id: string): void {
    if (this.rig && allRigModules(this.rig.preset).some(item => item.type === "cabinet" && item.parameters.ir_id === id)) throw new Error("Remove this IR from the rig before unloading it.");
    this.irs.remove(id);
  }
  renderRigFile(file: File, options?: RigRenderOptions) { return renderRigFile(file, this.requireRig(), options, this.irs); }

  /** Monophonic tuner, dry tap only. Poll at most 10 times/second; returns null for quiet/unclear input. */
  getTunerReading(referenceHz = 440) {
    if (!this.context || (!this.liveStream && !this.source)) return null;
    if (!this.tuner) { this.tuner = this.context.createAnalyser(); this.tuner.fftSize = this.tunerSamples.length; this.rawTap!.connect(this.tuner); }
    this.tuner.getFloatTimeDomainData(this.tunerSamples); return estimatePitch(this.tunerSamples, this.context.sampleRate, referenceHz);
  }
  setTunerMuted(muted: boolean): void {
    this.tunerMuted = muted;
    if (this.context) this.master!.gain.setTargetAtTime(muted ? 0 : this.rig ? 1 : 10 ** (this.preset.parameters.master_gain_db / 20), this.context.currentTime, 0.015);
  }
  getDiagnostics() {
    const context = this.context;
    return { mode: this.rig ? "rig" : "preset-v1", contextState: context?.state ?? "uninitialized", contextTimeSeconds: context?.currentTime ?? null, sampleRate: context?.sampleRate ?? null,
      baseLatencySeconds: context && "baseLatency" in context ? context.baseLatency : null,
      outputLatencySeconds: context && "outputLatency" in context ? context.outputLatency : null,
      measuredRoundTripLatencySeconds: null, audioThreadCpuPercent: null, dropoutCount: null,
      capture: this.liveInfo ? structuredClone(this.liveInfo) : null, tunerMuted: this.tunerMuted,
      graph: this.rig?.diagnostics() ?? null, retiringGraphs: this.retiredRigs.size,
      recording: this.rigRecording?.state() ?? this.getPerformanceRecordingState(), customIRCount: this.irs.list().length };
  }
  /** Browser output routing is optional; unsupported browsers should use OS output settings. */
  async setOutputDevice(deviceId: string): Promise<void> {
    const context = await this.initialize();
    const selectable = context as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (!selectable.setSinkId) throw new Error("Output selection is unavailable; choose the output in OS sound settings.");
    await selectable.setSinkId(deviceId);
  }
  async startRigRecording(options: RigRecordingOptions = {}): Promise<RigTake> {
    if (!this.context || !("createMediaStreamDestination" in this.context) || this.context.state !== "running" || (!this.liveStream && !this.source)) throw new Error("Start input or playback before recording.");
    if (this.rigRecording || this.performanceRecording) throw new Error("A performance recording is already recording or finalizing.");
    const session = recordRig(this.context, this.rawTap!, this.outputGuard!, options); this.rigRecording = session;
    try { return await session.result; } finally { if (this.rigRecording === session) this.rigRecording = undefined; }
  }
  finishRigRecording(): void { this.rigRecording?.stop(); }
  cancelRigRecording(): void { this.rigRecording?.cancel(); }

  stop(): void {
    this.request++;
    this.rigRequest++;
    this.rig?.silence(); this.rigNeedsReset = !!this.rig;
    for (const graph of this.retiredRigs.keys()) graph.silence();
    this.rigRecording?.stop("source_stopped");
    this.performanceRecording?.stop("source_stopped");
    this.cancelCalibration();
    this.meter?.disconnect();
    this.meter = undefined;
    if (this.tuner) { this.rawTap?.disconnect(this.tuner); this.tuner.disconnect(); this.tuner = undefined; }
    this.liveInfo = undefined;
    if (this.source) {
      this.source.onended = null;
      this.source.stop();
      this.source.disconnect();
      this.source = undefined;
    }
    if (this.liveStream) {
      for (const track of this.liveStream.getTracks()) {
        if (this.liveEnded) track.removeEventListener("ended", this.liveEnded);
        track.stop();
      }
      this.liveStream = undefined;
    }
    this.liveSource?.disconnect();
    this.liveSplitter?.disconnect();
    this.liveSource = undefined;
    this.liveSplitter = undefined;
    this.liveEnded = undefined;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.midi.disconnect(); this.cancelRigRecording();
    this.cancelPerformanceRecording();
    this.stop();
    if (this.rig) { this.releaseRig(this.rig); this.rig = undefined; }
    this.clearRetiredRigs();
    this.irs.clear();
    if (this.context && "close" in this.context) await this.context.close();

    this.context = undefined;
    this.calibrationModule = undefined;
  }
}
