import assert from "node:assert/strict";
import {test} from "node:test";
import {toneFeatures,validToneFeatures,toneDistance,detailedToneDistance} from "../src/audioFeatures.ts";
test("spectral bands identify a known tone and ignore pure level changes",()=>{
 const samples=Float32Array.from({length:44100*3},(_,i)=>.2*Math.sin(2*Math.PI*440*i/44100));
 const feature=toneFeatures(samples,44100),quieter=toneFeatures(Float32Array.from(samples,x=>x*.2),44100);
 assert.ok(validToneFeatures(feature));assert.ok(feature.bands[2]>.99);
 assert.ok(Math.abs(feature.centroid_hz-440)<1);assert.ok(toneDistance(feature,quieter)<.001);
 assert.ok(toneDistance(feature,toneFeatures(Float32Array.from(samples,(_,i)=>.2*Math.sin(2*Math.PI*4000*i/44100)),44100))>10);
 assert.equal(validToneFeatures({...feature,bands:[1,1,1,1,1,1]}),false);
 assert.throws(()=>toneFeatures(new Float32Array(4096),44100));
});

test("local score can distinguish shape changes hidden inside one broad spectral band",()=>{
 const base={method:"spectral_bands_v1" as const,bands:[0,0,1,0,0,0],centroid_hz:600,flatness:.001,crest_db:12};
 const fine=Array(24).fill(0),other=Array(24).fill(0);fine[10]=1;other[11]=1;
 const a={...base,fine_bands:fine},b={...base,fine_bands:other};
 assert.equal(toneDistance(a,b),0);assert.ok(detailedToneDistance(a,b)>1);
 assert.equal(detailedToneDistance(base,base),0);
 assert.equal(validToneFeatures({...a,fine_bands:Array(24).fill(1)}),false);
});
