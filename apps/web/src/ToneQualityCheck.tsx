import {useEffect,useRef,useState} from "react";
import {AudioEngine} from "@modulo/audio";
import type {Preset} from "@modulo/contracts";
import {toneDistance,toneFeatures,type ToneFeatures} from "./audioFeatures";
import type {CalibratedRecording} from "./recordingCalibration";
import {refinePreset,type Refinement} from "./refinePreset";

export function ToneQualityCheck({recording,preset,target,onRefined}:{recording:CalibratedRecording;preset:Preset;target:ToneFeatures;onRefined:(preset:Preset)=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const [result,setResult]=useState<{candidate:number;neutral:number;safe:boolean}>();
  const [refined,setRefined]=useState<Refinement>();
  const [renders,setRenders]=useState(0);
  const controller=useRef<AbortController|undefined>(undefined);
  const run=useRef(0);
  const parameters=JSON.stringify(preset.parameters), targetKey=JSON.stringify(target);
  useEffect(()=>{run.current++;controller.current?.abort();setBusy(false);setResult(undefined);setRefined(undefined);setError("");return()=>{run.current++;controller.current?.abort();};},[recording.measurements.id,parameters,targetKey]);
  async function check(){
    if(busy)return;const request=++run.current;controller.current=undefined;setBusy(true);setError("");
    try {
      const neutral={...preset,parameters:{...preset.parameters,input_gain_db:recording.inputGainDb,drive:0,bass_db:0,mid_db:0,treble_db:0}};
      const [candidate,baseline]=await Promise.all([AudioEngine.renderFile(recording.file,preset),AudioEngine.renderFile(recording.file,neutral)]);
      const samples=candidate.getChannelData(0);let guarded=0;
      for(const sample of samples){if(!Number.isFinite(sample)||Math.abs(sample)>.951)throw Error("Rendered output is invalid or exceeds protection bounds");if(Math.abs(sample)>=.949)guarded++;}
      const next={candidate:toneDistance(toneFeatures(samples,candidate.sampleRate),target),neutral:toneDistance(toneFeatures(baseline.getChannelData(0),baseline.sampleRate),target),safe:guarded/samples.length<.01};
      if(request===run.current)setResult(next);
    } catch(failure){if(request===run.current)setError(failure instanceof Error?failure.message:"Tone check failed");}
    finally{if(request===run.current)setBusy(false);}
  }
  async function refine(){
    if(busy)return;const request=++run.current;
    const action=new AbortController();controller.current=action;
    setBusy(true);setError("");setRenders(0);setRefined(undefined);
    try {
      const next=await refinePreset(recording.file,preset,target,{signal:action.signal,progress:count=>{if(request===run.current)setRenders(count);}});
      if(request===run.current)setRefined(next);
    }catch(failure){if(request===run.current&&!(failure instanceof Error&&failure.name==="AbortError"))setError(failure instanceof Error?failure.message:"Refinement failed");}
    finally{if(request===run.current)setBusy(false);if(controller.current===action)controller.current=undefined;}
  }
  return <div className="guitar-comparison"><h3>Check the rendered rig</h3>
    <p>Render your recording through this preset and a neutral rig locally. Nothing plays and no provider request is made.</p>
    <button className="secondary" disabled={busy} onClick={()=>void check()}>{busy?"Rendering and comparing…":"Check rendered tone"}</button>
    <button className="secondary" disabled={busy} onClick={()=>void refine()}>Refine locally</button>
    {busy&&controller.current&&!controller.current.signal.aborted&&<button className="stop" onClick={()=>controller.current?.abort()}>Cancel refinement</button>}
    {busy&&renders>0&&<p role="status">{renders} local candidate renders completed · no AI requests</p>}
    {refined&&<div role="status"><p>Local refinement: feature distance {refined.before.toFixed(2)} → {refined.after.toFixed(2)} dB-weighted · {refined.renders} renders.</p><button disabled={JSON.stringify(refined.preset.parameters)===parameters} onClick={()=>onRefined(refined.preset)}>Use refined controls</button><p>Uses up to the first 15 seconds and preserves current input/output gains. A quiet separated stem does not set your listening volume. Review and Apply separately; this is a spectral proxy, not a verified tone match.</p></div>}
    {result&&<div role="status"><strong>{!result.safe?"Output protection is heavily engaged — lower gain or drive.":result.candidate<result.neutral*.9?"Closer spectral balance than neutral — listening still required.":"No clear spectral improvement over the neutral rig."}</strong><p>Feature difference: rig {result.candidate.toFixed(2)} · neutral {result.neutral.toFixed(2)} dB-weighted. Lower is closer.</p></div>}
    {error&&<p className="error" role="alert">{error}</p>}
    <p className="hint">This is a spectral proxy across different performances. Notes, playing technique and separation bleed affect it. It is not a tone-match accuracy score or a substitute for listening. Check again after edits; Apply and playback remain manual.</p>
  </div>;
}
