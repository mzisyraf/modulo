// Diagnostic paired-audio metrics. These are not a calibrated perceptual score.
export function levels(samples) {
  if (!samples.length) throw Error("Empty audio");
  let sum = 0, peak = 0, guarded = 0;
  for (const x of samples) {
    if (!Number.isFinite(x)) throw Error("Nonfinite audio");
    sum += x*x; peak = Math.max(peak, Math.abs(x)); if (Math.abs(x) >= .949) guarded++;
  }
  const rms = Math.sqrt(sum / samples.length);
  return { rms, rms_dbfs: 20*Math.log10(Math.max(rms, 1e-12)), peak, guard_fraction: guarded / samples.length };
}

export { spectrum } from "../../apps/web/src/audioFeatures.ts";
import { spectrum } from "../../apps/web/src/audioFeatures.ts";

function spectralError(candidate,target,rate,gain) {
  const resolutions=[];
  for (const size of [512,1024,2048]) {
    const window=Float64Array.from({length:size},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(size-1)));
    let delta=0,energy=0,logError=0,bins=0;
    const frames=Math.floor((target.length-size)/(size/4))+1, count=Math.min(frames,128);
    for (let frame=0;frame<count;frame++) {
      const start=Math.round(frame*(frames-1)/Math.max(1,count-1))*size/4;
      const a=spectrum(window.map((w,i)=>candidate[start+i]*gain*w));
      const b=spectrum(window.map((w,i)=>target[start+i]*w));
      for(let i=1;i<b.length;i++) {
        const hz=i*rate/size; if(hz<20 || hz>20000)continue;
        delta+=(a[i]-b[i])**2;energy+=b[i]**2;
        logError+=Math.abs(20*Math.log10(Math.max(a[i],1e-6)/Math.max(b[i],1e-6)));bins++;
      }
    }
    const convergence=Math.sqrt(delta/Math.max(energy,1e-24)),log_mae_db=logError/bins;
    resolutions.push({fft_size:size,frames:count,convergence,log_mae_db,loss:convergence+log_mae_db/20});
  }
  return {loss:resolutions.reduce((s,x)=>s+x.loss,0)/resolutions.length,resolutions};
}

export function compareAudio(candidate,target,{sampleRate,paired=false}={}) {
  if(!paired)throw Error("Only aligned recordings of the same performance can be scored");
  if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000)throw Error("Invalid sample rate");
  if(candidate.length!==target.length||target.length<2048)throw Error("Audio must have matching lengths of at least 2048 samples");
  const a=levels(candidate),b=levels(target);
  if(a.rms<1e-6||b.rms<1e-6)throw Error("Silent audio cannot be scored");
  const match=b.rms/a.rms;
  if(match<.1||match>10)throw Error("Level mismatch exceeds 20 dB; inspect gain before scoring");
  let squaredError=0;for(let i=0;i<target.length;i++)squaredError+=(candidate[i]-target[i])**2;
  return {safe:a.peak<=.951&&a.guard_fraction<.01,levels:a,level_difference_db:a.rms_dbfs-b.rms_dbfs,
    esr:squaredError/(target.length*b.rms*b.rms),raw:spectralError(candidate,target,sampleRate,1),
    rms_matched:spectralError(candidate,target,sampleRate,match)};
}

export function beatsBaseline(candidate,baseline) {
  // shortcut: 10% is a provisional diagnostic margin; calibrate it with held-out listening tests before release gating.
  return candidate.safe && candidate.raw.loss<baseline.raw.loss && candidate.rms_matched.loss<baseline.rms_matched.loss*.9;
}
