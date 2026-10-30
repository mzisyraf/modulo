import test from "node:test";
import assert from "node:assert/strict";
import {parseSongTabs,notesInWindow,tabsBusy} from "../src/songTabs.ts";
function fixture(){return{status:"ready",result:{version:1,duration_seconds:295,source_sha256:"a".repeat(64),tuning:"standard",capo:0,quality_flags:["draft_tablature"],notes:[{start_seconds:293.5,end_seconds:294.2,midi_pitch:67,model_strength:.8,pitch_bend:false,string:1,fret:3,assignment_status:"suggested"}],provenance:{provider:"modal",model:"spotify/basic-pitch:0.4.0",model_sha256:"2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec",runtime:"onnxruntime-cuda",cuda_kernels:500,elapsed_seconds:16}}};}
test("full-song tab parser accepts verified GPU notes through the final window",()=>{
 const value=parseSongTabs(fixture(),295);assert.equal(notesInWindow(value.result!.notes,290,5).length,1);assert.equal(notesInWindow(value.result!.notes,0,10).length,0);assert.equal(tabsBusy("transcribing"),true);assert.equal(tabsBusy("ready"),false);
 const unassigned=fixture();Object.assign(unassigned.result.notes[0],{string:null,fret:null,assignment_status:"unassigned"});assert.equal(parseSongTabs(unassigned,295).result?.notes[0].string,null);
});
test("tab parser rejects false CUDA, foreign timeline and impossible fingering",()=>{
 for(const change of [(v:ReturnType<typeof fixture>)=>v.result.provenance.cuda_kernels=0,v=>v.result.provenance.runtime="cpu",v=>v.result.provenance.model_sha256="a".repeat(64),v=>v.result.notes[0].fret=25,v=>v.result.notes[0].start_seconds=NaN,v=>v.result.notes[0].midi_pitch=68,v=>v.result.duration_seconds=15]){const value=fixture();change(value);assert.throws(()=>parseSongTabs(value,295));}
 assert.throws(()=>parseSongTabs({status:"uploading",result:fixture().result},295));
});
