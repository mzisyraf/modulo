import test from "node:test";
import assert from "node:assert/strict";
import { createGearModule, modelValues, parseRigProposal, type RigProposal } from "@modulo/audio";
import { structureCandidates, ambienceCandidates, discreteCandidates, parameterSchedule, validatedImprovement, rigFeatureDistance, estimateDelay, type RigScore } from "../src/rigSearch.ts";
import { toneFeatures, validToneFeatures } from "../src/audioFeatures.ts";
const module=(model_id:string)=>({model_id,enabled:true,parameters:modelValues(createGearModule(model_id))});
const rig=(ids:string[]):RigProposal=>({proposal_version:"1",name:"Regression",description:"Explicit values",tempo_bpm:120,modules:ids.map(module)});
const score=(loss:number,spectrum=loss):RigScore=>({loss,spectrum,harmonics:0,dynamics:0,timing:0,safe:true,peak:.1,guardFraction:0,rmsDbfs:-24});
test("a lower training proxy cannot replace the original with worse validation spectrum",()=>{
  assert.equal(validatedImprovement(score(1),score(2),score(.8,1.1),score(1)),false);
  assert.equal(validatedImprovement(score(1),score(2),score(.8,1.005),score(1)),false);
  assert.equal(validatedImprovement(score(1),score(2),score(.8,.8),score(1)),true);
  assert.equal(validatedImprovement(score(1),score(2),{...score(.5),safe:false},score(1)),false);
  assert.equal(validatedImprovement(score(1),score(2),score(1),score(1)),false);
});
test("bounded structural hypotheses can add missing effects without mutating raw model output",()=>{
  const raw=rig(["eq.neutral"]),before=JSON.stringify(raw),rows=structureCandidates(raw,240);
  assert.ok(rows.length<=18&&rows.length>6);rows.forEach(parseRigProposal);
  assert.ok(rows.some(r=>r.modules.some(m=>m.model_id==="delay.digital"&&m.parameters.time_ms===240)));
  assert.ok(rows.some(r=>r.modules.some(m=>m.model_id.startsWith("amp."))&&r.modules.some(m=>m.model_id.startsWith("cabinet."))));
  assert.ok(rows.some(r=>r.modules.some(m=>m.model_id.startsWith("delay."))&&r.modules.some(m=>m.model_id.startsWith("reverb."))));
  assert.equal(JSON.stringify(raw),before);
  const excessive=rig(['gate.gentle','compressor.studio','boost.clean','amp.american_clean','cabinet.open_112','eq.neutral']);
  assert.ok(structureCandidates(excessive,300).some(r=>r.modules.length===1&&r.modules[0].model_id==='eq.neutral'),'clean matching can remove several unnecessary effects together');
  assert.ok(discreteCandidates(rig(['amp.british_crunch','cabinet.open_112'])).some(r=>r.modules[1].parameters.mic==='ribbon'),'newly selected cabinet microphone choices are explored');
  const categorical=structureCandidates(rig(["cabinet.open_112"]),300);
  assert.ok(categorical.some(r=>r.modules.some(m=>m.model_id==="cabinet.open_112"&&m.parameters.mic==="ribbon")));
  assert.ok(structureCandidates(rig(Array(8).fill("eq.neutral")),300).every(r=>r.modules.length<=8));
});
test("search scheduling reaches ambience and EQ before exhausting amplifier controls",()=>{
  const value=rig(["amp.british_crunch","cabinet.closed_412","eq.neutral","delay.digital","reverb.plate","compressor.studio"]);
  const first=parameterSchedule(value).slice(0,4).map(x=>value.modules[x.index].model_id);
  assert.deepEqual(first,["amp.british_crunch","eq.neutral","delay.digital","compressor.studio"]);
});
test('ambience exploration is not trapped by a rhythm-like boundary correlation',()=>{
  const source={method:'envelope_v1' as const,correlations:Array(10).fill(0),release_ratio:0,envelope_acf:Array(100).fill(0)};
  const target={...source,envelope_acf:Array.from({length:100},(_,i)=>i/100)};
  assert.equal(estimateDelay(source,target),300);
  const peaked={...source,envelope_acf:Array.from({length:100},(_,i)=>Math.max(0,.3-.06*Math.abs(i-23)))};
  assert.equal(estimateDelay(source,peaked),240);
  const rows=ambienceCandidates(rig(['eq.neutral']),800);rows.forEach(parseRigProposal);
  assert.ok(rows.some(r=>r.modules.some(m=>m.parameters.time_ms===320)));
});
test("harmonic descriptors distinguish clipping and ignore overall gain",()=>{
  const rate=44100,dry=Float32Array.from({length:rate*3},(_,i)=>.1*Math.sin(2*Math.PI*220*i/rate));
  const a=toneFeatures(dry,rate),b=toneFeatures(dry.map(x=>Math.max(-.03,Math.min(.03,x))),rate),scaled=toneFeatures(dry.map(x=>x*.2),rate);
  assert.ok(validToneFeatures(a)&&a.harmonic_confidence!>.7);
  assert.ok(b.harmonic_profile![0]<a.harmonic_profile![0]-.02);
  assert.ok(rigFeatureDistance(a,b).harmonics>.02);
  assert.ok(rigFeatureDistance(a,scaled).loss<1e-5);
  assert.equal(validToneFeatures({...a,cepstrum:[NaN]}),false);
});
