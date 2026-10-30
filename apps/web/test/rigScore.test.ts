import test from "node:test";
import assert from "node:assert/strict";
import { neutralRigProposal, scoreRig } from "../src/refineRig.ts";
import type { ToneFeatures } from "../src/audioFeatures.ts";
import type { RigProposal } from "@modulo/audio";

test("rig scoring validates proposals, gains, files and aborts before allocating a decoder", async () => {
  const target: ToneFeatures={method:"spectral_bands_v1",bands:[.1,.2,.3,.2,.1,.1],centroid_hz:1000,flatness:.1,crest_db:10};
  const file=new File([new Uint8Array([1])],"test.wav"),proposal=neutralRigProposal();
  await assert.rejects(scoreRig(file,{} as RigProposal,0,target),/rig proposal fields/);
  await assert.rejects(scoreRig(file,proposal,Infinity,target),/Invalid calibrated input gain/);
  await assert.rejects(scoreRig(new File([],"empty.wav"),proposal,0,target),/20 MiB/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(scoreRig(file,proposal,0,target,controller.signal),{name:"AbortError"});
});
