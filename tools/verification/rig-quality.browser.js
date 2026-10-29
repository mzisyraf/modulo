// Real production DSP, licensed DI and controlled targets. No provider requests in this renderer.
async (page) => {
  const p = await page.context().newPage();
  try {
    const base = await page.evaluate(() => window.__rigEvalBase ?? "http://127.0.0.1:5175");
    if (!/^http:\/\/127\.0\.0\.1:517[56]$/.test(base)) throw Error("Use a known loopback evaluation receiver.");
    const config = await (await p.request.get(`${base}/config.json`)).json();
    const source = await (await p.request.get(`${base}/input.wav`)).body(), held = await (await p.request.get(`${base}/validation.wav`)).body();
    const proposalsResponse = await p.request.get(`${base}/proposals.json`), proposals = proposalsResponse.ok() && !config.render_targets_only ? await proposalsResponse.json() : [];
    const session = await (await p.request.get(`${base}/session`)).json();
    const code = await (await p.request.get("http://127.0.0.1:5173/src/StartingPresetPanel.tsx")).text();
    const module = code.match(/import\s*\{\s*AudioEngine\s*\}\s*from\s*["']([^"']+)["']/)?.[1];
    if (!module) throw Error("Cannot locate production audio module");
    const root = module.split("/packages/audio/")[0];
    await p.goto("http://127.0.0.1:5173/");
    return await p.evaluate(async ({base,config,source,held,proposals,token,module,root}) => {
      const audio = await import(module), {compareAudio,levels,beatsBaseline} = await import(`${root}/tools/evaluation/metrics.mjs`);
      const {calibrateGuitarFile} = await import("/src/recordingCalibration.ts"), {toneFeatures} = await import("/src/audioFeatures.ts"), {temporalFeatures} = await import("/src/temporalFeatures.ts");
      const {refineRig,neutralRigProposal} = await import("/src/refineRig.ts");
      const decode = text => Uint8Array.from(atob(text),c=>c.charCodeAt(0));
      const input = new File([decode(source)],"training.wav",{type:"audio/wav"}), validation = new File([decode(held)],"held-out.wav",{type:"audio/wav"});
      const calibration = await calibrateGuitarFile(input), gain = calibration.inputGainDb;
      let audible = 0; const Native = window.AudioContext; window.AudioContext = class extends Native {constructor(...args){super(...args);audible++;}};
      const mono = buffer => {const a=buffer.getChannelData(0),b=buffer.numberOfChannels>1?buffer.getChannelData(1):a;return Float32Array.from(a,(x,i)=>(x+b[i])/2);};
      async function render(file,proposal,output=-18){return (await audio.renderRigFile(file,audio.compileRigProposal(proposal,gain,output),{sampleRate:44100,tailSeconds:0})).buffer;}
      async function save(name,blob){const response=await fetch(`${base}/save/${name}`,{method:"POST",headers:{"Content-Type":"application/octet-stream","X-Eval-Token":token},body:blob});if(!response.ok)throw Error(`Could not save ${name}: ${response.status}`);}
      const targets={engine_sha256:config.engine_sha256,evaluation_sha256:config.evaluation_sha256,source_calibration:calibration.measurements,cases:[]};
      const report={engine_sha256:config.engine_sha256,evaluation_sha256:config.evaluation_sha256,source_sha256:config.source_sha256,validation_sha256:config.validation_sha256,paired_same_performance:true,cases:[],audible_contexts:0};
      try {
        for(const row of config.cases){
          const loadTarget=async name=>{if(!/^[a-z-]+\.wav$/.test(name))throw Error("Invalid evaluation target filename");return new OfflineAudioContext(2,1,44100).decodeAudioData(await(await fetch(`${base}/${name}`)).arrayBuffer());};
          const target=row.target_file?await loadTarget(row.target_file):await render(input,row.target),targetMono=mono(target),heldTarget=row.held_target_file?await loadTarget(row.held_target_file):await render(validation,row.target),targetFeatures=toneFeatures(targetMono,44100),timing=temporalFeatures(targetMono,44100);
          const targetHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await audio.encodeRigWav(target).arrayBuffer())),x=>x.toString(16).padStart(2,"0")).join("");
          if(config.expected_target_hashes && config.expected_target_hashes[`${row.id}-r0-target.wav`]!==targetHash)throw Error("Default target DSP changed; do not reuse cached requests");
          targets.cases.push({id:row.id,features:targetFeatures,temporal:timing,rms_dbfs:levels(targetMono).rms_dbfs});
          const neutral=await render(input,neutralRigProposal()),heldNeutral=await render(validation,neutralRigProposal());
          const baseline=compareAudio(mono(neutral),targetMono,{sampleRate:44100,paired:true}),heldBaseline=compareAudio(mono(heldNeutral),mono(heldTarget),{sampleRate:44100,paired:true});
          const oracle=compareAudio(targetMono,targetMono,{sampleRate:44100,paired:true});
          const outcomes=[];
          for(const item of proposals.filter(item=>item.case===row.id && (!config.evaluate_prompt_version || item.prompt_version===config.evaluate_prompt_version))){
            if(item.status!=="ready"){outcomes.push({model:item.model,repeat:item.repeat,status:item.status,error:item.error});continue;}
            const proposal=audio.parseRigProposal(item.result.proposal),candidate=await render(input,proposal);
            const refinement=await refineRig(input,proposal,gain,targetFeatures,{temporal:timing,targetRmsDbfs:levels(targetMono).rms_dbfs,progress:renders=>{window.__rigEvalProgress={case:row.id,model:item.model,repeat:item.repeat,renders};}});
            const refined=await render(input,refinement.proposal,refinement.outputLevelDb),heldRaw=await render(validation,proposal),heldRefined=await render(validation,refinement.proposal,refinement.outputLevelDb);
            const rawMetrics=compareAudio(mono(candidate),targetMono,{sampleRate:44100,paired:true}),refinedMetrics=compareAudio(mono(refined),targetMono,{sampleRate:44100,paired:true});
            const heldMetrics=compareAudio(mono(heldRefined),mono(heldTarget),{sampleRate:44100,paired:true}),heldRawMetrics=compareAudio(mono(heldRaw),mono(heldTarget),{sampleRate:44100,paired:true});
            const modelTag=item.model.includes("super")?"super":"nano";
            outcomes.push({model:item.model,prompt_version:item.prompt_version,repeat:item.repeat,status:"ready",audio_prefix:`${row.id}-${modelTag}-r${item.repeat}`,raw:rawMetrics,refined:refinedMetrics,refinement:{before:refinement.before,after:refinement.after,renders:refinement.renders,proposal:refinement.proposal,outputLevelDb:refinement.outputLevelDb},
              beats_neutral:beatsBaseline(refinedMetrics,baseline),held_out:{not_used_for_refinement:true,raw:heldRawMetrics,refined:heldMetrics,neutral:heldBaseline,beats_neutral:beatsBaseline(heldMetrics,heldBaseline)},usage:item.usage});
            if(item.repeat===0){
              const buffers={target,neutral,nemotron:candidate,refined};
              const commonRms=Math.min(.08,...Object.values(buffers).map(buffer=>{const x=levels(mono(buffer));let peak=0;for(let ch=0;ch<buffer.numberOfChannels;ch++)for(const sample of buffer.getChannelData(ch))peak=Math.max(peak,Math.abs(sample));return .9*x.rms/Math.max(peak,1e-12);}));
              for(const [name,buffer] of Object.entries(buffers)){
                const prefix=`${row.id}-${modelTag}-r${item.repeat}-${name}`;await save(`${prefix}.wav`,audio.encodeRigWav(buffer));
                const listening=new OfflineAudioContext(buffer.numberOfChannels,buffer.length,44100).createBuffer(buffer.numberOfChannels,buffer.length,44100),factor=commonRms/levels(mono(buffer)).rms;
                for(let ch=0;ch<buffer.numberOfChannels;ch++)listening.copyToChannel(buffer.getChannelData(ch).map(x=>x*factor),ch);
                await save(`${prefix}-listen.wav`,audio.encodeRigWav(listening));
              }
            }
          }
          report.cases.push({id:row.id,oracle_raw_loss:oracle.raw.loss,neutral:baseline,held_neutral:heldBaseline,outcomes});
        }
      } finally {window.AudioContext=Native;}
      report.audible_contexts=audible;if(audible)throw Error("Evaluation created audible contexts");
      await save("rig-targets.json",new Blob([JSON.stringify(targets,null,2)],{type:"application/json"}));
      await save("rig-report.json",new Blob([JSON.stringify(report,null,2)],{type:"application/json"}));
      return {audible_contexts:audible,cases:report.cases.map(row=>({id:row.id,oracle:row.oracle_raw_loss,neutral:row.neutral.rms_matched.loss,outcomes:row.outcomes.map(x=>({model:x.model,repeat:x.repeat,status:x.status,raw:x.raw?.rms_matched.loss,refined:x.refined?.rms_matched.loss,held:x.held_out?.refined.rms_matched.loss,held_beats_neutral:x.held_out?.beats_neutral}))}))};
    },{base,config,source:source.toString("base64"),held:held.toString("base64"),proposals,token:session.token,module,root});
  } finally {await p.close();}
}
