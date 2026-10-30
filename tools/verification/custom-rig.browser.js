// TEST ONLY intercepted API. Actual calibration, offline DSP, rig application and lifecycle.
async (page) => {
  const p = await page.context().newPage(), checks = [], errors = [];
  const sourceCode = await (await p.request.get("http://127.0.0.1:5173/src/StartingPresetPanel.tsx")).text();
  const audioModule = sourceCode.match(/import\s*\{\s*AudioEngine\s*\}\s*from\s*["']([^"']+)["']/)?.[1];
  if (!audioModule) throw Error("Cannot locate the installed engine.");
  const root = audioModule.split("/packages/audio/")[0];
  const hash = (await (await p.request.get(`http://127.0.0.1:5173${root}/contracts/rig-catalog-hash.json`)).text()).match(/[0-9a-f]{64}/)?.[0];
  if (!hash) throw Error("Cannot read the current catalog hash.");
  p.on("pageerror", error => errors.push(error.message));
  const check = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  await p.addInitScript(() => {
    window.__micRequests = 0;
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (...args) => { window.__micRequests++; return capture(...args); };
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination, ...args) {
      if (destination instanceof AudioDestinationNode && !(this.context instanceof OfflineAudioContext)) {
        const mute = this.context.createGain(); mute.gain.value = 0; connect.call(mute, destination); return connect.call(this, mute, ...args);
      }
      return connect.call(this, destination, ...args);
    };
  });
  const id = "11111111-1111-4111-8111-111111111111";
  const wav = Buffer.alloc(44 + 44100 * 2 * 12); wav.write("RIFF"); wav.writeUInt32LE(wav.length-8,4); wav.write("WAVEfmt ",8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(44100,24); wav.writeUInt32LE(88200,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write("data",36); wav.writeUInt32LE(wav.length-44,40);
  for (let i=0;i<44100*12;i++) wav.writeInt16LE(Math.round(3000*Math.sin(i*2*Math.PI*220/44100)),44+i*2);
  let generation, revision = 0, reference = null, receivedSource, requests = 0;
  await p.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const json = (value,status=200) => route.fulfill({status,contentType:"application/json",body:JSON.stringify(value)});
    if (path.endsWith("/tabs") && req.method()==="GET") return json({status:"idle"});
    if (path === "/api/health") return json({status:"ok",mode:"scaffold",separation_available:true,preset_generation_available:false,rig_generation_available:true});
    if (path === "/api/jobs" && req.method()==="POST") return json({job_id:id,status:"ready"},202);
    if (path.endsWith("/reference")) { revision++; reference={start_seconds:0,end_seconds:12,explanation:"TEST ONLY measured passage",quality_flags:["synthetic"]}; generation=undefined; return json(reference); }
    if (path.endsWith("/references")) return json({method:"signal_contrast_v1",duration_seconds:12,options:[],waveforms:{mix:Array(120).fill(.5),guitar:Array(120).fill(.5)}});
    if (path.endsWith("/rig")) {
      requests++; const body=req.postDataJSON(); receivedSource=body.source_calibration;
      generation={request_id:generation?.request_id??crypto.randomUUID(),reference_revision:revision,kind:"rig_proposal",status:"ready",source_calibration:receivedSource,
        target_tone_features:receivedSource.tone_features,target_temporal_features:receivedSource.temporal_features,
        rig_proposal:{proposal:{proposal_version:"1",name:"TEST ONLY individual delay",description:"Fixture for UI verification",tempo_bpm:120,modules:[{model_id:"delay.single_tap",enabled:true,parameters:{time_ms:237,mix:.173}}]},
          provenance:{kind:"generated",provider:"nebius",model:"nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"},catalog_sha256:hash,quality_flags:["measured_spectral_proxy","tone_matching_unverified"]}};
      return json(generation,202);
    }
    if (/\/audio\//.test(path)) return route.fulfill({status:200,contentType:"audio/wav",body:wav});
    if (path===`/api/jobs/${id}`) return json({job_id:id,status:"ready",stage:"ready",expires_at:Date.now()/1000+1000,backend:"local",generation,
      result:{duration_seconds:12,sample_rate:44100,artifacts:Object.fromEntries(["mix","guitar","backing"].map(name=>[name,`/api/jobs/${id}/audio/${name}`])),
        provenance:{kind:"local_separation",model:"TEST ONLY",device:"TEST ONLY"},common_gain_linear:.9,quality_flags:["synthetic"],reference,reference_revision:revision,suggestion:null}});
    return json({error:{message:"TEST ONLY unexpected route"}},404);
  });
  await p.goto("http://127.0.0.1:5173/"); await p.getByRole("button",{name:"Tone Match",exact:true}).click();
  await p.getByRole("button",{name:"Guitar audio",exact:true}).click();
  await p.getByRole("button",{name:"Use supplied dry guitar",exact:true}).click();
  await p.getByText("Guitar audio calibrated",{exact:true}).waitFor();
  check(await p.evaluate(()=>window.__micRequests)===0,"file calibration never requests capture");
  await p.locator("#separation-file").setInputFiles({name:"TEST ONLY.wav",mimeType:"audio/wav",buffer:wav});
  await p.getByRole("button",{name:"Separate guitar",exact:true}).click(); await p.getByRole("heading",{name:"Compare the same passage"}).waitFor();
  await p.getByRole("button",{name:"Manual selection",exact:true}).click(); await p.locator("#reference-end").fill("12"); await p.getByRole("button",{name:"Confirm reference",exact:true}).click();
  await p.getByRole("button",{name:"Generate custom rig",exact:true}).click();
  await p.getByRole("heading",{name:"TEST ONLY individual delay",exact:true}).waitFor();
  check(requests===1 && receivedSource.origin==="file" && receivedSource.temporal_features.method==="envelope_v1","generation receives actual file measurements and timing descriptors");
  check(await p.locator("#amp-title").innerText()!=="TEST ONLY individual delay","generation does not apply itself");
  check(await p.getByRole("button",{name:"Apply custom rig",exact:true}).isDisabled(),"unrendered rig cannot be applied");
  await p.getByRole('button',{name:'Cancel rendering',exact:true}).waitFor();
  check(await p.getByLabel('Refine automatically after generation').isChecked(),'local refinement is enabled by default');
  await p.getByRole('button',{name:'Cancel rendering',exact:true}).click();
  await p.getByRole('button',{name:'Reconnect rig status',exact:true}).click();
  await p.waitForTimeout(1200);
  check(await p.getByRole('button',{name:'Cancel rendering',exact:true}).count()===0,'cancel then reconnect does not restart automatic refinement');
  check(requests===1,'cancelling and reconnecting make no extra model request');
  await p.getByRole('button',{name:'Generate custom rig',exact:true}).click();
  await p.getByText(/Separate-excerpt validation/).waitFor({timeout:240000});
  await p.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Apply custom rig'&&!b.disabled));
  const validationText=await p.getByText(/Separate-excerpt validation/).innerText();
  check(/(Validated refinement retained|original settings retained)/.test(validationText),'explicit cached Generate completes automatic DSP refinement and validation');
  check(Number(validationText.match(/(\d+)\/80 local renders/)?.[1])<=80,'actual browser refinement stays within80 renders including validation');
  check(requests===2,'automatic search and validation make no extra model calls');
  check(await p.locator('#amp-title').innerText()!=="TEST ONLY individual delay",'completed automatic refinement still requires deliberate Apply');
  await p.getByRole("button",{name:"Apply custom rig",exact:true}).click();
  await p.waitForFunction(()=>document.querySelector('#amp-title')?.textContent==='TEST ONLY individual delay');
  check(await p.getByText("AI custom rig · editable",{exact:true}).isVisible(),"actual shared rig has generated provenance");
  check(await p.getByRole("button",{name:"Play dry recording",exact:true}).isEnabled(),"same calibrated file reaches main audition");
  await p.getByRole('button',{name:'Play dry recording',exact:true}).click();
  await p.getByText('Playing local dry recording',{exact:true}).waitFor();
  await p.getByRole('button',{name:'Record',exact:true}).click(); await p.waitForTimeout(1500);
  await p.getByRole('button',{name:'Finish',exact:true}).click();
  await p.getByText('Take saved to Recordings for playback or download.',{exact:true}).waitFor();
  await p.getByRole('button',{name:'Stop audio',exact:true}).click();
  await p.getByRole('button',{name:'Recordings',exact:true}).click();
  const take=await p.locator('.recording-card audio').evaluate(async element=>{
    const buffer=await new OfflineAudioContext(1,1,44100).decodeAudioData(await(await fetch(element.src)).arrayBuffer());
    let energy=0; for(const x of buffer.getChannelData(0)){if(!Number.isFinite(x))throw Error('Nonfinite recorded sample');energy+=x*x;}
    return {duration:buffer.duration,rms:Math.sqrt(energy/buffer.length)};
  });
  check(take.duration>1&&take.rms>1e-6,'automatically refined rig records finite non-silent processed audio from the calibrated file');
  await p.getByRole('button',{name:'Tone Match',exact:true}).click();
  await p.getByRole('button',{name:'Restore original proposal',exact:true}).click();
  check(await p.getByRole('button',{name:'Apply custom rig',exact:true}).isDisabled(),'restoring original requires a fresh render check before apply');
  await p.getByRole('button',{name:'Reconnect rig status',exact:true}).click();
  await p.waitForTimeout(1200);
  check(await p.getByRole('button',{name:'Cancel rendering',exact:true}).count()===0,'restore and reconnect do not schedule another refinement');
  await p.getByLabel('Refine automatically after generation').uncheck();
  await p.getByRole('button',{name:'Generate custom rig',exact:true}).click();
  await p.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Check custom rig'&&!b.disabled));
  check(await p.getByRole('button',{name:'Cancel rendering',exact:true}).count()===0,'opt-out preserves manual workflow for explicit cached Generate');
  await p.getByRole('button',{name:'Check custom rig',exact:true}).click();
  await p.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Apply custom rig'&&!b.disabled));
  check(requests===3,'manual check makes no model request after opt-out');
  await p.setViewportSize({width:390,height:844});
  check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"narrow main flow has no document overflow");
  await p.getByRole("button",{name:"Live guitar",exact:true}).click();
  check(await p.getByRole("heading",{name:"TEST ONLY individual delay",exact:true}).count()===0,"changing source removes stale proposal");
  check(await p.locator('#amp-title').innerText()!=="TEST ONLY individual delay","changing source invalidates applied generated rig");
  check(await p.evaluate(()=>window.__micRequests)===0,"source toggle does not start live capture");
  check(errors.length===0,"no page errors");
  await p.unroute("**/api/**"); await p.close(); return {synthetic:true,checks,requests,take,errors};
}
