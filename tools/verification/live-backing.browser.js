// TEST ONLY intercepted separation and synthetic instrument stream. Actual engine,
// native HTML backing playback and processed recording. No model/GPU/hardware calls.
async (page) => {
  const p=await page.context().newPage(), checks=[], errors=[];
  const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(()=>{
    window.__inputTracks=[];window.__captures=0;window.__holdInput=false;window.__stopReasons=[];
    const Native=window.AudioContext, connect=AudioNode.prototype.connect;
    AudioNode.prototype.connect=function(destination,...args){
      if(destination instanceof AudioDestinationNode&&!(this.context instanceof OfflineAudioContext)){
        const mute=this.context.createGain();mute.gain.value=0;connect.call(mute,destination);return connect.call(this,mute,...args);
      }
      return connect.call(this,destination,...args);
    };
    Object.defineProperty(navigator,'mediaDevices',{value:Object.assign(new EventTarget(),{
      enumerateDevices:async()=>[{kind:'audioinput',deviceId:'test-instrument',label:'TEST ONLY instrument',groupId:'test'}],
      getUserMedia:async()=>{
        window.__captures++;
        if(window.__holdInput)await new Promise(resolve=>window.__releaseInput=resolve);
        const context=new Native(),source=context.createOscillator(),gain=context.createGain(),output=context.createMediaStreamDestination();
        source.frequency.value=220;gain.gain.value=.1;source.connect(gain).connect(output);source.start();
        const track=output.stream.getAudioTracks()[0],stop=track.stop.bind(track);let stopped=false;
        track.stop=()=>{if(stopped)return;stopped=true;window.__stopReasons.push(new Error('TEST ONLY track stop').stack);stop();void context.close();};track.getSettings=()=>({channelCount:2,sampleRate:context.sampleRate});
        window.__inputTracks.push(track);return output.stream;
      }
    })});
  });
  const wav=Buffer.alloc(44+44100*2*12);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(88200,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  for(let i=0;i<44100*12;i++)wav.writeInt16LE(Math.round(3000*Math.sin(i*2*Math.PI*1000/44100)),44+i*2);
  const id='11111111-1111-4111-8111-111111111111';
  await p.route('**/api/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    const json=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
    if(path==='/api/health')return json({status:'ok',mode:'scaffold',separation_available:true,preset_generation_available:false,rig_generation_available:false});
    if(path==='/api/jobs'&&request.method()==='POST')return json({job_id:id,status:'ready'},202);
    if(path.endsWith('/references'))return json({method:'signal_contrast_v1',duration_seconds:12,options:[],waveforms:{mix:Array(120).fill(.5),guitar:Array(120).fill(.5)}});
    if(path.includes('/audio/'))return route.fulfill({contentType:'audio/wav',body:wav});
    if(path===`/api/jobs/${id}`)return json({job_id:id,status:'ready',stage:'ready',expires_at:Date.now()/1000+1000,backend:'local',result:{duration_seconds:12,sample_rate:44100,artifacts:Object.fromEntries(['mix','guitar','backing'].map(n=>[n,`/api/jobs/${id}/audio/${n}`])),common_gain_linear:1,quality_flags:['synthetic'],provenance:{kind:'local_separation',model:'TEST ONLY',device:'TEST ONLY'},reference:null,reference_revision:0,suggestion:null}});
    return json({error:{message:'TEST ONLY unexpected route'}},404);
  });
  const backing=p.locator('audio[aria-label="Guitar-reduced backing"]');
  const playing=async()=>backing.evaluate(a=>!a.paused&&a.currentTime>0);
  const live=async()=>(await p.locator('.live-status.live').count())===1;
  const released=async()=>p.evaluate(()=>window.__inputTracks.every(t=>t.readyState==='ended'));
  const startLive=async()=>{await p.getByRole('button',{name:'Start live input',exact:true}).click();await p.locator('.live-status.live').waitFor();};
  const startBacking=async()=>{await p.getByRole('button',{name:'Play backing passage',exact:true}).click();await p.waitForFunction(()=>{const a=document.querySelector('audio[aria-label="Guitar-reduced backing"]');return a&&!a.paused&&a.currentTime>0;});};
  try{
    await p.goto('http://127.0.0.1:5173/?verification=live-backing');
    await p.getByRole('button',{name:'Tone Match',exact:true}).click();
    await p.locator('#separation-file').setInputFiles({name:'TEST ONLY.wav',mimeType:'audio/wav',buffer:wav});
    await p.getByRole('button',{name:'Separate guitar',exact:true}).click();
    await p.getByRole('heading',{name:'Compare the same passage'}).waitFor();
    await startLive();
    await p.getByRole('button',{name:'Record',exact:true}).click();
    await startBacking();
    if(!await live()||await released())throw Error('backing stopped live monitoring: '+JSON.stringify(await p.evaluate(()=>({status:document.querySelector('.live-status')?.textContent,stops:window.__stopReasons}))));
    check(true,'backing preserves the active live input track');
    check(await p.getByRole('button',{name:'Finish',exact:true}).isEnabled(),'backing start keeps the processed-guitar take recording');
    const captures=await p.evaluate(()=>window.__captures);
    await backing.evaluate(a=>a.pause());
    check(await live(),'pausing backing leaves explicit live monitoring active');
    await startBacking();
    check(await p.evaluate(()=>window.__captures)===captures,'backing restart neither recaptures input nor asks permission again');
    await p.waitForTimeout(1500);
    await p.getByRole('button',{name:'Finish',exact:true}).click();
    await p.getByText('Take saved to Recordings for playback or download.',{exact:true}).waitFor();
    await p.getByRole('button',{name:'Stop audio',exact:true}).click();
    check(await released()&&!await playing(),'global Stop releases live input and backing');

    await startBacking();await startLive();
    check(await playing()&&await live(),'starting live input preserves already-playing backing');
    await p.locator('audio[aria-label="Original mix"]').evaluate(async a=>{a.muted=true;await a.play();});
    check(await released()&&!await live()&&!await playing(),'original-mix preview still takes exclusive output and releases live capture');
    await startLive();
    await p.locator('audio[aria-label="Extracted guitar"]').evaluate(async a=>{a.muted=true;await a.play();});
    check(await released()&&!await live(),'extracted-guitar preview still releases live capture');

    await startBacking();
    await p.getByRole('button',{name:'Play test signal',exact:true}).click();
    await p.getByText('Playing synthetic test signal',{exact:true}).waitFor();
    check(!await playing(),'sample/test-signal audition remains exclusive with backing');
    await startBacking();
    check(await p.getByText('Stopped',{exact:true}).count()>0,'backing still stops the sample audition');
    await p.getByRole('button',{name:'Stop audio',exact:true}).click();

    await p.evaluate(()=>{window.__holdInput=true;});
    await p.getByRole('button',{name:'Start live input',exact:true}).click();
    await p.waitForFunction(()=>Boolean(window.__releaseInput));
    await p.getByRole('button',{name:'Stop audio',exact:true}).click();
    await p.evaluate(()=>{window.__holdInput=false;window.__releaseInput();});
    await p.waitForFunction(()=>window.__inputTracks.length===4&&window.__inputTracks.every(t=>t.readyState==='ended'));
    check(!await live(),'late input permission cannot revive stopped monitoring');

    await startLive();await startBacking();
    await p.getByRole('button',{name:'Recordings',exact:true}).click();
    check(await released(),'navigation releases the simultaneous live source');
    const take=await p.locator('.recording-card audio').evaluate(async a=>{
      const buffer=await new OfflineAudioContext(1,1,44100).decodeAudioData(await(await fetch(a.src)).arrayBuffer()),samples=buffer.getChannelData(0);
      let energy=0;for(const x of samples){if(!Number.isFinite(x))throw Error('Nonfinite recording');energy+=x*x;}
      const magnitude=f=>{let re=0,im=0;for(let i=0;i<samples.length;i++){const angle=2*Math.PI*f*i/buffer.sampleRate;re+=samples[i]*Math.cos(angle);im+=samples[i]*Math.sin(angle);}return Math.hypot(re,im)/samples.length;};
      return {duration:buffer.duration,rms:Math.sqrt(energy/samples.length),guitar220:magnitude(220),backing1000:magnitude(1000)};
    });
    check(take.duration>1&&take.rms>1e-6&&take.guitar220>take.backing1000*10,'saved take contains finite processed guitar rather than the backing mix');
    await p.getByRole('button',{name:'Tone Match',exact:true}).click();
    check(!await playing()&&!await live(),'returning after navigation cannot restart backing or live input');
    await startLive();
    await p.evaluate(()=>{const t=window.__inputTracks.at(-1);t.stop();t.dispatchEvent(new Event('ended'));});
    await p.waitForFunction(()=>!document.querySelector('.live-status.live'));
    check(await released(),'synthetic input-ended event releases monitoring');
    check(errors.length===0,'no runtime page errors: '+errors.join('; '));
    return {synthetic:true,checks,take,errors};
  }finally{await p.close();}
}
