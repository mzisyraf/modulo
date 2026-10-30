import { createGearModule, getGearModel, modelValues, parseRigProposal, type RigProposal } from "@modulo/audio";
import type { ToneFeatures } from "./audioFeatures.ts";
import type { TemporalFeatures } from "./temporalFeatures.ts";

export interface RigScore { loss: number; spectrum: number; harmonics: number; dynamics: number; timing: number; safe: boolean; peak: number; guardFraction: number; rmsDbfs: number }
export const RIG_SEARCH_VERSION = "validated-structure-v2";

export function rigFeatureDistance(a: ToneFeatures, b: ToneFeatures, at?: TemporalFeatures, bt?: TemporalFeatures) {
  const bands=(x:ToneFeatures)=>x.fine_bands??x.bands;
  const av=bands(a),bv=bands(b);
  // Old six-band records remain usable; do not compare unlike vector sizes.
  const x=av.length===bv.length?av:a.bands,y=av.length===bv.length?bv:b.bands;
  const envelope=x.reduce((sum,v,i)=>sum+Math.abs(10*Math.log10((v+1e-6)/(y[i]+1e-6))),0)/x.length;
  const cepstral=a.cepstrum&&b.cepstrum?a.cepstrum.reduce((sum,v,i)=>sum+Math.abs(v-b.cepstrum![i]),0)/8:envelope;
  const spectrum=.65*envelope+.35*cepstral;
  const confidence=Math.min(a.harmonic_confidence??0,b.harmonic_confidence??0);
  const harmonics=a.harmonic_profile&&b.harmonic_profile?confidence*a.harmonic_profile.reduce((sum,v,i)=>sum+Math.abs(v-b.harmonic_profile![i]),0):0;
  const dynamics=Math.abs(a.crest_db-b.crest_db)/10;
  let timing=0;
  if(at&&bt){
    if(at.envelope_acf&&bt.envelope_acf)timing=at.envelope_acf.reduce((sum,v,i)=>sum+Math.abs(v-bt.envelope_acf![i]),0)/100;
    else timing=at.correlations.reduce((sum,v,i)=>sum+Math.abs(v-bt.correlations[i]),0)/10;
    let decay=0,count=0;
    for(let i=0;i<6;i++)if((at.decay_counts?.[i]??0)>0&&(bt.decay_counts?.[i]??0)>0){decay+=Math.abs(Math.log((at.decay_curve![i]+.02)/(bt.decay_curve![i]+.02)));count++;}
    if(count)timing+=decay/count*.25;
  }
  return {spectrum,harmonics,dynamics,timing,loss:spectrum+2*harmonics+.5*dynamics+timing};
}

export function validatedImprovement(train: RigScore, original: RigScore, validation: RigScore, originalValidation: RigScore) {
  return train.safe&&validation.safe&&(!original.safe||train.loss<original.loss-1e-5)
    &&(!originalValidation.safe||(validation.loss<originalValidation.loss*.995&&validation.spectrum<=originalValidation.spectrum+1e-5));
}

export function estimateDelay(source?: TemporalFeatures,target?: TemporalFeatures) {
  if(!source?.envelope_acf||!target?.envelope_acf)return 300;
  const difference=target.envelope_acf.map((x,i)=>x-source.envelope_acf![i]);
  let best=.003,lag=29;
  // A broad rising correlation or a boundary maximum is often playing rhythm, not an echo.
  for(let i=5;i<77;i++){
    const prominence=difference[i]-(difference[i-3]+difference[i+3])/2;
    if(difference[i]>0&&difference[i]>=difference[i-1]&&difference[i]>=difference[i+1]&&prominence>best){best=prominence;lag=i;}
  }
  return (lag+1)*10;
}

function module(model_id:string,parameters:Record<string,number|boolean|string>={}) {return {model_id,enabled:true,parameters:{...modelValues(createGearModule(model_id)),...parameters}};}
function put(base:RigProposal,type:string,id:string,values:Record<string,number|boolean|string>={}){
  const candidate=structuredClone(base),next=module(id,values),at=candidate.modules.findIndex(m=>m.model_id.startsWith(type+"."));
  if(at>=0)candidate.modules[at]=next;
  else {const before=candidate.modules.findIndex(m=>type==="amp"?/^(cabinet|delay|reverb)\./.test(m.model_id):type==="cabinet"?/^(delay|reverb)\./.test(m.model_id):false);candidate.modules.splice(before<0?candidate.modules.length:before,0,next);}
  return candidate;
}
export function ambienceCandidates(value:RigProposal,delayMs:number) {
  const candidates:RigProposal[]=[];
  for(const time of new Set([delayMs,140,320,650])){
    candidates.push(put(value,'delay','delay.digital',{time_ms:time,feedback:.2,mix:.2,sync:false}));
  }
  candidates.push(put(value,'reverb','reverb.plate',{mix:.15}));
  candidates.push(put(put(value,'delay','delay.digital',{time_ms:delayMs,feedback:.2,mix:.2,sync:false}),'reverb','reverb.plate',{mix:.15}));
  return candidates.filter(candidate=>{try{parseRigProposal(candidate);return true;}catch{return false;}});
}
export function structureCandidates(value:RigProposal,delayMs:number):RigProposal[] {
  const original=parseRigProposal(value),out:RigProposal[]=[],seen=new Set([JSON.stringify(original.modules)]);
  function add(candidate:RigProposal){try{parseRigProposal(candidate);}catch{return;}const key=JSON.stringify(candidate.modules);if(!seen.has(key)){seen.add(key);out.push(candidate);}}
  const crunch=put(original,"amp","amp.british_crunch",{gain:.3,master_db:-12});
  const lean={...structuredClone(original),modules:original.modules.filter(m=>m.model_id.startsWith('eq.')).map(m=>structuredClone(m))};
  if(!lean.modules.length)lean.modules=[module('eq.neutral')];
  add(lean);add(put(lean,'amp','amp.studio_clean',{volume_db:-6}));
  add(put(put(lean,'amp','amp.british_crunch',{gain:.3,master_db:-12}),'cabinet','cabinet.open_112'));
  add(crunch);add(put(original,"amp","amp.american_clean",{input_drive:.15,master_db:-12}));add(put(original,"amp","amp.studio_clean",{volume_db:-6}));
  add(put(original,"cabinet","cabinet.open_112"));add(put(original,"cabinet","cabinet.closed_412"));
  add(put(crunch,"cabinet","cabinet.open_112"));
  const delayed=put(original,"delay","delay.digital",{time_ms:delayMs,feedback:.2,mix:.2,sync:false});
  add(delayed);add(put(original,"delay","delay.digital",{time_ms:Math.max(60,delayMs*.5),feedback:.15,mix:.2,sync:false}));
  add(put(original,"reverb","reverb.plate",{mix:.15}));add(put(delayed,"reverb","reverb.plate",{mix:.15}));
  // Single bypasses and categorical choices are hypotheses, never assumed improvements.
  for(let i=0;i<original.modules.length&&out.length<18;i++){
    const bypass=structuredClone(original);bypass.modules[i].enabled=!bypass.modules[i].enabled;add(bypass);
    for(const p of getGearModel(original.modules[i].model_id).parameters){
      const choices=p.type==="boolean"?[!original.modules[i].parameters[p.id]]:p.type==="choice"?p.choices.map(x=>x.value):[];
      for(const choice of choices){const candidate=structuredClone(original);candidate.modules[i].parameters[p.id]=choice;add(candidate);if(out.length>=18)break;}
      if(out.length>=18)break;
    }
  }
  return out.slice(0,18);
}

export function discreteCandidates(proposal:RigProposal) {
  const result:RigProposal[]=[];
  proposal.modules.forEach((m,index)=>{
    if(!m.enabled)return;
    for(const p of getGearModel(m.model_id).parameters){
      if(p.id==='division'&&m.parameters.sync===false)continue;
      const choices=p.type==='boolean'?[!m.parameters[p.id]]:p.type==='choice'?p.choices.map(x=>x.value).filter(x=>x!==m.parameters[p.id]):[];
      for(const choice of choices){const candidate=structuredClone(proposal);candidate.modules[index].parameters[p.id]=choice;try{parseRigProposal(candidate);result.push(candidate);}catch{/* Coupled controls must stay valid. */}}
    }
  });
  return result.slice(0,6);
}

export function parameterSchedule(proposal:RigProposal) {
  const groups:Array<Array<{index:number;id:string}>>=[[],[],[],[]];
  proposal.modules.forEach((m,index)=>{
    if(!m.enabled)return;
    const group=/^(amp|cabinet|overdrive|distortion|fuzz|boost)\./.test(m.model_id)?0:m.model_id.startsWith("eq.")?1:/^(delay|reverb|chorus|flanger|phaser|tremolo)\./.test(m.model_id)?2:3;
    const priority=["gain","input_drive","position","high_cut_hz","time_ms","mix","feedback","decay_s","mid_db","bass_db","treble_db","threshold_db"];
    const parameters=getGearModel(m.model_id).parameters.filter(p=>p.type==="number"&&!/^(master_db|volume_db|level_db)$/.test(p.id));
    parameters.sort((a,b)=>(priority.indexOf(a.id)<0?99:priority.indexOf(a.id))-(priority.indexOf(b.id)<0?99:priority.indexOf(b.id)));
    groups[group].push(...parameters.map(p=>({index,id:p.id})));
  });
  const result:Array<{index:number;id:string}>=[];
  for(let i=0;groups.some(g=>i<g.length);i++)for(const group of groups)if(group[i])result.push(group[i]);
  return result;
}
