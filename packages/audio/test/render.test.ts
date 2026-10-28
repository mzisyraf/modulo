import assert from "node:assert/strict";
import {test} from "node:test";
import {AudioEngine} from "../src/index.ts";
import example from "../../../fixtures/preset.example.json" with {type:"json"};
import {parsePreset} from "../../../contracts/src/index.ts";

test("offline rendering rejects unsafe inputs before allocating any audible context",async()=>{
 const preset=parsePreset(example);
 await assert.rejects(AudioEngine.renderFile({size:0} as File,preset),/nonempty/);
 await assert.rejects(AudioEngine.renderFile({size:21*1024*1024} as File,preset),/20 MiB/);
 await assert.rejects(AudioEngine.renderFile({size:1} as File,{...preset,parameters:{...preset.parameters,drive:2}}));
 const engine=new AudioEngine(preset);
 assert.doesNotThrow(()=>engine.setListeningGains(48,-48));
 assert.throws(()=>engine.setListeningGains(49,0));
 assert.throws(()=>engine.setListeningGains(0,NaN));
});
