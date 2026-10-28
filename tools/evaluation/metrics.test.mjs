import assert from "node:assert/strict";
import {test} from "node:test";
import {spectrum,compareAudio,beatsBaseline} from "./metrics.mjs";
const rate=8000,signal=Float32Array.from({length:8192},(_,i)=>.1*Math.sin(2*Math.PI*250*i/rate)+.02*Math.sin(2*Math.PI*1500*i/rate));
const options={sampleRate:rate,paired:true};

test("FFT agrees with an analytic sinusoid",()=>{
 const sine=Float64Array.from({length:1024},(_,i)=>Math.sin(2*Math.PI*32*i/1024));
 const magnitudes=spectrum(sine);assert.ok(Math.abs(magnitudes[32]-.5)<1e-10);
 assert.ok(magnitudes.every((v,i)=>i===32||v<1e-10));
});
test("identical target is zero and wrong tone loses to oracle",()=>{
 const oracle=compareAudio(signal,signal,options);
 assert.equal(oracle.raw.loss,0);assert.equal(oracle.rms_matched.loss,0);assert.equal(oracle.esr,0);
 const wrong=Float32Array.from(signal,(_,i)=>.1*Math.sin(2*Math.PI*250*i/rate));
 const baseline=compareAudio(wrong,signal,options);assert.ok(baseline.raw.loss>0);
 assert.equal(beatsBaseline(oracle,baseline),true);assert.equal(beatsBaseline(baseline,baseline),false);
});
test("a louder identical tone cannot hide its raw level error",()=>{
 const loud=compareAudio(Float32Array.from(signal,x=>x*2),signal,options);
 assert.ok(loud.raw.loss>.1);assert.ok(loud.rms_matched.loss<1e-7);
 assert.ok(Math.abs(loud.level_difference_db-6.0206)<.001);
});
test("unpaired, wrong-length, silent and nonfinite audio reject; unsafe output is flagged",()=>{
 assert.throws(()=>compareAudio(signal,signal,{sampleRate:rate}));
 assert.throws(()=>compareAudio(signal.slice(1),signal,options));
 assert.throws(()=>compareAudio(new Float32Array(signal.length),signal,options));
 const bad=signal.slice();bad[2]=NaN;assert.throws(()=>compareAudio(bad,signal,options));
 const unsafe=signal.slice();unsafe[2]=1.2;assert.equal(compareAudio(unsafe,signal,options).safe,false);
});
