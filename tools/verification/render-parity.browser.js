// Actual native buffer/file parity, channels, output tails and cancellation.
async(page)=>{
 const p=await page.context().newPage();
 try{
  const code=await(await p.request.get('http://127.0.0.1:5173/src/StartingPresetPanel.tsx')).text(),module=code.match(/import\s*\{\s*AudioEngine\s*\}\s*from\s*["']([^"']+)["']/)?.[1];if(!module)throw Error('Missing audio module');const root=module.split('/packages/audio/')[0];
  await p.goto('http://127.0.0.1:5173/?verification=render-parity');
  return await p.evaluate(async({module,root})=>{
   const audio=await import(module),config=await(await fetch(root+'/data/verification/rig-reliability-20261030/config.json')).json();
   const context=new OfflineAudioContext(2,1,44100),original=context.createBuffer(2,44100,44100);
   for(let ch=0;ch<2;ch++){const samples=original.getChannelData(ch);for(let i=0;i<samples.length;i++)samples[i]=.12*Math.sin(2*Math.PI*(ch?440:220)*i/44100);}
   const file=new File([audio.encodeRigWav(original)],'parity.wav',{type:'audio/wav'}),decoded=await context.decodeAudioData(await file.arrayBuffer()),checks=[];
   for(const row of config.cases){
    const rig=audio.compileRigProposal(row.target,0,-18);
    for(const channel of [0,1]){
     const options={sampleRate:44100,channel,tailSeconds:2};
     const a=await audio.renderRigFile(file,rig,options),b=await audio.renderRigBuffer(decoded,rig,options);
     let maximum=0;for(let ch=0;ch<2;ch++){const x=a.buffer.getChannelData(ch),y=b.buffer.getChannelData(ch);if(x.length!==y.length)throw Error('Changed frame count');for(let i=0;i<x.length;i++)maximum=Math.max(maximum,Math.abs(x[i]-y[i]));}
     if(maximum>1e-7||a.durationSeconds!==3||'blob'in b||a.blob.type!=='audio/wav')throw Error('Buffer/file output differs');
     checks.push({case:row.id,channel,maximum});
    }
   }
   const controller=new AbortController();controller.abort();let cancelled=false;
   try{await audio.renderRigBuffer(decoded,audio.compileRigProposal(config.cases[0].target,0),{signal:controller.signal});}catch(e){cancelled=e.name==='AbortError';}
   if(!cancelled)throw Error('Cancellation ignored');
   return{checks,cancelled,audible:false};
  },{module,root});
 }finally{await p.close();}
}
