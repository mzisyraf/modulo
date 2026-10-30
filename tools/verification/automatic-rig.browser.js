// TEST ONLY: intercepted API and controlled async renderer. Tests scheduling/failure UI,
// not tone quality. custom-rig.browser.js separately executes the actual production DSP.
async (page) => {
  const checks = [], errors = [];
  const check = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  const code = await (await page.request.get('http://127.0.0.1:5173/src/StartingPresetPanel.tsx')).text();
  const root = code.match(/import\s*\{\s*AudioEngine\s*\}\s*from\s*["']([^"']+)["']/)?.[1]?.split('/packages/audio/')[0];
  if (!root) throw Error('Cannot locate the installed catalog.');
  const hash = (await (await page.request.get(`http://127.0.0.1:5173${root}/contracts/rig-catalog-hash.json`)).json()).sha256;
  const wav = seconds => {
    const b = Buffer.alloc(44 + 44100 * 2 * seconds);
    b.write('RIFF'); b.writeUInt32LE(b.length-8,4); b.write('WAVEfmt ',8); b.writeUInt32LE(16,16); b.writeUInt16LE(1,20); b.writeUInt16LE(1,22);
    b.writeUInt32LE(44100,24); b.writeUInt32LE(88200,28); b.writeUInt16LE(2,32); b.writeUInt16LE(16,34); b.write('data',36); b.writeUInt32LE(b.length-44,40);
    for (let i=0;i<44100*seconds;i++) b.writeInt16LE(Math.round(3000*Math.sin(i*2*Math.PI*220/44100)),44+i*2);
    return b;
  };
  async function open(seconds = 12) {
    const p = await page.context().newPage(), audio = wav(seconds), song = wav(12);
    let generation, source, revision = 0, reference = null, requests = 0, queued = false;
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(() => {
      window.__refinements = 0; window.__scores = 0; window.__aborts = 0; window.__mic = 0;
      navigator.mediaDevices.getUserMedia = async () => { window.__mic++; throw Error('Hardware capture forbidden in this test'); };
    });
    await p.route('**/src/refineRig.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
      export const neutralRigProposal = () => ({});
      export async function scoreRig() {
        window.__scores++;
        if(window.__failScore) throw Error('TEST ONLY final score failure');
        return {loss:.1,safe:true,peak:.1,guardFraction:0,rmsDbfs:-24};
      }
      export async function refineRig(file,proposal,gain,target,options) {
        window.__refinements++; options.progress(1);
        await new Promise((resolve,reject) => {
          window.__finishRefinement = resolve;
          options.signal.addEventListener('abort', () => {window.__aborts++;reject(new DOMException('Cancelled','AbortError'));},{once:true});
        });
        return {proposal:{...proposal,name:'TEST ONLY refined'},outputLevelDb:-20,before:1,after:.1,validationBefore:1,validationAfter:.1,renders:4,retained:true};
      }` }));
    await p.route('**/audio/guitar-techs-dry-di.wav', route => route.fulfill({ contentType:'audio/wav', body:audio }));
    await p.route('**/api/**', route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      const json = (value,status=200) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
      if(path==='/api/health')return json({status:'ok',mode:'scaffold',separation_available:true,rig_generation_available:true,preset_generation_available:false});
      if(path==='/api/jobs'&&req.method()==='POST')return json({job_id:'11111111-1111-4111-8111-111111111111',status:'ready'},202);
      if(path.endsWith('/reference')) {revision++;reference={start_seconds:0,end_seconds:12,explanation:'TEST ONLY',quality_flags:['synthetic']};generation=undefined;return json(reference);}
      if(path.endsWith('/references'))return json({method:'signal_contrast_v1',duration_seconds:12,options:[],waveforms:{mix:Array(120).fill(.5),guitar:Array(120).fill(.5)}});
      if(path.endsWith('/rig')) {
        requests++;source=req.postDataJSON().source_calibration;
        generation={request_id:generation?.request_id??crypto.randomUUID(),reference_revision:revision,kind:'rig_proposal',status:queued?'generating':'ready',source_calibration:source};
        if(!queued)ready();
        return json(generation,202);
      }
      if(path.includes('/audio/'))return route.fulfill({contentType:'audio/wav',body:song});
      if(path==='/api/jobs/11111111-1111-4111-8111-111111111111')return json({job_id:'11111111-1111-4111-8111-111111111111',status:'ready',stage:'ready',backend:'local',expires_at:Date.now()/1000+1000,generation,
        result:{duration_seconds:12,sample_rate:44100,artifacts:Object.fromEntries(['mix','guitar','backing'].map(n=>[n,`/api/jobs/11111111-1111-4111-8111-111111111111/audio/${n}`])),common_gain_linear:.9,quality_flags:['synthetic'],provenance:{kind:'local_separation',model:'TEST ONLY',device:'TEST ONLY'},reference,reference_revision:revision,suggestion:null}});
      return json({error:{message:'TEST ONLY unexpected route'}},404);
    });
    function ready() {
      generation={...generation,status:'ready',target_tone_features:source.tone_features,target_temporal_features:source.temporal_features,
        rig_proposal:{proposal:{proposal_version:'1',name:'TEST ONLY original',description:'TEST ONLY scheduler fixture',tempo_bpm:120,modules:[{model_id:'delay.single_tap',enabled:true,parameters:{time_ms:237,mix:.173}}]},
          provenance:{kind:'generated',provider:'nebius',model:'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B'},catalog_sha256:hash,quality_flags:['tone_matching_unverified']}};
    }
    await p.goto('http://127.0.0.1:5173/?verification=automatic-rig');
    await p.getByRole('button',{name:'Tone Match',exact:true}).click();
    await p.getByRole('button',{name:'Guitar audio',exact:true}).click();
    await p.getByRole('button',{name:'Use supplied dry guitar',exact:true}).click();
    await p.getByText('Guitar audio calibrated',{exact:true}).waitFor();
    await p.locator('#separation-file').setInputFiles({name:'TEST ONLY.wav',mimeType:'audio/wav',buffer:song});
    await p.getByRole('button',{name:'Separate guitar',exact:true}).click();
    await p.getByRole('heading',{name:'Compare the same passage'}).waitFor();
    await p.getByRole('button',{name:'Manual selection',exact:true}).click();
    await p.locator('#reference-end').fill('12');
    await p.getByRole('button',{name:'Confirm reference',exact:true}).click();
    await p.getByRole('button',{name:'Generate custom rig',exact:true}).waitFor();
    return {p,ready,queue:()=>queued=true,requests:()=>requests};
  }
  const generate = p => p.getByRole('button',{name:'Generate custom rig',exact:true}).click();
  const started = p => p.getByRole('button',{name:'Cancel rendering',exact:true}).waitFor();
  const finish = async p => {await p.evaluate(()=>window.__finishRefinement());await p.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Apply custom rig'&&!b.disabled));};
  const reconnect = async p => {await p.getByRole('button',{name:'Reconnect rig status',exact:true}).click();await p.waitForTimeout(250);};
  const idle = p => p.getByRole('button',{name:'Cancel rendering',exact:true}).count();

  let f = await open();
  try {
    f.queue();await generate(f.p);await f.p.getByText('Generating individual gear settings…',{exact:true}).waitFor();
    check(await f.p.evaluate(()=>window.__refinements)===0,'generating response waits without rendering');
    f.ready();await reconnect(f.p);await started(f.p);
    check(await f.p.getByRole('button',{name:'Apply custom rig',exact:true}).isDisabled(),'automatic rendering blocks Apply');
    await finish(f.p);await reconnect(f.p);
    check(await f.p.evaluate(()=>window.__refinements)===1&&f.requests()===1,'queued ready result refines exactly once without extra model requests');
    check(await f.p.locator('#amp-title').innerText()!=='TEST ONLY refined'&&await f.p.evaluate(()=>window.__mic)===0,'automatic completion neither applies nor captures input');
    await f.p.getByRole('button',{name:'Restore original proposal',exact:true}).click();await reconnect(f.p);
    check(await f.p.evaluate(()=>window.__refinements)===1&&await f.p.getByRole('button',{name:'Apply custom rig',exact:true}).isDisabled(),'restore clears safety check and cannot restart automation');
  } finally {await f.p.close();}

  f=await open();
  try {
    await generate(f.p);await started(f.p);await f.p.getByRole('button',{name:'Cancel rendering',exact:true}).click();await reconnect(f.p);
    check(await idle(f.p)===0&&await f.p.evaluate(()=>window.__refinements===1&&window.__aborts===1),'cancel aborts renderer and reconnect cannot retry it');
    await generate(f.p);await started(f.p);
    check(await f.p.evaluate(()=>window.__refinements)===2,'explicit cached Generate authorizes one fresh local attempt');
    await f.p.getByRole('button',{name:'Recordings',exact:true}).click();await f.p.getByRole('button',{name:'Tone Match',exact:true}).click();await reconnect(f.p);
    check(await idle(f.p)===0&&await f.p.evaluate(()=>window.__refinements===2&&window.__aborts===2),'navigation cancels pending work without resume loops');
    await generate(f.p);await started(f.p);
    await f.p.getByRole('button',{name:'Live guitar',exact:true}).click();
    await f.p.evaluate(()=>window.__finishRefinement());await f.p.waitForTimeout(100);
    check(await f.p.locator('#custom-rig-title').evaluate(node=>!node.closest('section').querySelector('h3'))&&await f.p.evaluate(()=>window.__mic===0),'source change discards late renderer result without starting capture');
  } finally {await f.p.close();}

  f=await open();
  try {
    await f.p.getByLabel('Refine automatically after generation').uncheck();await generate(f.p);
    await f.p.getByRole('heading',{name:'TEST ONLY original',exact:true}).waitFor();await reconnect(f.p);
    check(await f.p.evaluate(()=>window.__refinements===0&&window.__scores===0),'opt-out leaves original unrendered for manual review');
    await f.p.getByRole('button',{name:'Check custom rig',exact:true}).click();
    await f.p.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Apply custom rig'&&!b.disabled));
    check(await f.p.evaluate(()=>window.__scores===2)&&f.requests()===1,'manual check works with automatic refinement off');
    await f.p.getByLabel('Refine automatically after generation').check();await generate(f.p);await started(f.p);
    await f.p.evaluate(()=>{window.__failScore=true;window.__finishRefinement();});
    await f.p.getByRole('alert').filter({hasText:'Local refinement failed'}).waitFor();await reconnect(f.p);
    check(await f.p.getByRole('heading',{name:'TEST ONLY original',exact:true}).isVisible()&&await f.p.getByRole('button',{name:'Apply custom rig',exact:true}).isDisabled(),'final-score error preserves original and cannot certify refined settings');
    check(await f.p.evaluate(()=>window.__refinements)===1,'render failure does not automatically retry');
    await f.p.evaluate(()=>{window.__failScore=false;});await f.p.getByRole('button',{name:'Check custom rig',exact:true}).click();
    await f.p.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Apply custom rig'&&!b.disabled));
    check(true,'original remains manually checkable after automatic failure');
  } finally {await f.p.close();}

  f=await open();
  try {
    f.queue();await generate(f.p);await f.p.getByText('Generating individual gear settings…',{exact:true}).waitFor();
    await f.p.getByRole('button',{name:'Recordings',exact:true}).click();f.ready();
    await f.p.getByRole('button',{name:'Tone Match',exact:true}).click();await reconnect(f.p);
    await f.p.getByRole('heading',{name:'TEST ONLY original',exact:true}).waitFor();
    check(await f.p.evaluate(()=>window.__refinements===0),'navigation before provider readiness cancels the pending automatic authorization');
    await generate(f.p);await f.p.getByText('Generating individual gear settings…',{exact:true}).waitFor();f.ready();await reconnect(f.p);await started(f.p);
    await f.p.getByRole('button',{name:'Manual selection',exact:true}).click();await f.p.locator('#reference-end').fill('11');
    await f.p.evaluate(()=>window.__finishRefinement());await f.p.waitForTimeout(100);
    check(await f.p.locator('#custom-rig-title').count()===0&&await f.p.evaluate(()=>window.__aborts===1),'reference change unmounts and aborts running refinement; late completion is discarded');
  } finally {await f.p.close();}

  f=await open();
  try {
    await generate(f.p);await started(f.p);
    await f.p.getByRole('button',{name:'Workspace',exact:true}).click();
    await f.p.getByRole('button',{name:'New Tone Match',exact:false}).click();
    await f.p.evaluate(()=>window.__finishRefinement());await f.p.waitForTimeout(100);
    check(await f.p.getByRole('heading',{name:'Compare the same passage'}).count()===0&&await f.p.evaluate(()=>window.__aborts===1),'new project releases previous refinement and cannot receive its late result');
  } finally {await f.p.close();}

  f=await open(4);
  try {
    await generate(f.p);await f.p.getByText(/Automatic refinement needs at least six seconds/).waitFor();await reconnect(f.p);
    check(await f.p.evaluate(()=>window.__refinements===0)&&await f.p.getByRole('heading',{name:'TEST ONLY original',exact:true}).isVisible(),'short valid calibration skips automation with original and useful guidance');
    await f.p.getByRole('button',{name:'Check custom rig',exact:true}).click();
    await f.p.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Apply custom rig'&&!b.disabled));
    check(f.requests()===1,'short source still permits manual safety review without another model request');
  } finally {await f.p.close();}
  check(errors.length===0,'no browser runtime errors');
  return {synthetic:true,controlled_renderer:true,checks,errors};
}
