export const envelopeLagsMs = [50, 100, 150, 200, 250, 300, 400, 500, 750, 1000];
export interface TemporalFeatures { method: "envelope_v1"; correlations: number[]; release_ratio: number; envelope_acf?: number[]; decay_curve?: number[]; decay_counts?: number[] }
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
  const mean=envelope.reduce((a,b)=>a+b,0)/envelope.length, centered=envelope.map(x=>x-mean);
  const envelope_acf=Array.from({length:100},(_,index)=>{const lag=index+1;let xy=0,xx=0,yy=0;for(let i=lag;i<centered.length;i++){xy+=centered[i]*centered[i-lag];xx+=centered[i]**2;yy+=centered[i-lag]**2;}return Math.max(-1,Math.min(1,xy/Math.max(1e-20,Math.sqrt(xx*yy))));});
  const onsets:number[]=[];
  for(let i=5;i<envelope.length-3&&onsets.length<32;i++)if(envelope[i]>.15*peak&&envelope[i]>1.6*(envelope.slice(i-5,i).reduce((a,b)=>a+b,0)/5+1e-12)&&envelope[i]>=Math.max(...envelope.slice(i+1,i+4))&&(onsets.length===0||i-onsets.at(-1)!>=25))onsets.push(i);
  const decay_counts:number[]=[];
  const decay_curve=[5,10,20,40,80,120].map(lag=>{const values=onsets.flatMap((at,index)=>at+lag+2<envelope.length&&at+lag+2<(onsets[index+1]??Infinity)?[Math.min(4,envelope.slice(at+lag,at+lag+3).reduce((a,b)=>a+b,0)/3/envelope[at])]:[]);decay_counts.push(values.length);return values.length?values.reduce((a,b)=>a+b,0)/values.length:0;});
  return { method: "envelope_v1", correlations, release_ratio, envelope_acf, decay_curve, decay_counts };
}
export function validTemporalFeatures(value: unknown): value is TemporalFeatures {
  const x = value as TemporalFeatures;
  return Boolean(x && x.method === "envelope_v1" && Array.isArray(x.correlations) && x.correlations.length === 10
    && x.correlations.every(n => Number.isFinite(n) && n >= 0 && n <= 1) && Number.isFinite(x.release_ratio) && x.release_ratio >= 0 && x.release_ratio <= 1
    && (x.envelope_acf===undefined||(Array.isArray(x.envelope_acf)&&x.envelope_acf.length===100&&x.envelope_acf.every(n=>Number.isFinite(n)&&n>=-1&&n<=1)))
    && (x.decay_curve===undefined||(Array.isArray(x.decay_curve)&&x.decay_curve.length===6&&x.decay_curve.every(n=>Number.isFinite(n)&&n>=0&&n<=4)))
    && (x.decay_counts===undefined||(Array.isArray(x.decay_counts)&&x.decay_counts.length===6&&x.decay_counts.every(n=>Number.isInteger(n)&&n>=0&&n<=32))));
}
export function temporalDistance(a: TemporalFeatures, b: TemporalFeatures): number {
  if (!validTemporalFeatures(a) || !validTemporalFeatures(b)) throw Error("Invalid envelope descriptors.");
  return a.correlations.reduce((sum, value, i) => sum + Math.abs(value - b.correlations[i]), 0) / 10 + Math.abs(a.release_ratio - b.release_ratio);
}
