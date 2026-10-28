import assert from "node:assert/strict";
import {test} from "node:test";
import {refinePreset} from "../src/refinePreset.ts";
import {parsePreset} from "../../../contracts/src/index.ts";
import fixture from "../../../fixtures/preset.example.json" with {type:"json"};

test("cancelled or invalid refinement rejects before decoding or allocating contexts",async()=>{
 const preset=parsePreset(fixture),file=new File([new Uint8Array([1])],"test.wav");
 const target={method:"spectral_bands_v1" as const,bands:[.1,.2,.3,.2,.1,.1],centroid_hz:1000,flatness:.1,crest_db:10};
 const action=new AbortController();action.abort();
 await assert.rejects(refinePreset(file,preset,target,{signal:action.signal}),{name:"AbortError"});
 await assert.rejects(refinePreset(file,preset,{...target,bands:[1]}),/Invalid target spectrum/);
 await assert.rejects(refinePreset(file,preset,target,{targetRmsDbfs:Infinity}),/Invalid target level/);
});
