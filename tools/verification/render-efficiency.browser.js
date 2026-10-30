// Licensed cached development audio, actual offline DSP. No provider calls.
async(page)=>{
 const p=await page.context().newPage();
 try{
  const code=await(await p.request.get('http://127.0.0.1:5173/src/StartingPresetPanel.tsx')).text();
  const module=code.match(/import\s*\{\s*AudioEngine\s*\}\s*from\s*["']([^"']+)["']/)?.[1];if(!module)throw Error('Missing production module');
  const root=module.split('/packages/audio/')[0];
  await p.goto('http://127.0.0.1:5173/?verification=render-efficiency');
  return await p.evaluate(async({module,root})=>{
   const {refineRig}=await import('/src/refineRig.ts'),{calibrateGuitarFile}=await import('/src/recordingCalibration.ts');
   const base=root+'/data/verification/rig-reliability-20261030/';
   const file=new File([await(await fetch(base+'input.wav')).blob()],'development.wav',{type:'audio/wav'});
   const proposals=await(await fetch(base+'proposals.json')).json(),targets=await(await fetch(base+'rig-targets.json')).json();
   const row=proposals.find(x=>x.case==='clean'&&x.repeat===0),target=targets.cases.find(x=>x.id==='clean');
   const calibration=await calibrateGuitarFile(file),runs=[];
   const nativeDecode=OfflineAudioContext.prototype.decodeAudioData,NativeBlob=window.Blob;
   let decodes=0,wavs=0;
   OfflineAudioContext.prototype.decodeAudioData=function(...args){decodes++;return nativeDecode.apply(this,args);};
   window.Blob=new Proxy(NativeBlob,{construct(target,args){if(args[1]?.type==='audio/wav')wavs++;return Reflect.construct(target,args);}});
   try{
    for(let repeat=0;repeat<3;repeat++){
     decodes=0;wavs=0;const start=performance.now();
     const result=await refineRig(file,row.result.proposal,calibration.inputGainDb,target.features,{temporal:target.temporal,targetRmsDbfs:target.rms_dbfs});
     if(result.renders>80||![result.before,result.after,result.validationBefore,result.validationAfter,result.outputLevelDb].every(Number.isFinite))throw Error('Invalid or unbounded refinement');
     runs.push({milliseconds:performance.now()-start,decodes,wavs,renders:result.renders,proposal:result.proposal,outputLevelDb:result.outputLevelDb,before:result.before,after:result.after,validationBefore:result.validationBefore,validationAfter:result.validationAfter,retained:result.retained});
    }
   }finally{OfflineAudioContext.prototype.decodeAudioData=nativeDecode;window.Blob=NativeBlob;}
   if(runs.some(r=>JSON.stringify({...r,milliseconds:0})!==JSON.stringify({...runs[0],milliseconds:0})))throw Error('Repeated refinement changed decisions or work counts');
   return {source:'cached licensed development excerpt; not new quality inference',runs};
  },{module,root});
 }finally{await p.close();}
}
