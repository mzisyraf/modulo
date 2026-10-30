// TEST ONLY: no backend, provider, microphone, speaker or deployment. Real React + offline DSP.
import { createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { RigGenerationPanel } from "../../apps/web/src/RigGenerationPanel";
import { calibrateLiveInput, type CalibratedRecording } from "../../apps/web/src/recordingCalibration";
import type { RigGeneration } from "../../apps/web/src/rigGeneration";
import type { PresetAudition } from "../../apps/web/src/StartingPresetPanel";
import hash from "../../contracts/rig-catalog-hash.json";
import { encodeMonoWav } from "../../apps/web/src/localAudio";

export async function verifyAutomaticRefinement() {
  const checks: string[] = [], wait = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));
  const check = (ok: unknown, label: string) => { if (!ok) throw Error(label); checks.push(label); };
  const until = async (test: () => unknown, label: string, timeout = 20000) => {
    const deadline = Date.now() + timeout;
    while (!test()) { if (Date.now() > deadline) throw Error(`${label}: ${document.body.textContent}`); await wait(); }
  };
  const button = (name: string) => [...document.querySelectorAll("button")].find(b => b.textContent === name)!;
  const click = (name: string) => { const b = button(name); check(b && !b.disabled, `${name} available`); b.click(); };
  const busy = () => Boolean(button("Cancel rendering"));
  const props = { active: true, jobId: "11111111-1111-4111-8111-111111111111", revision: 1 };
  let recording: CalibratedRecording, generation: RigGeneration | undefined, requests = 0, applies = 0, microphones = 0, contexts = 0, reads = 0;
  let mode: "ready" | "generating" | "failed" = "ready", hold = false, fail = false, release: (() => void) | undefined;
  const file = async (seconds: number) => {
    const pcm = Float32Array.from({ length: Math.round(44100 * seconds) }, (_, i) => .12 * Math.sin(i * 2 * Math.PI * 220 / 44100));
    const calibrated = await calibrateLiveInput(pcm, 44100);
    const read = calibrated.file.arrayBuffer.bind(calibrated.file);
    calibrated.file.arrayBuffer = async () => { reads++; if (hold) await new Promise<void>(resolve => { release = resolve; }); if (fail) { fail = false; throw Error("TEST ONLY local decode failure"); } return read(); };
    return calibrated;
  };
  recording = await file(6.1);
  const ready = (id = crypto.randomUUID()): RigGeneration => ({ request_id: id, reference_revision: props.revision, kind: "rig_proposal", status: "ready", source_calibration: recording.measurements,
    target_tone_features: recording.measurements.tone_features, target_temporal_features: recording.measurements.temporal_features,
    rig_proposal: { proposal: { proposal_version: "1", name: "TEST ONLY automatic rig", description: "Offline scheduling fixture", tempo_bpm: 120, modules: [{ model_id: "eq.tilt", enabled: true, parameters: { tilt_db: 0, pivot_hz: 800 } }] },
      provenance: { kind: "generated", provider: "nebius", model: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B" }, catalog_sha256: hash.sha256, quality_flags: ["tone_matching_unverified"] } });
  const originalFetch = window.fetch, originalCapture = navigator.mediaDevices.getUserMedia, originalContext = window.AudioContext;
  window.AudioContext = new Proxy(originalContext, { construct(target, args) { contexts++; return Reflect.construct(target, args); } });
  navigator.mediaDevices.getUserMedia = async () => { microphones++; throw Error("Capture prohibited in offline suite"); };
  window.fetch = async (input, init) => {
    const path = new URL(String(input), location.href).pathname;
    const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
    if (path === "/api/health") return json({ rig_generation_available: true });
    if (path.endsWith("/rig") && init?.method === "POST") {
      requests++; generation = ready();
      if (mode !== "ready") { generation.status = mode; delete generation.rig_proposal; if (mode === "failed") generation.error = { code: "test", message: "TEST ONLY generation failure", retryable: true }; }
      return json(generation);
    }
    if (path === `/api/jobs/${props.jobId}`) return json({ job_id: props.jobId, status: "ready", stage: "ready", expires_at: Date.now() / 1000 + 1000, generation,
      result: { duration_seconds: 12, sample_rate: 44100, common_gain_linear: 1, quality_flags: [], provenance: { kind: "local_separation", model: "TEST ONLY", device: "TEST ONLY" },
        artifacts: Object.fromEntries(["mix", "guitar", "backing"].map(k => [k, `/api/jobs/${props.jobId}/audio/${k}`])),
        reference_revision: props.revision, reference: { start_seconds: 0, end_seconds: 12, explanation: "TEST ONLY", quality_flags: [] }, suggestion: null } });
    throw Error(`Network prohibited: ${path}`);
  };
  const root = createRoot(document.getElementById("verification")!), ref = createRef<PresetAudition>();
  const render = () => flushSync(() => root.render(createElement(RigGenerationPanel, { ...props, recording, ref, onApply: async () => { applies++; }, onReferenceChanged: () => { throw Error("Unexpected invalidation"); } })));
  const idle = async () => { await until(() => !busy(), "rendering finishes", 180000); await wait(100); };
  const cancelHeld = async () => { click("Cancel rendering"); hold = false; release?.(); await idle(); };
  try {
    generation = ready(); render();
    await until(() => button("Generate custom rig") && !button("Generate custom rig").disabled && document.querySelector("h3"), "reconnected ready fixture");
    check(reads === 0 && !busy() && button("Apply custom rig").disabled, "merely discovering a ready proposal never refines or certifies it");
    click("Generate custom rig"); await until(busy, "automatic refinement starts");
    check(button("Apply custom rig").disabled && button("Generate custom rig").disabled, "automatic work disables competing Apply/Generate actions");
    await idle();
    check(Boolean(document.body.textContent?.includes("Separate-excerpt validation")) && !button("Apply custom rig").disabled, "real offline refinement and safety check finish automatically");
    check(requests === 1 && applies === 0 && microphones === 0 && contexts === 0, "automatic refinement has no extra request, Apply, microphone or speaker context");
    const completedReads = reads;
    click("Reconnect rig status"); await wait(250); click("Reconnect rig status"); await wait(250);
    check(reads === completedReads && requests === 1, "poll/reconnect cannot restart consumed refinement");
    click("Restore original proposal"); await wait(100);
    check(button("Apply custom rig").disabled && reads === completedReads, "restore requires a manual check and never refines again");

    mode = "generating"; hold = true; click("Generate custom rig");
    await until(() => generation?.status === "generating", "queued fixture acknowledged");
    const queuedId = generation!.request_id; generation = ready(queuedId);
    await until(() => busy() && Boolean(release), "poll delivers requested ready response");
    await cancelHeld(); const cancelledReads = reads;
    click("Reconnect rig status"); await wait(300);
    check(reads === cancelledReads && button("Apply custom rig").disabled, "cancel during requested polling keeps raw proposal without retry");

    mode = "ready"; fail = true; click("Generate custom rig");
    await until(() => Boolean(document.querySelector('[role="alert"]')), "decode failure shown"); await idle();
    check(document.body.textContent?.includes("original proposal remains available") && button("Apply custom rig").disabled, "refinement failure preserves original and never certifies it");
    const failureReads = reads; click("Reconnect rig status"); await wait(200);
    check(reads === failureReads, "failed automatic refinement never loops on reconnect");
    click("Check custom rig"); await until(busy, "manual fallback starts"); await idle();
    check(!button("Apply custom rig").disabled, "manual check remains usable after automatic failure");

    const automatic = () => document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    automatic().click(); await wait(); const manualReads = reads;
    click("Generate custom rig"); await until(() => Boolean(document.body.textContent?.includes("Automatic refinement is off")), "opt-out shown");
    check(reads === manualReads && button("Apply custom rig").disabled, "opt-out retains manual Check/Refine gate");
    automatic().click(); await wait();

    recording = await file(3.5); generation = undefined; render(); await wait(100); const shortReads = reads;
    click("Generate custom rig"); await until(() => Boolean(document.body.textContent?.includes("needs at least six seconds")), "short-source guidance");
    check(reads === shortReads && button("Apply custom rig").disabled, "short calibrated source skips automatic rendering safely");
    click("Check custom rig"); await until(busy, "short-source manual check"); await idle();
    check(!button("Apply custom rig").disabled, "short source still supports explicit safe check");

    recording = await file(6.1); generation = undefined; render(); await wait(100); hold = true; release = undefined;
    click("Generate custom rig"); await until(() => busy() && release, "held navigation render");
    props.active = false; render(); hold = false; release?.(); await wait(200); const navigationReads = reads;
    props.active = true; render(); await wait(300);
    check(reads === navigationReads && !busy() && button("Apply custom rig").disabled, "inactive navigation cancels and reopening does not restart");

    hold = true; release = undefined; click("Generate custom rig"); await until(() => busy() && release, "held source-change render");
    recording = await file(3.5); generation = undefined; render(); hold = false; release?.(); await wait(200);
    check(!document.querySelector("h3") && applies === 0 && !busy(), "source change discards late render and cannot apply it");

    mode = "failed"; click("Generate custom rig"); await until(() => Boolean(document.querySelector('[role="alert"]')), "failed generation");
    check(!busy() && microphones === 0 && contexts === 0, "failed provider status does not start local work or audio");
    return { passed: checks.length, checks, requests, microphones, speakerContexts: contexts, applies, synthetic: true, actualOfflineDSP: true, browser: navigator.userAgent };
  } finally { root.unmount(); window.fetch = originalFetch; navigator.mediaDevices.getUserMedia = originalCapture; window.AudioContext = originalContext; }
}

/** The actual main app journey, with API transport replaced before any interaction. */
export async function verifyMainAutomaticRefinement() {
  const checks: string[] = [], wait = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));
  const check = (ok: unknown, label: string) => { if (!ok) throw Error(label); checks.push(label); };
  const until = async (test: () => unknown, label: string, timeout = 30000) => { const end = Date.now() + timeout; while (!test()) { if (Date.now() > end) throw Error(label + ': ' + document.body.textContent?.slice(-2000)); await wait(); } };
  const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === text || b.textContent?.trim() === text);
  const click = async (text: string) => { await until(() => button(text) && !button(text)!.disabled, text); button(text)!.click(); await wait(); };
  const id = '22222222-2222-4222-8222-222222222222';
  let revision = 0, reference: unknown = null, generation: RigGeneration | undefined, requests = 0, captures = 0;
  const wav = encodeMonoWav(Float32Array.from({length: 44100 * 12}, (_, i) => .1 * Math.sin(i * 2 * Math.PI * 220 / 44100)), 44100);
  const originalFetch = window.fetch, originalCapture = navigator.mediaDevices.getUserMedia;
  navigator.mediaDevices.getUserMedia = async () => { captures++; throw Error('TEST ONLY: microphone prohibited'); };
  window.fetch = async (input, init) => {
    const path = new URL(String(input), location.href).pathname;
    if (!path.startsWith('/api/')) return originalFetch(input, init);
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: {'Content-Type':'application/json'} });
    if (path === '/api/health') return json({status:'ok', separation_available:true, preset_generation_available:false, rig_generation_available:true});
    if (path === '/api/jobs' && init?.method === 'POST') return json({job_id:id,status:'ready'},202);
    if (path.endsWith('/references')) return json({method:'signal_contrast_v1',duration_seconds:12,options:[],waveforms:{mix:Array(120).fill(.5),guitar:Array(120).fill(.5)}});
    if (path.endsWith('/reference')) { revision++; reference={start_seconds:0,end_seconds:12,explanation:'TEST ONLY',quality_flags:['synthetic']}; return json(reference); }
    if (path.endsWith('/rig') && init?.method === 'POST') {
      requests++;
      const source=JSON.parse(String(init.body)).source_calibration;
      generation={request_id:crypto.randomUUID(),reference_revision:revision,kind:'rig_proposal',status:'ready',source_calibration:source,target_tone_features:source.tone_features,target_temporal_features:source.temporal_features,
        rig_proposal:{proposal:{proposal_version:'1',name:'TEST ONLY main automatic rig',description:'Intercepted API; actual browser DSP',tempo_bpm:120,modules:[{model_id:'eq.tilt',enabled:true,parameters:{tilt_db:0,pivot_hz:800}}]},provenance:{kind:'generated',provider:'nebius',model:'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B'},catalog_sha256:hash.sha256,quality_flags:['tone_matching_unverified']}};
      return json(generation,202);
    }
    if (path === `/api/jobs/${id}`) return json({job_id:id,status:'ready',stage:'ready',expires_at:Date.now()/1000+1000,backend:'local',generation,result:{duration_seconds:12,sample_rate:44100,common_gain_linear:1,quality_flags:['synthetic'],provenance:{kind:'local_separation',model:'TEST ONLY',device:'TEST ONLY'},artifacts:Object.fromEntries(['mix','guitar','backing'].map(k=>[k,`/api/jobs/${id}/audio/${k}`])),reference,reference_revision:revision,suggestion:null}});
    if (path.startsWith(`/api/jobs/${id}/audio/`)) return new Response(wav,{headers:{'Content-Type':'audio/wav'}});
    throw Error('TEST ONLY: unexpected API route blocked');
  };
  try {
    await click('Tone Match'); await click('Guitar audio'); await click('Use supplied dry guitar');
    await until(()=>document.body.textContent?.includes('Guitar audio calibrated'),'supplied source calibration');
    const upload=document.getElementById('separation-file') as HTMLInputElement, files=new DataTransfer();files.items.add(new File([wav],'TEST ONLY.wav',{type:'audio/wav'}));upload.files=files.files;upload.dispatchEvent(new Event('change',{bubbles:true}));
    await click('Separate guitar'); await until(()=>button('Manual selection'),'reference options'); await click('Manual selection');
    const end=document.getElementById('reference-end') as HTMLInputElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(end,'12');end.dispatchEvent(new Event('input',{bubbles:true}));await wait();await click('Confirm reference');
    await until(()=>button('Generate custom rig')&&!button('Generate custom rig')!.disabled,'rig generation enabled');
    check((document.querySelector('#custom-rig-title')!.closest('section')!.querySelector('input[type=checkbox]') as HTMLInputElement).checked,'main workflow defaults automatic refinement on');
    await click('Generate custom rig');
    check(document.getElementById('amp-title')?.textContent!=='TEST ONLY main automatic rig','main workflow generation does not Apply itself');
    await until(()=>Boolean(document.querySelector('#custom-rig-title')!.closest('section')!.textContent?.includes('Separate-excerpt validation'))&&!button('Apply custom rig')!.disabled,'main workflow automatic completion',180000);
    check(requests===1&&captures===0,'main automatic DSP makes one intercepted POST and no capture');
    const text=document.querySelector('#custom-rig-title')!.closest('section')!.textContent!;
    check(Number(text.match(/(\d+)\/80 local renders/)?.[1])<=80,'main refiner preserves bounded candidate count');
    await click('Apply custom rig');
    await until(()=>document.getElementById('amp-title')?.textContent==='TEST ONLY main automatic rig','deliberate main apply');
    check((document.getElementById('drive') as HTMLInputElement).disabled,'deliberate Apply reaches existing model engine and disables legacy controls');
    await click('Recordings'); await click('Tone Match'); await wait(250);
    check(requests===1&&!button('Cancel rendering'),'main navigation and return do not regenerate/refine again');
    await click('Restore original proposal');
    check(button('Apply custom rig')!.disabled,'main Restore requires rechecking');
    return {passed:checks.length,checks,requests,captures,synthetic:true,actualMainApp:true};
  } finally { window.fetch=originalFetch; navigator.mediaDevices.getUserMedia=originalCapture; }
}
