import {AudioEngine} from "@modulo/audio";
import {parsePreset,type Preset} from "@modulo/contracts";
import {toneFeatures,toneDistance,validToneFeatures,type ToneFeatures} from "./audioFeatures.ts";
import {encodeMonoWav} from "./localAudio.ts";

export interface Refinement {preset:Preset;before:number;after:number;renders:number}

/** Bounded spectral-proxy search; it cannot prove a match across different performances. */
export async function refinePreset(file:File,preset:Preset,target:ToneFeatures,options:{targetRmsDbfs?:number;signal?:AbortSignal;progress?:(renders:number)=>void}={}):Promise<Refinement> {
  const original=parsePreset(preset);
  options.signal?.throwIfAborted();
  if(!validToneFeatures(target))throw Error("Invalid target spectrum");
  if(options.targetRmsDbfs!==undefined&&(!Number.isFinite(options.targetRmsDbfs)||options.targetRmsDbfs>0||options.targetRmsDbfs< -100))throw Error("Invalid target level");
  if(!file.size||file.size>20*1024*1024)throw Error("Choose a recording up to 20 MiB");
  const decoded=await new OfflineAudioContext(1,1,44100).decodeAudioData(await file.arrayBuffer());
  if(decoded.numberOfChannels!==1||decoded.duration<3||decoded.duration>90)throw Error("Refinement requires a prepared mono recording lasting 3–90 seconds");
  const samples=decoded.getChannelData(0).slice(0,44100*15);
  const clip=new File([encodeMonoWav(samples,44100)],"refinement-input.wav",{type:"audio/wav"});
  const cache=new Map<string,{loss:number;rms:number;peak:number}>();let renders=0;
  async function score(parameters:Preset["parameters"]):Promise<number>{
    options.signal?.throwIfAborted();
    const key=JSON.stringify(parameters);if(cache.has(key))return cache.get(key)!.loss;
    const buffer=await AudioEngine.renderFile(clip,parsePreset({...original,parameters}));
    options.signal?.throwIfAborted();
    const audio=buffer.getChannelData(0);let guarded=0,energy=0,peak=0;
    for(const sample of audio){if(!Number.isFinite(sample))throw Error("Nonfinite rendered output");energy+=sample*sample;peak=Math.max(peak,Math.abs(sample));if(Math.abs(sample)>=.949)guarded++;}
    const value=guarded/audio.length>=.01?1e6:toneDistance(toneFeatures(audio,buffer.sampleRate),target);
    cache.set(key,{loss:value,rms:10*Math.log10(Math.max(1e-24,energy/audio.length)),peak});renders++;options.progress?.(renders);return value;
  }
  let best={...original.parameters},loss=await score(best);const before=loss;
  async function consider(parameters:Preset["parameters"]){const next=await score(parameters);if(next<loss-1e-5){best=parameters;loss=next;}}
  await consider({...best,drive:0,bass_db:0,mid_db:0,treble_db:0});
  let winner=best,winnerLoss=loss;
  // Two independent clean/saturated starts avoid trapping drive behind an unsuitable EQ setting.
  for(const drive of [0,.5]){
    if(winnerLoss<1e-4)break;
    best={...original.parameters,drive,bass_db:0,mid_db:0,treble_db:0};loss=await score(best);
    for(const step of [6,3,1.5])for(const key of ["bass_db","mid_db","treble_db"] as const){
      const center=best[key];
      for(const direction of [-1,1])await consider({...best,[key]:Math.max(-12,Math.min(12,center+direction*step))});
    }
    const center=best.drive;
    for(const delta of [-.1,.1,-.03,.03])await consider({...best,drive:Math.round(Math.max(0,Math.min(1,center+delta))*100)/100});
    if(loss<winnerLoss){winner=best;winnerLoss=loss;}
  }
  best=winner;loss=winnerLoss;
  if(!Number.isFinite(loss)||loss>=1e6)throw Error("No safe refinement found. Lower input/output gain and try again.");
  if(options.targetRmsDbfs!==undefined){
    const measured=cache.get(JSON.stringify(best))!;
    const correction=Math.min(options.targetRmsDbfs-measured.rms,20*Math.log10(.9/Math.max(measured.peak,1e-12)));
    const adjusted={...best,master_gain_db:Math.round(Math.max(-36,Math.min(-6,best.master_gain_db+correction))*10)/10};
    const next=await score(adjusted);if(next<1e6){best=adjusted;loss=next;}
  }
  const improved=JSON.stringify(best)!==JSON.stringify(original.parameters);
  return {preset:parsePreset({...original,parameters:best,
    description:improved?"Nemotron starting rig refined locally against measured spectral descriptors. Audible tone similarity remains unverified.":original.description,
    quality_flags:improved?[...new Set([...original.quality_flags,"locally_refined_spectral_proxy"])]:original.quality_flags}),before,after:loss,renders};
}
