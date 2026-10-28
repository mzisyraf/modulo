import {AudioEngine} from "@modulo/audio";
import type {Preset} from "@modulo/contracts";
import {auditionPreset} from "./auditionPreset.ts";

interface Level {rms:number;peak:number}
export interface ListeningLevels {originalDb:number;processedDb:number;rmsDbfs:number}
export function matchedListeningLevels(original:Level,processed:Level):ListeningLevels {
  if(![original.rms,original.peak,processed.rms,processed.peak].every(x=>Number.isFinite(x)&&x>0)||original.rms>original.peak||processed.rms>processed.peak)throw Error("Cannot level-match silent or invalid audio");
  const maximum=10**(48/20);
  const target=Math.min(10**(-24/20),.5*original.rms/original.peak,.5*processed.rms/processed.peak,original.rms*maximum,processed.rms*maximum);
  return {originalDb:Math.max(-48,Math.min(48,20*Math.log10(target/original.rms))),processedDb:Math.max(-48,Math.min(48,20*Math.log10(target/processed.rms))),rmsDbfs:20*Math.log10(target)};
}
export async function measureListeningLevels(file:File,preset:Preset):Promise<ListeningLevels> {
  const [original,processed]=await Promise.all([AudioEngine.renderFile(file,auditionPreset(preset,true),true),AudioEngine.renderFile(file,preset)]);
  const level=(buffer:AudioBuffer):Level=>{
    const data=buffer.getChannelData(0);let energy=0,peak=0;
    for(const sample of data){if(!Number.isFinite(sample))throw Error("Invalid rendered audio");energy+=sample*sample;peak=Math.max(peak,Math.abs(sample));}
    return {rms:Math.sqrt(energy/data.length),peak};
  };
  return matchedListeningLevels(level(original),level(processed));
}
