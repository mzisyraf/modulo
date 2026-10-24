export function driveCurve(drive: number): Float32Array<ArrayBuffer> {
  if (!Number.isFinite(drive) || drive < 0 || drive > 1) throw new RangeError("Drive must be between 0 and 1.");
  const curve = new Float32Array(2049);
  const amount = 1 + drive * 40;
  for (let i = 0; i < curve.length; i++) {
    const x = (i * 2) / (curve.length - 1) - 1;
    curve[i] = drive === 0 ? x : Math.tanh(amount * x) / Math.tanh(amount);
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
