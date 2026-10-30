// Development-only cross-excerpt effects retrieval; never reads final held-out audio.
async(page)=>{
 const p=await page.context().newPage();
 try{
  const code=await(await p.request.get('http://127.0.0.1:5173/src/StartingPresetPanel.tsx')).text();
  const module=code.match(/import\s*\{\s*AudioEngine\s*\}\s*from\s*["']([^"']+)["']/)?.[1];if(!module)throw Error('Missing audio module');const root=module.split('/packages/audio/')[0];
  await p.goto('http://127.0.0.1:5173/?verification=scorer-cases');
  return await p.evaluate(async({module,root})=>{
   const audio=await import(module),{toneFeatures}=await import('/src/audioFeatures.ts'),{temporalFeatures}=await import('/src/temporalFeatures.ts'),{rigFeatureDistance}=await import('/src/rigSearch.ts');
   const base='http://127.0.0.1:5175',session=await(await fetch(base+'/session')).json();
   const config=await(await fetch(root+'/data/verification/rig-reliability-20261030/config.json')).json();
   const decoder=new OfflineAudioContext(1,1,44100),source=await decoder.decodeAudioData(await(await fetch(root+'/data/verification/rig-reliability-20261030/input.wav')).arrayBuffer());
   const conditions=config.cases.flatMap(c=>{
    const near=structuredClone(c.target);near.name+=' nearby';
    if(c.id==='clean')near.modules[0].parameters.treble_db=-1;
    if(c.id==='crunch')near.modules[0].parameters.gain=.18;
    if(c.id==='space')near.modules.find(m=>m.model_id==='delay.digital').parameters.time_ms=140;
    return [{id:c.id+'-target',family:c.id,proposal:c.target},{id:c.id+'-near',family:c.id,proposal:near}];
   });
   const manifest={version:1,description:'Six known chains, two disjoint six-second phrases within first15s development source; no final held-out audio or training.',conditions,items:[],current_rankings:[]};
   async function save(name,blob){const r=await fetch(base+'/save/'+name,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Eval-Token':session.token},body:blob});if(!r.ok)throw Error('Could not save '+name);}
   for(const [excerpt,start]of [['a',0],['b',9]]){
    const input=decoder.createBuffer(1,44100*6,44100);input.copyToChannel(source.getChannelData(0).slice(start*44100,(start+6)*44100),0);
    for(const condition of conditions){
     const result=await audio.renderRigBuffer(input,audio.compileRigProposal(condition.proposal,config.source_calibration?Math.round(Math.max(-24,Math.min(12,-24-config.source_calibration.rms_dbfs,-6-config.source_calibration.peak_dbfs))*10)/10:0,-18),{sampleRate:44100,tailSeconds:2});
     const samples=Float32Array.from(result.buffer.getChannelData(0).slice(0,44100*6),(x,i)=>(x+result.buffer.getChannelData(1)[i])/2);
     const item={id:excerpt+'-'+condition.id,file:excerpt+'-'+condition.id+'.wav',excerpt,condition:condition.id,family:condition.family,tone:toneFeatures(samples,44100),temporal:temporalFeatures(samples,44100)};
     manifest.items.push(item);await save(item.file,audio.encodeRigWav(result.buffer));
    }
   }
   for(const q of manifest.items.filter(x=>x.excerpt==='b')){
    const scores=manifest.items.filter(x=>x.excerpt==='a').map(c=>({condition:c.condition,loss:rigFeatureDistance(c.tone,q.tone,c.temporal,q.temporal).loss})).sort((a,b)=>a.loss-b.loss);
    manifest.current_rankings.push({query:q.condition,predicted:scores[0].condition,correct:scores[0].condition===q.condition,scores});
   }
   await save('scorer-manifest.json',new Blob([JSON.stringify(manifest,null,2)],{type:'application/json'}));
   return {items:manifest.items.length,current:manifest.current_rankings.map(x=>({query:x.query,predicted:x.predicted,correct:x.correct}))};
  },{module,root});
 }finally{await p.close();}
}
