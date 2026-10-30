// TEST ONLY API + synthetic interface/camera. Real calibration, refinement, rig and recording.
async (page) => {
  const p = await page.context().newPage(), checks = [], errors = [];
  const check = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  p.on('pageerror', error => errors.push(error.message));
  const source = await (await p.request.get('http://127.0.0.1:5173/src/GuitarCalibrationPanel.tsx')).text();
  const audioPath = source.match(/from\s*["']([^"']+\/packages\/audio\/src\/index.ts[^"']*)["']/)?.[1];
  if (!audioPath) throw Error('Cannot locate current engine.');
  const root = audioPath.split('/packages/audio/')[0];
  const hash = (await (await p.request.get(`http://127.0.0.1:5173${root}/contracts/rig-catalog-hash.json`)).json()).sha256;
  const id = '11111111-1111-4111-8111-111111111111', rate = 44100, seconds = 12;
  const wav = Buffer.alloc(44 + rate * 2 * seconds);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < rate * seconds; i++) wav.writeInt16LE(Math.round(3000 * Math.sin(i * Math.PI * 440 / rate)), 44 + i * 2);
  let generation, reference = null, revision = 0, requests = 0, uploads = 0, tabsRequests = 0;
  await p.addInitScript(() => {
    window.testTracks = []; window.testCapture = []; window.testCaptureMode = 'tone';
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...args) {
      if (destination instanceof AudioDestinationNode && !(this.context instanceof OfflineAudioContext)) {
        const mute = this.context.createGain(); mute.gain.value = 0; connect.call(mute, destination); return connect.call(this, mute, ...args);
      }
      return connect.call(this, destination, ...args);
    };
    Object.defineProperty(navigator, 'mediaDevices', { value: Object.assign(new EventTarget(), {
      enumerateDevices: async () => [{kind:'audioinput',deviceId:'synthetic-interface',label:'TEST ONLY interface',groupId:'test'}],
      getUserMedia: async constraints => {
        window.testCapture.push(constraints);
        if (window.testCaptureMode === 'pending') await new Promise(resolve => { window.releaseCapture = resolve; });
        if (window.testCaptureMode === 'denied') throw new DOMException('TEST ONLY denial','NotAllowedError');
        if (constraints.video) {
          const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
          const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffd21f'; ctx.fillRect(0,0,320,240);
          const stream = canvas.captureStream(10); window.testTracks.push(...stream.getTracks()); return stream;
        }
        const context = new AudioContext(), oscillator = context.createOscillator(), gain = context.createGain(), output = context.createMediaStreamDestination();
        oscillator.frequency.value = 220; gain.gain.value = .15; oscillator.connect(gain).connect(output); oscillator.start();
        const track = output.stream.getAudioTracks()[0], stop = track.stop.bind(track);
        track.stop = () => { stop(); void context.close(); };
        track.getSettings = () => ({channelCount:2,sampleRate:context.sampleRate});
        window.testTracks.push(track); return output.stream;
      }
    })});
  });
  await p.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const json = (value, status = 200) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
    if (path === '/api/health') return json({status:'ok',mode:'scaffold',separation_available:true,rig_generation_available:true});
    if (path === '/api/jobs' && req.method() === 'POST') {
      check(req.headers()['x-separation-backend'] === 'modal','upload explicitly chooses cloud worker'); uploads++; return json({job_id:id},202);
    }
    if (path.endsWith('/tabs')) { if(req.method()==='POST')tabsRequests++;return json({status:'idle'}); }
    if (path.endsWith('/reference')) { reference={...req.postDataJSON(),explanation:'TEST ONLY',quality_flags:['synthetic']}; revision++; generation=undefined; return json(reference); }
    if (path.endsWith('/references')) return json({method:'signal_contrast_v1',duration_seconds:seconds,options:[],waveforms:{mix:Array(120).fill(.5),guitar:Array(120).fill(.5)}});
    if (path.endsWith('/rig')) {
      requests++; const calibration = req.postDataJSON().source_calibration;
      check(calibration.origin === 'live','generation uses live calibration descriptors');
      generation={request_id:crypto.randomUUID(),reference_revision:revision,kind:'rig_proposal',status:'ready',source_calibration:calibration,target_tone_features:calibration.tone_features,target_temporal_features:calibration.temporal_features,
        rig_proposal:{proposal:{proposal_version:'1',name:'TEST ONLY matched tone',description:'Controlled UI fixture',tempo_bpm:120,modules:[{model_id:'delay.single_tap',enabled:true,parameters:{time_ms:237,mix:.173}}]},provenance:{kind:'generated',provider:'nebius',model:'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B'},catalog_sha256:hash,quality_flags:['tone_matching_unverified']}};
      return json(generation,202);
    }
    if (path.includes('/audio/')) {
      const range = req.headers().range?.match(/bytes=(\d+)-(\d*)/);
      if (range) {const first=Number(range[1]),last=range[2]?Math.min(Number(range[2]),wav.length-1):wav.length-1;return route.fulfill({status:206,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes','Content-Range':`bytes ${first}-${last}/${wav.length}`},body:wav.subarray(first,last+1)});}
      return route.fulfill({contentType:'audio/wav',headers:{'Accept-Ranges':'bytes'},body:wav});
    }
    if (path === `/api/jobs/${id}`) return json({job_id:id,status:'ready',stage:'ready',expires_at:Date.now()/1000+1000,backend:'modal',generation,result:{duration_seconds:seconds,sample_rate:rate,artifacts:Object.fromEntries(['mix','guitar','backing'].map(name=>[name,`/api/jobs/${id}/audio/${name}`])),provenance:{kind:'cloud_separation',provider:'modal',model:'TEST ONLY',device:'TEST ONLY'},common_gain_linear:.9,quality_flags:['synthetic'],reference,reference_revision:revision,suggestion:null}});
    return json({error:{message:'TEST ONLY unexpected route'}},404);
  });
  try {
    await p.goto('http://127.0.0.1:5173/?verification=guided-flow');
    await p.getByRole('button',{name:/New Tone Match/}).click();
    const stages=p.getByRole('navigation',{name:'Tone match stages'});
    check(await stages.getByRole('button').count()===4,'four guided stages');
    check(await p.getByRole('button',{name:'Guitar audio',exact:true}).count()===0 && await p.locator('#calibration-file,#dry-file').count()===0,'file calibration and dry audition removed');
    check(await p.getByRole('button',{name:'Settings',exact:true}).count()===0,'placeholder navigation removed');
    check(await p.evaluate(()=>window.testCapture.length)===0,'opening flow never captures input');
    await p.getByRole('button',{name:'Calibrate live guitar',exact:true}).click();
    await p.getByText('Live guitar calibrated',{exact:true}).waitFor({timeout:20000});
    check(await p.evaluate(()=>window.testTracks.every(t=>t.readyState==='ended')),'ten-second calibration releases capture');
    await p.getByRole('button',{name:'Choose a song →',exact:true}).click();
    await p.locator('#separation-file').setInputFiles({name:'TEST ONLY.wav',mimeType:'audio/wav',buffer:wav});
    check(uploads===0,'selecting song does not start inference');
    await p.getByRole('button',{name:'Prepare song',exact:true}).click();
    await p.getByRole('heading',{name:'Choose the sound to match',exact:true}).waitFor();
    check(await p.locator('.song-player audio:visible').count()===1,'one visible song player');
    await p.getByRole('button',{name:'Manual selection',exact:true}).click();
    await p.locator('#reference-end').fill('12');
    await p.getByRole('button',{name:'Use this sound',exact:true}).click();
    await p.getByRole('heading',{name:'Make that sound yours',exact:true}).waitFor();
    check(requests===0,'reference confirmation never generates tone');
    await p.getByRole('button',{name:'Clear Rig',exact:true}).click();
    await p.getByRole('dialog').getByRole('button',{name:'Clear Rig',exact:true}).click();
    await p.getByRole('button',{name:'Undo',exact:true}).click({timeout:4000});
    check(await p.locator('.model-rig-card').count()>2,'mouse Undo restores visual chain');
    await p.getByRole('button',{name:'Match tone',exact:true}).click();
    await p.getByRole('button',{name:'Cancel matching',exact:true}).waitFor();
    check(await p.getByRole('button',{name:'Use this tone',exact:true}).isDisabled(),'unverified suggestion cannot apply');
    await p.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Use this tone'&&!b.disabled),{timeout:180000});
    check(requests===1 && await p.evaluate(()=>window.testCapture.length)===1,'real refinement finishes without extra model request or capture');
    await p.getByRole('button',{name:'Use this tone',exact:true}).click();
    await p.getByRole('button',{name:'Start playing',exact:true}).waitFor();
    check(await p.getByRole('heading',{name:'Build your signal chain.',exact:true}).isVisible(),'signal chain remains prominently visible');
    await p.screenshot({path:'data/verification/guided-flow-desktop.png',fullPage:true});
    await p.getByRole('button',{name:'Start playing',exact:true}).click();
    await p.getByRole('button',{name:'Playing live',exact:true}).waitFor();
    await p.getByText('Recording options',{exact:true}).click();
    await p.getByRole('switch',{name:/3-second countdown/}).uncheck();
    await p.getByRole('button',{name:'Record',exact:true}).click();
    await p.getByRole('button',{name:'Finish',exact:true}).waitFor(); await p.waitForTimeout(1400);
    await p.getByRole('button',{name:'Finish',exact:true}).click();
    await p.getByText('Take saved to Recordings for playback or download.',{exact:true}).waitFor();
    await p.getByRole('button',{name:'Recordings',exact:true}).click();
    const take=await p.locator('.recording-card audio').first().evaluate(async el=>{const b=await new OfflineAudioContext(1,1,44100).decodeAudioData(await(await fetch(el.src)).arrayBuffer());let power=0;for(const x of b.getChannelData(0)){if(!Number.isFinite(x))throw Error('Nonfinite recording');power+=x*x;}return {seconds:b.duration,rms:Math.sqrt(power/b.length)};});
    check(take.seconds>1&&take.rms>1e-6,'live processed recording decodes finite non-silent audio');
    await p.getByRole('button',{name:'Tone Match',exact:true}).click();
    await p.getByRole('button',{name:'Start playing',exact:true}).click();
    await p.getByRole('button',{name:'Playing live',exact:true}).waitFor();
    await p.getByRole('button',{name:'Guitar + backing',exact:true}).click();
    await p.getByRole('switch',{name:/Include camera/}).check();
    await p.getByRole('button',{name:'Start camera performance',exact:true}).waitFor({state:'visible'});
    await p.getByRole('button',{name:'Start camera performance',exact:true}).click();
    await p.getByRole('button',{name:'Finish',exact:true}).waitFor();await p.waitForTimeout(1300);
    await p.getByRole('button',{name:'Finish',exact:true}).click();
    await p.getByText('Camera performance saved to Recordings for playback or download.',{exact:true}).waitFor();
    await p.getByRole('button',{name:'Stop all',exact:true}).click();
    check(await p.evaluate(()=>window.testTracks.every(t=>t.readyState==='ended')),'Stop all releases guitar and camera');
    check(tabsRequests===0,'tabs never generate automatically');
    await p.getByText('Practice with full-song tabs',{exact:true}).click();
    check(await p.getByRole('button',{name:'Generate full-song tabs',exact:true}).isVisible(),'full-song tabs remain available');
    await p.getByRole('button',{name:'Recordings',exact:true}).click();
    check(await p.locator('.recording-card video').count()===1 && await p.getByRole('link',{name:'Guitar master',exact:true}).count()===1,'mixed camera take retains a guitar master');
    await p.getByRole('button',{name:'Tone Match',exact:true}).click();
    await p.setViewportSize({width:390,height:844});
    for(const label of ['Connect','Choose sound','Match tone','Play & record']) {
      await stages.getByRole('button',{name:new RegExp(label.replace('&','\\&'))}).click();
      check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${label} fits mobile width`);
    }
    await p.screenshot({path:'data/verification/guided-flow-mobile.png',fullPage:true});
    await stages.getByRole('button',{name:/Connect/}).click();
    await p.locator('#calibration-channel').click();
    await p.locator('#calibration-channel-options').getByRole('button',{name:'Input 2',exact:true}).click();
    await stages.getByRole('button',{name:/Play & record/}).click();
    check(await p.getByRole('button',{name:'Start playing',exact:true}).isDisabled(),'channel change invalidates calibration and stale tone');
    check(errors.length===0,errors.join('; ')||'no runtime page errors');
    return {passed:true,checks,take,requests,uploads,tabsRequests};
  } finally { await p.close(); }
}
