import test from "node:test";
import assert from "node:assert/strict";
import { createRigPreset, renderRigBuffer, renderRigFile } from "../src/index.ts";

test("prepared rendering rejects invalid PCM/options and cancellation before allocating graphs", async () => {
  class BufferFixture {
    sampleRate=44100; duration=1; length=44100; numberOfChannels=1;
    samples=new Float32Array(44100);
    getChannelData(){return this.samples;}
  }
  const previous=Object.getOwnPropertyDescriptor(globalThis,"AudioBuffer");
  Object.defineProperty(globalThis,"AudioBuffer",{configurable:true,value:BufferFixture});
  const source=new BufferFixture() as unknown as AudioBuffer,rig=createRigPreset();
  try{
    await assert.rejects(renderRigBuffer({} as AudioBuffer,rig),/decoded AudioBuffer/);
    await assert.rejects(renderRigBuffer(source,rig,{sampleRate:48000}),/requested render sample rate/);
    await assert.rejects(renderRigBuffer(source,rig,{tailSeconds:-1}),/Invalid offline/);
    await assert.rejects(renderRigBuffer(source,rig,{channel:1}),/available input channel/);
    (source as any).duration=181;
    await assert.rejects(renderRigBuffer(source,rig),/180 seconds/);
    (source as any).duration=1;(source as any).samples[4]=NaN;
    await assert.rejects(renderRigBuffer(source,rig),/non-finite/);
    const controller=new AbortController();controller.abort();
    await assert.rejects(renderRigBuffer(source,rig,{signal:controller.signal}),{name:"AbortError"});
    await assert.rejects(renderRigFile({size:0} as File,rig),/20 MiB/);
  }finally{if(previous)Object.defineProperty(globalThis,"AudioBuffer",previous);else Reflect.deleteProperty(globalThis,"AudioBuffer");}
});
