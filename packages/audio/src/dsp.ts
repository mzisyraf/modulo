export function driveSettings(drive: number) {
  if (!Number.isFinite(drive) || drive < 0 || drive > 1) throw new RangeError("Drive must be between 0 and 1.");
  const preGain = 1 + 7 * drive * drive;
  return { preGain, postGain: 1 / Math.sqrt(preGain), clean: 1 - drive, distorted: drive };
}

/** Fixed saturator: adjust surrounding gains instead of replacing this while playing. */
export function saturationCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(2049);
  for (let i = 0; i < curve.length; i++) {
    const x = (i * 2) / (curve.length - 1) - 1;
    curve[i] = Math.tanh(3 * x) / Math.tanh(3);
  }
  return curve;
}

/** Memoryless reference for the blended drive, excluding branch filters/oversampling. */
export function driveCurve(drive: number): Float32Array<ArrayBuffer> {
  const settings = driveSettings(drive);
  const curve = new Float32Array(2049);
  for (let i = 0; i < curve.length; i++) {
    const x = (i * 2) / (curve.length - 1) - 1;
    const driven = Math.max(-1, Math.min(1, x * settings.preGain));
    curve[i] = settings.clean * x + settings.distorted * settings.postGain * Math.tanh(3 * driven) / Math.tanh(3);
  }
  return curve;
}

export function pluckSamples(sampleRate: number): Float32Array<ArrayBuffer> {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new RangeError("Unsupported sample rate.");
  }
  const samples = new Float32Array(sampleRate * 2);
  for (let i = 0; i < samples.length; i++) {
    const time = i / sampleRate;
    const envelope = Math.min(time * 100, 1) * Math.exp(-time * 3);
    samples[i] = envelope * (0.25 * Math.sin(2 * Math.PI * 110 * time) + 0.1 * Math.sin(2 * Math.PI * 220 * time));
  }
  return samples;
}
