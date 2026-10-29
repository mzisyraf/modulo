export const envelopeLagsMs = [50, 100, 150, 200, 250, 300, 400, 500, 750, 1000];
export interface TemporalFeatures { method: "envelope_v1"; correlations: number[]; release_ratio: number }
export function temporalFeatures(samples: Float32Array, rate: number): TemporalFeatures {
  if (!Number.isFinite(rate) || rate < 8000 || rate > 192000 || samples.length < rate * 3) throw Error("Use at least three seconds for envelope measurement.");
  const block = Math.round(rate / 100), envelope: number[] = [];
  for (let start = 0; start + block <= samples.length; start += block) {
    let sum = 0; for (let j = start; j < start + block; j++) { if (!Number.isFinite(samples[j])) throw Error("Invalid envelope samples."); sum += samples[j] ** 2; }
    envelope.push(Math.sqrt(sum / block));
  }
  const energy = envelope.reduce((sum, value) => sum + value * value, 0);
  if (energy < 1e-10) throw Error("Envelope is too quiet.");
  const correlations = envelopeLagsMs.map(ms => {
    const lag = Math.round(ms / 10); let product = 0, a = 0, b = 0;
    for (let i = lag; i < envelope.length; i++) { product += envelope[i] * envelope[i - lag]; a += envelope[i] ** 2; b += envelope[i - lag] ** 2; }
    return Math.max(0, Math.min(1, product / Math.max(1e-20, Math.sqrt(a * b))));
  });
  const peak = Math.max(...envelope), at = envelope.indexOf(peak), release = envelope.slice(at + 10, at + 51);
  const release_ratio = release.length ? Math.min(1, release.reduce((sum, x) => sum + x, 0) / release.length / peak) : 0;
  return { method: "envelope_v1", correlations, release_ratio };
}
export function validTemporalFeatures(value: unknown): value is TemporalFeatures {
  const x = value as TemporalFeatures;
  return Boolean(x && x.method === "envelope_v1" && Array.isArray(x.correlations) && x.correlations.length === 10
    && x.correlations.every(n => Number.isFinite(n) && n >= 0 && n <= 1) && Number.isFinite(x.release_ratio) && x.release_ratio >= 0 && x.release_ratio <= 1);
}
export function temporalDistance(a: TemporalFeatures, b: TemporalFeatures): number {
  if (!validTemporalFeatures(a) || !validTemporalFeatures(b)) throw Error("Invalid envelope descriptors.");
  return a.correlations.reduce((sum, value, i) => sum + Math.abs(value - b.correlations[i]), 0) / 10 + Math.abs(a.release_ratio - b.release_ratio);
}
