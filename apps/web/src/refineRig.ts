import { compileRigProposal, getGearModel, normalizeModelValue, denormalizeModelValue, parseRigProposal, renderRigBuffer, createGearModule, modelValues, type RigProposal, type RigPreset } from "@modulo/audio";
import { toneFeatures, validToneFeatures, type ToneFeatures } from "./audioFeatures.ts";
import { encodeMonoWav } from "./localAudio.ts";
import { temporalFeatures, type TemporalFeatures } from "./temporalFeatures.ts";
import { rigFeatureDistance, validatedImprovement, structureCandidates, ambienceCandidates, discreteCandidates, parameterSchedule, estimateDelay, RIG_SEARCH_VERSION, type RigScore } from "./rigSearch.ts";
export type { RigScore } from "./rigSearch.ts";
export interface RigTargetWindow { tone: ToneFeatures; temporal?: TemporalFeatures }

export async function scoreRig(file: File, proposal: RigProposal, inputGainDb: number, target: ToneFeatures, signal?: AbortSignal, temporal?: TemporalFeatures, outputLevelDb = -18): Promise<RigScore> {
  if(!validToneFeatures(target))throw Error("Invalid target spectrum.");
  const rig=compileRigProposal(proposal,inputGainDb,outputLevelDb);
  if(!file.size||file.size>20*1024*1024)throw Error("Choose guitar audio up to 20 MiB.");
  signal?.throwIfAborted();
  const decoded=await new OfflineAudioContext(1,1,44100).decodeAudioData(await file.arrayBuffer());
  return scoreBuffer(decoded,rig,target,signal,temporal);
}
async function scoreBuffer(decoded: AudioBuffer, rig: RigPreset, target: ToneFeatures, signal?: AbortSignal, temporal?: TemporalFeatures): Promise<RigScore> {
  const rendered = await renderRigBuffer(decoded, rig, { sampleRate: 44100, tailSeconds: 2, signal });
  const channels = Array.from({ length: rendered.buffer.numberOfChannels }, (_, i) => rendered.buffer.getChannelData(i));
  const activeFrames=rendered.buffer.length-2*44100,mono = new Float32Array(activeFrames); let peak=0,guarded=0,energy=0;
  for(let i=0;i<rendered.buffer.length;i++)for(const channel of channels){if(!Number.isFinite(channel[i]))throw Error("Nonfinite rig output.");peak=Math.max(peak,Math.abs(channel[i]));if(Math.abs(channel[i])>=.949)guarded++;if(i<activeFrames)mono[i]+=channel[i]/channels.length;}
  for(const x of mono)energy+=x*x;
  const guardFraction=guarded/(rendered.buffer.length*channels.length),safe=peak<=.951&&guardFraction<.01;
  // Tails are rendered/protected; appended silence must not alter active-span source descriptors.
  return {...rigFeatureDistance(toneFeatures(mono,44100),target,temporal?temporalFeatures(mono,44100):undefined,temporal),safe,peak,guardFraction,rmsDbfs:10*Math.log10(Math.max(1e-24,energy/mono.length))};
}
export function neutralRigProposal(): RigProposal {
  return {proposal_version:"1",name:"Neutral reference",description:"No added EQ or saturation",tempo_bpm:120,modules:[{model_id:"eq.tilt",enabled:true,parameters:modelValues(createGearModule("eq.tilt"))}]};
}

export async function refineRig(file:File,value:RigProposal,inputGainDb:number,target:ToneFeatures,
  options:{signal?:AbortSignal;progress?:(renders:number)=>void;temporal?:TemporalFeatures;targetRmsDbfs?:number;targetWindows?:RigTargetWindow[]}={}) {
  const original=parseRigProposal(value);if(!validToneFeatures(target))throw Error("Invalid target spectrum.");
  if(options.targetRmsDbfs!==undefined&&(!Number.isFinite(options.targetRmsDbfs)||options.targetRmsDbfs < -100||options.targetRmsDbfs>0))throw Error("Invalid target level.");
  if(options.targetWindows&&(options.targetWindows.length!==2||options.targetWindows.some(w=>!validToneFeatures(w.tone))))throw Error("Invalid target validation windows.");
  if(!file.size||file.size>20*1024*1024)throw Error("Choose guitar audio up to 20 MiB.");
  options.signal?.throwIfAborted();
  const decoder=new OfflineAudioContext(1,1,44100),decoded=await decoder.decodeAudioData(await file.arrayBuffer());
  if(decoded.numberOfChannels!==1||decoded.duration<6||decoded.duration>90)throw Error("Validated refinement needs 6–90 seconds of prepared mono guitar audio.");
  const samples=decoded.getChannelData(0).slice(0,44100*15),split=Math.min(Math.round(samples.length*.6),samples.length-44100*3);
  const chunks=[samples.slice(0,split),samples.slice(split)];
  // Decode each former PCM16 excerpt once; browser PCM conversion differs from hand normalization.
  const buffers=await Promise.all(chunks.map(async samples=>decoder.decodeAudioData(await encodeMonoWav(samples,44100).arrayBuffer())));
  options.signal?.throwIfAborted();
  const targets=options.targetWindows??[{tone:target,temporal:options.temporal},{tone:target,temporal:options.temporal}];
  const cache=new Map<string,RigScore>();let renders=0;
  async function score(proposal:RigProposal,validation=false,output=-18,full=false){
    options.signal?.throwIfAborted();const key=JSON.stringify([proposal.modules,validation,output,full]);
    if(cache.has(key))return cache.get(key)!;
    if(renders>=80)throw Error("Local rendering budget exhausted.");
    const t=full?{tone:target,temporal:options.temporal}:targets[validation?1:0];
    const result=await scoreBuffer(full?decoded:buffers[validation?1:0],compileRigProposal(proposal,inputGainDb,output),t.tone,options.signal,t.temporal);
    cache.set(key,result);renders++;options.progress?.(renders);return result;
  }
  const baseline=await score(original),baselineValidation=await score(original,true);
  const pool:Array<{proposal:RigProposal;score:RigScore}>=[];let best={proposal:original,score:baseline};
  async function consider(candidate:RigProposal,limit=70){
    if(renders>=limit)return;
    const result=await score(candidate);if(!result.safe)return;
    if(!pool.some(x=>JSON.stringify(x.proposal.modules)===JSON.stringify(candidate.modules)))pool.push({proposal:candidate,score:result});
    if(!best.score.safe||result.loss<best.score.loss-1e-5)best={proposal:candidate,score:result};
  }
  const sourceTiming=temporalFeatures(chunks[0],44100);
  for(const candidate of structureCandidates(original,estimateDelay(sourceTiming,targets[0].temporal)))await consider(candidate);
  for(const candidate of discreteCandidates(best.proposal))await consider(candidate);
  async function tune(steps:number[],limit:number,bodyOnly=false){
   const schedule=parameterSchedule(best.proposal).filter(entry=>!bodyOnly||!/^(delay|reverb)\./.test(best.proposal.modules[entry.index].model_id));
   for(const step of steps)for(const entry of schedule){
    if(renders>=limit)break;
    const model=getGearModel(best.proposal.modules[entry.index].model_id),parameter=model.parameters.find(p=>p.id===entry.id)!;
    const position=normalizeModelValue(parameter,best.proposal.modules[entry.index].parameters[entry.id] as number);
    for(const delta of [-step,step]){
      const candidate=structuredClone(best.proposal);candidate.modules[entry.index].parameters[entry.id]=denormalizeModelValue(parameter,Math.max(0,Math.min(1,position+delta)));
      try{parseRigProposal(candidate);}catch{continue;}
      await consider(candidate,limit);
    }
   }
  }
  await tune([.18,.06,.02],50,true);
  // Test ambience again after fitting the dry timbre; a bad initial EQ must not rule it out.
  for(const candidate of ambienceCandidates(best.proposal,estimateDelay(sourceTiming,targets[0].temporal)))await consider(candidate,58);
  await tune([.06,.02,.007],70);
  let selected={proposal:original,score:baseline},validation=baselineValidation;
  const ranked=pool.filter(x=>x.score.loss<baseline.loss||!baseline.safe).sort((a,b)=>a.score.loss-b.score.loss);
  const finalists=ranked.slice(0,3),structures=new Set(finalists.map(x=>JSON.stringify(x.proposal.modules.map(m=>[m.model_id,m.enabled]))));
  for(const candidate of ranked){const structure=JSON.stringify(candidate.proposal.modules.map(m=>[m.model_id,m.enabled]));if(!structures.has(structure)&&finalists.length<6){structures.add(structure);finalists.push(candidate);}}
  for(const candidate of finalists){const result=await score(candidate.proposal,true);if(validatedImprovement(candidate.score,baseline,result,baselineValidation)&&(!validation.safe||result.loss<validation.loss)){selected=candidate;validation=result;}}
  if(!selected.score.safe||!validation.safe)throw Error("No independently validated safe rig found. Lower gain or review the original chain.");
  const retained=JSON.stringify(selected.proposal.modules)!==JSON.stringify(original.modules);
  let outputLevelDb=-18,finalScore=selected.score;
  if(options.targetRmsDbfs!==undefined){
    const full=await score(selected.proposal,false,-18,true);
    outputLevelDb=Math.max(-36,Math.min(-6,-18+options.targetRmsDbfs-full.rmsDbfs,-18+20*Math.log10(.9/Math.max(full.peak,1e-12))));
    finalScore=await score(selected.proposal,false,outputLevelDb,true);if(!finalScore.safe)throw Error("Output level could not be calibrated safely.");
  }
  return {proposal:selected.proposal,outputLevelDb,before:baseline.loss,after:selected.score.loss,renders,score:finalScore,retained,
    validationBefore:baselineValidation.loss,validationAfter:validation.loss,version:RIG_SEARCH_VERSION,trainingSeconds:split/44100,validationSeconds:(samples.length-split)/44100};
}
