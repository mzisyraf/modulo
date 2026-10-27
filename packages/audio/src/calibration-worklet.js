// No output is written: this branch records mono dry input and adds no monitoring path.
class CalibrationCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.remaining = options.processorOptions.maxFrames;
    this.block = new Float32Array(1024);
    this.used = 0;
    this.done = false;
    this.port.onmessage = ({ data }) => {
      if (data === "finish") this.finish();
    };
  }

  flush() {
    if (!this.used) return;
    const samples = this.block.slice(0, this.used);
    this.port.postMessage({ samples }, [samples.buffer]);
    this.used = 0;
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.flush();
    this.port.postMessage({ done: true });
  }

  process(inputs) {
    if (this.done) return false;
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    for (const value of samples) {
      this.block[this.used++] = value;
      this.remaining--;
      if (this.used === this.block.length) this.flush();
      if (this.remaining <= 0) { this.finish(); return false; }
    }
    return true;
  }
}

registerProcessor("modulo-calibration", CalibrationCapture);
