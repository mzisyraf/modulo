import test from "node:test";
import assert from "node:assert/strict";
import { spectrum } from "../src/audioFeatures.ts";

test("FFT matches a direct transform across cached sizes and changing input", () => {
  for (const size of [8, 16, 8, 32, 16]) for (const phase of [0, .37]) {
    const values=Float64Array.from({length:size},(_,i)=>Math.sin(i*.43+phase)+.2*Math.cos(i*1.23));
    const before=values.slice(),actual=spectrum(values);
    for(let k=0;k<actual.length;k++){
      let re=0,im=0;for(let i=0;i<size;i++){re+=values[i]*Math.cos(-2*Math.PI*k*i/size);im+=values[i]*Math.sin(-2*Math.PI*k*i/size);}
      assert.ok(Math.abs(actual[k]-Math.hypot(re,im)/size)<1e-12);
    }
    assert.deepEqual(values,before);
  }
});
