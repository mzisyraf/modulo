/** Local capture quality heuristics, not chord recognition or tone-match confidence. */
export interface InputLevel {
  peak: number;
  rms: number;
  clipping: boolean;
}

export function inputLevel(samples: Float32Array): InputLevel {
  let peak = 0;
  let energy = 0;
  for (const value of samples) {
    if (!Number.isFinite(value)) continue;
    peak = Math.max(peak, Math.abs(value));
    energy += value * value;
  }
  return { peak, rms: samples.length ? Math.sqrt(energy / samples.length) : 0, clipping: peak >= 0.99 };
}

export type CalibrationFlag = "too_short" | "silence" | "clipping" | "invalid_samples";

export interface CalibrationAudio {
  /** Owned mono PCM at the audio-context rate, before the app's input gain/effects. */
  samples: Float32Array;
  sampleRate: number;
  durationSeconds: number;
  level: InputLevel;
  qualityFlags: CalibrationFlag[];
  usable: boolean;
}

export function calibrationFrameLimit(sampleRate: number, maxSeconds: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("Invalid capture sample rate.");
  if (!Number.isFinite(maxSeconds) || maxSeconds < 2 || maxSeconds > 15) {
    throw new Error("Calibration duration must be between 2 and 15 seconds.");
  }
  return Math.floor(sampleRate * maxSeconds);
}

/** Fixed storage bounds remain in force even if the main thread falls behind. */
export class CalibrationBuffer {
  private readonly data: Float32Array;
  private length = 0;
  private invalid = false;
  private readonly sampleRate: number;

  constructor(sampleRate: number, maxSeconds: number) {
    this.sampleRate = sampleRate;
    this.data = new Float32Array(calibrationFrameLimit(sampleRate, maxSeconds));
  }

  append(block: Float32Array): void {
    const count = Math.min(block.length, this.data.length - this.length);
    for (let index = 0; index < count; index++) {
      const value = block[index];
      if (!Number.isFinite(value)) this.invalid = true;
      this.data[this.length++] = Number.isFinite(value) ? value : 0;
    }
  }

  finish(): CalibrationAudio {
    const samples = this.data.slice(0, this.length);
    const durationSeconds = this.length / this.sampleRate;
    const level = inputLevel(samples);
    const qualityFlags: CalibrationFlag[] = [];
    if (durationSeconds < 2) qualityFlags.push("too_short");
    if (level.rms < 0.001) qualityFlags.push("silence");
    if (level.clipping) qualityFlags.push("clipping");
    if (this.invalid) qualityFlags.push("invalid_samples");
    return { samples, sampleRate: this.sampleRate, durationSeconds, level, qualityFlags, usable: qualityFlags.length === 0 };
  }
}
