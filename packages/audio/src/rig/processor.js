// Mono guitar in, stereo out. Gate has no lookahead; pitch uses explicit delay grains.
class RigProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.config = options.processorOptions;
    this.envelope = 0; this.gain = 0; this.open = false; this.hold = 0;
    this.buffer = new Float32Array(Math.ceil(sampleRate * 0.25));
    this.write = 0; this.phase = [0, 0.5]; this.blocks = 0; this.disposed = false;
    this.port.onmessage = ({ data }) => {
      if (data.dispose) this.disposed = true;
      if (data.parameters) Object.assign(this.config, data.parameters);
    };
  }
  read(delay) {
    let position = (this.write - delay + this.buffer.length) % this.buffer.length;
    const left = Math.floor(position), fraction = position - left;
    return this.buffer[left] * (1 - fraction) + this.buffer[(left + 1) % this.buffer.length] * fraction;
  }
  process(inputs, outputs) {
    if (this.disposed) return false;
    const source = inputs[0]?.[0]; const channels = outputs[0]; const p = this.config;
    if (!channels?.length) return true;
    const frames = channels[0].length;
    const threshold = 10 ** (p.threshold_db / 20), close = threshold * 10 ** (-p.hysteresis_db / 20);
    const floor = 10 ** (p.depth_db / 20);
    const attack = Math.exp(-1 / (sampleRate * Math.max(0.0001, p.attack_ms / 1000)));
    const release = Math.exp(-1 / (sampleRate * Math.max(0.01, p.release_ms / 1000)));
    const detector = Math.exp(-1 / (sampleRate * (p.detector || 0.01)));
    const window = sampleRate * p.window_ms / 1000;
    for (let index = 0; index < frames; index++) {
      const x = Number.isFinite(source?.[index]) ? source[index] : 0;
      if (p.mode === "gate") {
        this.envelope = Math.max(Math.abs(x), this.envelope * detector);
        if (this.envelope >= threshold) { this.open = true; this.hold = p.hold_ms * sampleRate / 1000; }
        else if (this.hold > 0) this.hold--;
        else if (this.envelope < close) this.open = false;
        let target = this.open ? 1 : floor;
        if (p.expand && !this.open) target = Math.max(floor, Math.min(1, this.envelope / Math.max(threshold, 1e-8)) ** 2);
        const smoothing = target > this.gain ? attack : release;
        this.gain = target + smoothing * (this.gain - target);
        for (const output of channels) output[index] = x * this.gain;
      } else {
        this.buffer[this.write] = x;
        for (let channel = 0; channel < channels.length; channel++) {
          const cents = p.stereo && channel ? -p.cents : p.cents;
          const shift = p.semitones + cents / 100;
          if (Math.abs(shift) < 0.0001) { channels[channel][index] = x; continue; }
          const ratio = 2 ** (shift / 12);
          let phase = this.phase[channel];
          const second = (phase + 0.5) % 1;
          const weight = Math.sin(Math.PI * phase) ** 2;
          channels[channel][index] = this.read(2 + phase * window) * weight + this.read(2 + second * window) * (1 - weight);
          phase = (phase + (1 - ratio) / window + 1) % 1;
          this.phase[channel] = phase;
        }
        this.write = (this.write + 1) % this.buffer.length;
      }
    }
    if (++this.blocks % 128 === 0) this.port.postMessage({ quantumFrames: frames, gateGain: p.mode === "gate" ? this.gain : null });
    return true;
  }
}
registerProcessor("modulo-rig-dsp", RigProcessor);
