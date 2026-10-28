import assert from "node:assert/strict";
import {test} from "node:test";
import {matchedListeningLevels} from "../src/listeningLevels.ts";
test("quiet dry and loud processed listening get the same conservative RMS without changing tone",()=>{
 const a={rms:.001,peak:.01},b={rms:.1,peak:.3};
 const gain=matchedListeningLevels(a,b);
 assert.ok(Math.abs(a.rms*10**(gain.originalDb/20)-b.rms*10**(gain.processedDb/20))<1e-12);
 assert.ok(a.peak*10**(gain.originalDb/20)<=.5+1e-12&&b.peak*10**(gain.processedDb/20)<=.5+1e-12);
 assert.ok(gain.rmsDbfs<=-24);
 assert.throws(()=>matchedListeningLevels({rms:0,peak:0},b));
});
