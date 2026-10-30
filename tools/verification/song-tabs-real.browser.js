// REAL full CC BY song -> local CUDA separation -> Modal CUDA tabs. One explicit metered tabs request.
async(page)=>{
 const p=await page.context().newPage(),errors=[],checks=[];let requests=0;
 p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.endsWith('/tabs'))requests++;});
 const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
 await p.addInitScript(()=>{window.__realTabsMic=0;navigator.mediaDevices.getUserMedia=async()=>{window.__realTabsMic++;throw Error('Hardware capture forbidden');};const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){this.muted=true;return play.call(this);};});
 try{
  const source=await(await p.request.get('http://127.0.0.1:5173/src/StartingPresetPanel.tsx')).text(),module=source.match(/import\s*\{\s*AudioEngine\s*\}\s*from\s*["']([^"']+)["']/)?.[1];if(!module)throw Error('Missing engine module');
  const root=module.split('/packages/audio/')[0];
  const retainedResponse=await p.request.get(`http://127.0.0.1:5173${root}/data/tabs/real-browser-job.json`),retained=retainedResponse.ok()?await retainedResponse.json():null;
  if(retained?.source==='Exhilarate CC BY4')await p.route('**/api/jobs',route=>route.request().method()==='POST'?route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({job_id:retained.job_id,status:'ready'})}):route.continue());
  const body=await(await p.request.get(`http://127.0.0.1:5173${root}/data/bench/kevin-macleod-exhilarate/Exhilarate.mp3`)).body();
  await p.goto('http://127.0.0.1:5173/?verification=real-full-song-tabs');await p.getByRole('button',{name:'Tone Match',exact:true}).click();
  await p.locator('#separation-file').setInputFiles({name:'Exhilarate-CC-BY-Kevin-MacLeod.mp3',mimeType:'audio/mpeg',buffer:body});
  await p.getByRole('button',{name:'Separate guitar',exact:true}).click();await p.getByRole('heading',{name:'Compare the same passage'}).waitFor({timeout:180000});
  const jobId=(await p.locator('.job-detail code').innerText()).trim(),job=await(await p.request.get(`http://127.0.0.1:8000/api/jobs/${jobId}`)).json();
  check(job.status==='ready'&&job.result.duration_seconds>140,'actual complete cleared song separated, longer than a tone reference');
  check(requests===0,'separation does not automatically request transcription');
  const cached=await(await p.request.get(`http://127.0.0.1:8000/api/jobs/${jobId}/tabs`)).json();
  if(cached.status!=='ready')await p.getByRole('button',{name:'Generate full-song tabs',exact:true}).click();
  await p.getByRole('link',{name:'Download JSON',exact:true}).waitFor({timeout:300000});
  const response=await p.request.get(`http://127.0.0.1:8000/api/jobs/${jobId}/tabs`),state=await response.json(),r=state.result;
  check(state.status==='ready'&&r.duration_seconds===job.result.duration_seconds,'real Modal result covers full song, independent of reference selection');
  check(r.provenance.runtime==='onnxruntime-cuda'&&r.provenance.cuda_kernels>0,'actual cloud CUDA kernels verified');
  check(r.notes.length>10,'real guitar stem produces note events');
  const midi=await p.request.get(`http://127.0.0.1:8000/api/jobs/${jobId}/tabs/files/mid`),text=await p.request.get(`http://127.0.0.1:8000/api/jobs/${jobId}/tabs/files/txt`);
  check((await midi.body()).subarray(0,4).toString()==='MThd'&&(await text.text()).startsWith('modulo'),'actual MIDI and text exports load');
  await p.getByLabel('Tab tuning',{exact:true}).selectOption('drop_d');await p.getByLabel('Tab capo',{exact:true}).fill('2');
  await p.waitForTimeout(400);await p.getByRole('button',{name:'Reconnect tabs',exact:true}).click();check(requests===(cached.status==='ready'?0:1),'tuning/capo/reconnect reuse one GPU transcription');
  await p.getByRole('button',{name:'Play backing with tabs',exact:true}).click();await p.getByRole('button',{name:'Pause tab playback',exact:true}).waitFor();
  check(await p.locator('audio[aria-label="Guitar-reduced backing"]').evaluate(a=>!a.paused),'real backing plays with full-song tabs');
  await p.getByRole('button',{name:'Stop audio',exact:true}).click();
  await p.getByLabel('Tab song position',{exact:true}).focus();await p.getByLabel('Tab song position',{exact:true}).press('End');
  check(await p.locator('audio[aria-label="Guitar-reduced backing"]').evaluate(a=>a.currentTime>130),'song timeline seeks beyond the selected-passage length');
  await p.setViewportSize({width:390,height:844});check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'real full-song viewer fits390px');
  check(!errors.length&&await p.evaluate(()=>window.__realTabsMic)===0,'no page errors or microphone requests');
  await p.locator('.song-tabs').screenshot({path:decodeURIComponent(root.replace('/@fs/',''))+'/data/tabs/song-tabs-mobile.png'});
  await p.setViewportSize({width:1280,height:1000});await p.locator('.song-tabs').screenshot({path:decodeURIComponent(root.replace('/@fs/',''))+'/data/tabs/song-tabs-desktop.png'});
  return{real:true,reusedExistingJob:Boolean(retained),reusedTranscription:cached.status==='ready',source:'Exhilarate by Kevin MacLeod CC BY4.0; existing local licensed fixture',jobId,checks,requests,duration:r.duration_seconds,notes:r.notes.length,unassigned:r.notes.filter(n=>n.string===null).length,provenance:r.provenance,firstNote:r.notes[0]?.start_seconds,lastNote:r.notes.at(-1)?.start_seconds,errors};
 }finally{await p.close();}
}
