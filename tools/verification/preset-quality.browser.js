// Requires Vite on 5173 and the prepared benchmark directory served on 5175.
// Uses the production AudioEngine with an offline clock; no audible output or paid requests here.
async (page) => {
  const p=await page.context().newPage();
  try {
    const config=await(await p.request.get("http://127.0.0.1:5175/config.json")).json();
    const source=await(await p.request.get("http://127.0.0.1:5175/input.wav")).body();
    const validation=config.validation_sha256?await(await p.request.get("http://127.0.0.1:5175/validation.wav")).body():null;
    const code=await(await p.request.get("http://127.0.0.1:5173/src/StartingPresetPanel.tsx")).text();
    const module=code.match(/import\s*\{\s*AudioEngine\s*\}\s*from\s*["']([^"']+)["']/)?.[1];
    if(!module || !module.startsWith("/@fs/")) throw Error("Could not locate the production AudioEngine module");
    const root=decodeURIComponent(module.split("/packages/audio/")[0].slice(5));
    const out=config.output_dir.replaceAll("\\","/");
    if(!out.toLowerCase().startsWith((root+"/data/").toLowerCase()) || out.split("/").includes("..")) throw Error("Output must stay inside workspace data");
    await p.goto("http://127.0.0.1:5173/separation.html");
    const session=await(await p.request.get("http://127.0.0.1:5175/session")).json();
    const report=await p.evaluate(async({config,base64,validationBase64,module,root,token})=>{
      const {AudioEngine}=await import(module);
      const {compareAudio,levels,beatsBaseline}=await import(encodeURI(`/@fs/${root}/tools/evaluation/metrics.mjs`));
      const {encodeMonoWav}=await import("/src/localAudio.ts");
      const {toneFeatures}=await import("/src/audioFeatures.ts");
      const {refinePreset}=await import("/src/refinePreset.ts");
      const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
      const sourceHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),x=>x.toString(16).padStart(2,"0")).join("");
      if(sourceHash!==config.source_sha256)throw Error("Source hash changed");
      const file=new File([bytes],"evaluation-input.wav",{type:"audio/wav"});
      let validationFile;
      if(validationBase64){
        const data=Uint8Array.from(atob(validationBase64),c=>c.charCodeAt(0));
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",data)),x=>x.toString(16).padStart(2,"0")).join("");
        if(hash!==config.validation_sha256)throw Error("Held-out source changed");
        validationFile=new File([data],"heldout-input.wav",{type:"audio/wav"});
      }
      const NativeOffline=window.OfflineAudioContext, NativeAudio=window.AudioContext;
      const decoded=await new NativeOffline(1,1,44100).decodeAudioData(bytes.buffer.slice(0));
      if(decoded.numberOfChannels!==1 || decoded.length!==44100*15)throw Error("Expected exactly 15 seconds of mono source");
      let renderCount=0,audibleContexts=0;
      window.AudioContext=class extends NativeAudio {
        constructor(...args){super(...args);audibleContexts++;}
      };
      const files=new Map();
      files.set("input.wav",new Blob([bytes],{type:"audio/wav"}));
      const manual=(parameters)=>({schema_version:"1",name:"CONTROLLED TEST TARGET",description:"Known evaluation fixture, not AI output",quality_flags:["controlled_test_only"],provenance:{kind:"fixture",provider:null,model:null},parameters});
      async function render(preset,input=file){
        renderCount++;
        const result=await AudioEngine.renderFile(input,preset);
        return result.getChannelData(0).slice();
      }
      const started=performance.now();
      const report={version:1,source_commit:config.source_commit,engine_sha256:config.engine_sha256,evaluation_sha256:config.evaluation_sha256,source_sha256:sourceHash,
        source_calibration:config.source_calibration,sample_rate:44100,duration_seconds:15,paired_same_performance:true,
        renderer:"production AudioEngine / OfflineAudioContext",browser:navigator.userAgent,
        metric:"sampled multi-resolution STFT: 512/1024/2048, <=128 Hann frames each, 20Hz–20kHz; raw and RMS matched",
        thresholds:"Candidate must be safe and improve both raw loss and RMS-matched loss (latter by >=10%, provisional)",cases:[]};
      try {
        const baseline=await render(manual(config.baseline));
        for(const item of config.cases){
          if(!/^[a-z]+$/.test(item.id))throw Error("Invalid case name");
          const target=await render(manual(item.target_parameters));
          const repeated=await render(manual(item.target_parameters));
          const oracle=compareAudio(repeated,target,{sampleRate:44100,paired:true});
          if(oracle.raw.loss>1e-8 || oracle.esr>1e-10)throw Error("Offline oracle is not deterministic");
          const wrong=await render(manual({...item.target_parameters,
            bass_db:-item.target_parameters.bass_db,mid_db:-item.target_parameters.mid_db,treble_db:-item.target_parameters.treble_db}));
          const wrongScore=compareAudio(wrong,target,{sampleRate:44100,paired:true});
          if(wrongScore.raw.loss<=oracle.raw.loss)throw Error("Scorer failed to reject wrong controls");
          const neutral=compareAudio(baseline,target,{sampleRate:44100,paired:true});
          const targetLevels=levels(target);
          let quiet=0,clipped=0;
          for(let s=0;s<15;s++){const block=levels(target.subarray(s*44100,(s+1)*44100));if(block.rms**2<1e-5)quiet++;}
          for(const sample of target)if(Math.abs(sample)>=.999)clipped++;
          const row={id:item.id,target_parameters:item.target_parameters,oracle_raw_loss:oracle.raw.loss,wrong_raw_loss:wrongScore.raw.loss,
            target_tone_features:toneFeatures(target,44100),
            target_metrics:{guitar_rms_dbfs:targetLevels.rms_dbfs,stem_to_mix_energy_ratio:1,quiet_second_fraction:quiet/15,clipped_sample_fraction:clipped/target.length},
            neutral,verdict:"NEEDS_PROPOSAL",candidate:null};
          const listening={target,neutral:baseline};
          files.set(`${item.id}-target.wav`,encodeMonoWav(target,44100));
          files.set(`${item.id}-neutral.wav`,encodeMonoWav(baseline,44100));
          if(item.candidate){
            row.candidate_preset=item.candidate;
            try {
              const audio=await render(item.candidate);
              row.candidate=compareAudio(audio,target,{sampleRate:44100,paired:true});
              row.verdict=beatsBaseline(row.candidate,neutral)?"IMPROVES_BASELINE_PROVISIONALLY":"NO_VERIFIED_IMPROVEMENT";
              if(row.candidate.safe)listening.nemotron=audio;
              files.set(`${item.id}-nemotron.wav`,encodeMonoWav(audio,44100));
              const refined=await refinePreset(file,item.candidate,row.target_tone_features,{targetRmsDbfs:row.target_metrics.guitar_rms_dbfs});
              const improved=await render(refined.preset);
              row.refinement={...refined,metrics:compareAudio(improved,target,{sampleRate:44100,paired:true})};
              row.refined_verdict=beatsBaseline(row.refinement.metrics,neutral)?"IMPROVES_BASELINE_PROVISIONALLY":"NO_VERIFIED_IMPROVEMENT";
              row.refined_improves_candidate=row.refinement.metrics.rms_matched.loss<row.candidate.rms_matched.loss&&row.refinement.metrics.raw.loss<row.candidate.raw.loss;
              if(row.refinement.metrics.safe)listening.refined=improved;
              files.set(`${item.id}-refined.wav`,encodeMonoWav(improved,44100));
              if(validationFile){
                const [heldTarget,heldNeutral,heldAi,heldRefined]=await Promise.all([
                  render(manual(item.target_parameters),validationFile),render(manual(config.baseline),validationFile),render(item.candidate,validationFile),render(refined.preset,validationFile)]);
                const heldBaseline=compareAudio(heldNeutral,heldTarget,{sampleRate:44100,paired:true});
                const heldCandidate=compareAudio(heldAi,heldTarget,{sampleRate:44100,paired:true});
                const heldRefinement=compareAudio(heldRefined,heldTarget,{sampleRate:44100,paired:true});
                row.held_out={source_sha256:config.validation_sha256,not_used_for_refinement:true,neutral:heldBaseline,candidate:heldCandidate,refined:heldRefinement,
                  verdict:beatsBaseline(heldRefinement,heldBaseline)?"IMPROVES_BASELINE_PROVISIONALLY":"NO_VERIFIED_IMPROVEMENT"};
                files.set(`${item.id}-heldout-target.wav`,encodeMonoWav(heldTarget,44100));
                files.set(`${item.id}-heldout-refined.wav`,encodeMonoWav(heldRefined,44100));
              }
            } catch(error) {row.verdict="REJECTED_CANDIDATE";row.candidate_error=error.message;}
          }
          const listeningRms=Math.min(.1,...Object.values(listening).map(a=>{const v=levels(a);return .9*v.rms/v.peak}));
          row.listening_rms_dbfs=20*Math.log10(listeningRms);
          for(const [name,audio] of Object.entries(listening)){
            const gain=listeningRms/levels(audio).rms;
            files.set(`${item.id}-${name}-listen.wav`,encodeMonoWav(Float32Array.from(audio,x=>x*gain),44100));
          }
          report.cases.push(row);
        }
      } finally {window.AudioContext=NativeAudio;}
      report.direct_renders=renderCount;
      report.refinement_renders=report.cases.reduce((sum,row)=>sum+(row.refinement?.renders??0),0);
      report.offline_renders=renderCount+report.refinement_renders;
      report.elapsed_ms=Math.round(performance.now()-started);
      if(audibleContexts)throw Error("Offline evaluation created an audible context");
      report.audible_contexts=audibleContexts;
      report.limits=["Two reachable controlled targets only; not a representative tone benchmark", "Same performance/alignment required; do not score unrelated user playing against a song this way", "Diagnostic losses are not perceptual accuracy or human listening approval", "No amp/cab/compressor/delay/reverb modeled beyond the current production graph", "No provider requests in browser renderer"];
      files.set("report.json",new Blob([JSON.stringify(report,null,2)],{type:"application/json"}));
      const esc=x=>String(x).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;");
      const table=report.cases.map(row=>`<tr><td>${row.id}</td><td>${row.neutral.rms_matched.loss.toFixed(4)}</td><td>${row.candidate?row.candidate.rms_matched.loss.toFixed(4):"pending"}</td><td>${row.refinement?row.refinement.metrics.rms_matched.loss.toFixed(4):"pending"}</td><td>${row.refined_verdict??row.verdict}</td></tr>`).join("");
      const held=report.cases.filter(row=>row.held_out).map(row=>`<tr><td>${row.id}</td><td>${row.held_out.neutral.rms_matched.loss.toFixed(4)}</td><td>${row.held_out.refined.rms_matched.loss.toFixed(4)}</td><td>${row.held_out.verdict}</td></tr>`).join("");
      const audio=report.cases.map(row=>`<section><h2>${row.id}</h2><p>Listening copies have matched RMS, with peak headroom. Start at a comfortable volume.</p>${["target","neutral",...(row.candidate?.safe?["nemotron"]:[]),...(row.refinement?.metrics.safe?["refined"]:[])].map(name=>`<p>${name}</p><audio controls preload="none" src="${row.id}-${name}-listen.wav"></audio>`).join("")}</section>`).join("");
      files.set("report.html",new Blob([`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>modulo preset evaluation</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:0 20px;background:#171310;color:#eee}td,th{padding:12px;text-align:left;border:1px solid #665}table{border-collapse:collapse;font-size:14px}.table-wrap{overflow-x:auto}audio{max-width:100%}section{margin:32px 0}code{overflow-wrap:anywhere}</style><h1>Nemotron preset evaluation</h1><p>Controlled same-performance test. Lower sampled spectral loss is better. A provisional improvement is not a verified tone match.</p><div class="table-wrap"><table><tr><th>Case</th><th>Neutral shape loss</th><th>Nemotron shape loss</th><th>Refined shape loss</th><th>Refined verdict</th></tr>${table}</table></div><h2>Held-out section — no tuning</h2><div class="table-wrap"><table><tr><th>Case</th><th>Neutral</th><th>Refined</th><th>Verdict</th></tr>${held}</table></div>${audio}<h2>Limits</h2><ul>${report.limits.map(x=>`<li>${esc(x)}</li>`).join("")}</ul><p>Engine SHA256 <code>${report.engine_sha256}</code></p><p>Source SHA256 <code>${sourceHash}</code></p><p>Guitar-TECHS attribution: see ATTRIBUTION.txt. Full metrics and preset parameters: report.json.</p></html>`],{type:"text/html"}));
      for(const [name,body] of files){
        if(name==="input.wav")continue;
        const saved=await fetch(`http://127.0.0.1:5175/save/${name}`,{method:"POST",headers:{"Content-Type":"application/octet-stream","X-Eval-Token":token},body});
        if(!saved.ok)throw Error(`Could not save ${name}: ${saved.status}`);
      }
      return report;
    },{config,base64:source.toString("base64"),validationBase64:validation?.toString("base64"),module,root,token:session.token});
    return {report:`${out}/report.html`,offline_renders:report.offline_renders,cases:report.cases.map(row=>({id:row.id,oracle:row.oracle_raw_loss,neutral:row.neutral.rms_matched.loss,candidate:row.candidate?.rms_matched.loss,refined:row.refinement?.metrics.rms_matched.loss,refinement_renders:row.refinement?.renders,verdict:row.refined_verdict??row.verdict,beats_candidate:row.refined_improves_candidate,held_out:row.held_out?{neutral:row.held_out.neutral.rms_matched.loss,refined:row.held_out.refined.rms_matched.loss,verdict:row.held_out.verdict}:null})),limits:report.limits};
  } finally {await p.close();}
}
