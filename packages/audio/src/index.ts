import { parsePreset, type Preset } from "@modulo/contracts";
import { driveCurve, pluckSamples } from "./dsp.ts";
import { CalibrationBuffer, calibrationFrameLimit, inputLevel, type CalibrationAudio, type InputLevel } from "./calibration.ts";
export type { CalibrationAudio, CalibrationFlag, InputLevel } from "./calibration.ts";

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
  private bass?: BiquadFilterNode;
  private mid?: BiquadFilterNode;
  private treble?: BiquadFilterNode;
  private wet?: GainNode;
  private dry?: GainNode;
  private master?: GainNode;
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
      this.wet.gain.value = this.bypass ? 0 : this.wetListeningGain;
      this.dry.gain.value = this.bypass ? this.dryListeningGain : 0;
      this.input.connect(this.shaper).connect(this.bass).connect(this.mid).connect(this.treble).connect(this.wet).connect(this.master);
      this.input.connect(this.dry).connect(this.master);
      // Bound the output even when stacked EQ boosts exceed full scale.
      const outputGuard = context.createWaveShaper();
      outputGuard.curve = new Float32Array([-0.95, 0, 0.95]);
      this.master.connect(outputGuard).connect(context.destination);
      this.applyPreset(this.preset);
      this.setBypass(this.bypass);
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
  async startLive(deviceId?: string, channel: number = 0): Promise<LiveInputInfo | false> {
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
      splitter.connect(this.input!, channel, 0);
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

  stop(): void {
    this.request++;
    this.cancelCalibration();
    this.meter?.disconnect();
    this.meter = undefined;
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
    this.stop();
    if (this.context && "close" in this.context) await this.context.close();
    this.context = undefined;
    this.calibrationModule = undefined;
  }
}
