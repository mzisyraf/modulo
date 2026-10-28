import assert from "node:assert/strict";
import {test} from "node:test";
import {toneFeatures,validToneFeatures,toneDistance} from "../src/audioFeatures.ts";
test("spectral bands identify a known tone and ignore pure level changes",()=>{
 const samples=Float32Array.from({length:44100*3},(_,i)=>.2*Math.sin(2*Math.PI*440*i/44100));
 const feature=toneFeatures(samples,44100),quieter=toneFeatures(Float32Array.from(samples,x=>x*.2),44100);
 assert.ok(validToneFeatures(feature));assert.ok(feature.bands[2]>.99);
 assert.ok(Math.abs(feature.centroid_hz-440)<1);assert.ok(toneDistance(feature,quieter)<.001);
 assert.ok(toneDistance(feature,toneFeatures(Float32Array.from(samples,(_,i)=>.2*Math.sin(2*Math.PI*4000*i/44100)),44100))>10);
 assert.equal(validToneFeatures({...feature,bands:[1,1,1,1,1,1]}),false);
 assert.throws(()=>toneFeatures(new Float32Array(4096),44100));
});
