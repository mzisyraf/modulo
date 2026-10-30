// TEST ONLY injected separation/transcription. Actual main UI, audio clock, loops and download links.
async(page)=>{
 const p=await page.context().newPage(),checks=[],errors=[];let requests=0,state='idle',cancelReads=0;
 const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
 p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{window.__tabsMic=0;navigator.mediaDevices.getUserMedia=async()=>{window.__tabsMic++;throw Error('No hardware in tabs test');};const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){this.muted=true;return play.call(this);};});
 const id='11111111-1111-4111-8111-111111111111',wav=Buffer.alloc(44+44100*2*12);
 wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(88200,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
 for(let i=0;i<44100*12;i++)wav.writeInt16LE(Math.round(2500*Math.sin(2*Math.PI*220*i/44100)),44+i*2);
 await p.route('**/api/**',async route=>{
  const request=route.request(),u=new URL(request.url()),path=u.pathname,json=(v,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(v)});
  if(path==='/api/health')return json({status:'ok',separation_available:true,rig_generation_available:false,preset_generation_available:false});
  if(path==='/api/jobs'&&request.method()==='POST')return json({job_id:id,status:'ready'},202);
  if(path.endsWith('/tabs')){
   if(request.method()==='POST'){requests++;state=requests===1?'transcribing':'ready';}
   if(request.method()==='DELETE'){state='cancelled';cancelReads=0;}
   const response={status:state,request_id:id,scope:'whole_song'};
   if(state==='cancelled')response.cancellation_pending=request.method()==='DELETE'||++cancelReads===1;
   if(state==='ready'){
    const tuning=u.searchParams.get('tuning')??'standard',capo=Number(u.searchParams.get('capo')??0),opens=tuning==='drop_d'?[64,59,55,50,45,38]:[64,59,55,50,45,40];
    response.result={version:1,duration_seconds:12,source_sha256:'a'.repeat(64),tuning,capo,quality_flags:['draft_tablature'],notes:[{start_seconds:1,end_seconds:2,midi_pitch:64},{start_seconds:11.2,end_seconds:11.8,midi_pitch:67}].map(n=>{const i=opens.findIndex(pitch=>n.midi_pitch-pitch-capo>=0);return{...n,model_strength:.8,pitch_bend:false,string:i+1,fret:n.midi_pitch-opens[i]-capo,assignment_status:'suggested'};}),provenance:{provider:'modal',model:'spotify/basic-pitch:0.4.0',model_sha256:'2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec',runtime:'onnxruntime-cuda',cuda_kernels:40,elapsed_seconds:1}};
   }return json(response,request.method()==='POST'?202:200);
  }
  if(path.includes('/tabs/files/'))return route.fulfill({contentType:'text/plain',headers:{'Content-Disposition':'attachment; filename="modulo-tabs.txt"'},body:'TEST ONLY tab download'});
  if(path.endsWith('/references'))return json({method:'signal_contrast_v1',duration_seconds:12,options:[],waveforms:{mix:Array(120).fill(.5),guitar:Array(120).fill(.5)}});
  if(path.includes('/audio/')){
   const range=request.headers()['range']?.match(/^bytes=(\d+)-(\d*)$/),start=range?Number(range[1]):0,end=range&&range[2]?Math.min(wav.length-1,Number(range[2])):wav.length-1;
   return route.fulfill({status:range?206:200,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${wav.length}`}:{})},body:wav.subarray(start,end+1)});
  }
  if(path===`/api/jobs/${id}`)return json({job_id:id,status:'ready',stage:'ready',expires_at:Date.now()/1000+1000,backend:'local',result:{duration_seconds:12,sample_rate:44100,artifacts:Object.fromEntries(['mix','guitar','backing'].map(n=>[n,`/api/jobs/${id}/audio/${n}`])),common_gain_linear:1,quality_flags:['synthetic'],provenance:{kind:'local_separation',model:'TEST ONLY',device:'TEST ONLY'},reference:null,reference_revision:0,suggestion:null}});
  return json({error:{message:'TEST ONLY unexpected route'}},404);
 });
 try{
  await p.goto('http://127.0.0.1:5173/?verification=song-tabs');await p.getByRole('button',{name:'Tone Match',exact:true}).click();
  await p.locator('#separation-file').setInputFiles({name:'TEST ONLY.wav',mimeType:'audio/wav',buffer:wav});await p.getByRole('button',{name:'Separate guitar',exact:true}).click();
  await p.getByRole('heading',{name:'Full-song guitar tabs'}).waitFor();check(requests===0,'separation does not automatically spend on transcription');
  await p.getByRole('button',{name:'Generate full-song tabs',exact:true}).click();await p.getByRole('button',{name:'Cancel tab generation',exact:true}).waitFor();
  check(requests===1,'one explicit request starts full-song transcription without a confirmed reference');
  await p.getByRole('button',{name:'Cancel tab generation',exact:true}).click();await p.getByRole('button',{name:'Retry full-song tabs',exact:true}).waitFor();
  await p.getByRole('button',{name:'Reconnect tabs',exact:true}).click();check(requests===1,'cancellation and reconnect do not submit another GPU job');
  await p.getByRole('button',{name:'Retry full-song tabs',exact:true}).click();await p.locator('.tab-note').first().waitFor();check(requests===2,'deliberate retry loads validated full-song notes');
  check(await p.getByRole('link',{name:'Download MIDI',exact:true}).count()===1,'MIDI export is offered alongside text and JSON');
  const download=p.waitForEvent('download');await p.getByRole('link',{name:'Download text tabs',exact:true}).click();const filename=(await download).suggestedFilename();check(Boolean(filename),'text tab link produces a download event');
  await p.getByRole('button',{name:'Next tab window',exact:true}).click();await p.getByRole('button',{name:/String 1 fret 3 at 11.20/}).waitFor();check(true,'the last song window is reachable and includes its note');
  await p.getByRole('button',{name:/String 1 fret 3 at 11.20/}).click();try{await p.waitForFunction(()=>Math.abs(document.querySelector('audio[aria-label="Guitar-reduced backing"]').currentTime-11.2)<.1,{},{timeout:3000});}catch{throw Error('Seek failed: '+JSON.stringify(await p.locator('audio[aria-label="Guitar-reduced backing"]').evaluate(a=>({time:a.currentTime,duration:a.duration,ready:a.readyState,network:a.networkState,ranges:Array.from({length:a.seekable.length},(_,i)=>[a.seekable.start(i),a.seekable.end(i)])}))));}check(true,'clicking a fret seeks the real backing player');
  await p.getByLabel('Tab tuning',{exact:true}).selectOption('drop_d');await p.getByLabel('Tab capo',{exact:true}).fill('2');await p.getByRole('button',{name:/fret 1 at 11.20/}).waitFor();check(requests===2,'tuning and capo reassign notes without GPU requests');
  await p.getByRole('button',{name:'Previous tab window',exact:true}).click();await p.getByRole('button',{name:/at 1.00 seconds/}).click();
  await p.getByRole('button',{name:'Play backing with tabs',exact:true}).click();await p.getByRole('button',{name:'Pause tab playback',exact:true}).waitFor();await p.locator('.tab-note.is-current').waitFor();check(true,'highlighting follows actual audio time');
  await p.getByLabel('Tab playback speed',{exact:true}).selectOption('0.5');check(await p.locator('audio[aria-label="Guitar-reduced backing"]').evaluate(a=>a.playbackRate===.5&&a.preservesPitch),'practice speed uses pitch-preserving native playback');
  await p.getByLabel('Tab loop start',{exact:true}).fill('1');await p.getByLabel('Tab loop end',{exact:true}).fill('2');await p.getByText('Loop practice section',{exact:true}).check();
  await p.locator('audio[aria-label="Guitar-reduced backing"]').evaluate(a=>{a.currentTime=2.1;});await p.waitForFunction(()=>document.querySelector('audio[aria-label="Guitar-reduced backing"]').currentTime<1.8);check(true,'loop wraps the backing clock without a new audio context');
  await p.getByRole('button',{name:'Stop audio',exact:true}).click();await p.getByRole('button',{name:'Play backing with tabs',exact:true}).waitFor();check(await p.locator('audio[aria-label="Guitar-reduced backing"]').evaluate(a=>a.paused),'global Stop stops tab playback');
  await p.setViewportSize({width:390,height:844});check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'full-song tab panel fits390px');
  await p.getByRole('button',{name:'Play backing with tabs',exact:true}).click();await p.getByRole('button',{name:'Recordings',exact:true}).click();
  await p.getByRole('button',{name:'Tone Match',exact:true}).click();check(await p.locator('audio[aria-label="Guitar-reduced backing"]').evaluate(a=>a.paused&&a.playbackRate===1),'navigation stops playback and resets its practice rate');
  check(requests===2,'navigation and restoration do not regenerate tabs');check(await p.evaluate(()=>window.__tabsMic)===0,'tabs never requests microphone access');check(!errors.length,'no runtime page errors');
  return{synthetic:true,checks,requests,errors};
 }finally{await p.close();}
}
