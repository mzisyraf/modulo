import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { compileRigProposal, getGearModel, parseRigProposal, type RigProposal, type RigPreset } from "@modulo/audio";
import { apiJson, parseSeparationJob } from "./separation";
import { parseRigGeneration, rigSourceMatches, type GeneratedRig, type RigGeneration } from "./rigGeneration";
import { calibrationKey, type CalibratedRecording } from "./recordingCalibration";
import { neutralRigProposal, refineRig, scoreRig, type RigScore } from "./refineRig";
import { AutomaticRigRefinement } from "./automaticRigRefinement";
import type { PresetAudition } from "./StartingPresetPanel";

export function RigGenerationPanel({ jobId, revision, recording, onApply, onReferenceChanged, active, ref }: {
  jobId: string; revision: number; recording?: CalibratedRecording; active: boolean;
  onApply: (rig: RigPreset, generated: GeneratedRig) => Promise<void>;
  onReferenceChanged: () => void; ref?: Ref<PresetAudition>;
}) {
  const [generation, setGeneration] = useState<RigGeneration>(), [draft, setDraft] = useState<RigProposal>();
  const [available, setAvailable] = useState(false), [submitting, setSubmitting] = useState(false), [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [applied, setApplied] = useState(false), [renders, setRenders] = useState(0);
  const [quality, setQuality] = useState<{ candidate: RigScore; neutral: RigScore; key: string }>();
  const [refinement, setRefinement] = useState<{ before: number; after: number; renders: number; validationBefore: number; validationAfter: number; retained: boolean }>();
  const [outputLevelDb, setOutputLevelDb] = useState(-18);
  const [automatic, setAutomatic] = useState(true), [automaticNotice, setAutomaticNotice] = useState("");
  const gate = useRef(new AutomaticRigRefinement());
  const action = useRef<AbortController | null>(null), renderRun = useRef(0), submittingRef = useRef(false), busyRef = useRef(false);
  const sourceKey = calibrationKey(recording?.measurements), draftKey = JSON.stringify([draft, outputLevelDb]), lastCandidate = useRef("");
  const context = JSON.stringify([jobId, revision, sourceKey]);
  const changed = useRef(onReferenceChanged); changed.current = onReferenceChanged;
  function stop() {
    gate.current.cancel(); renderRun.current++; action.current?.abort();
    if (busyRef.current) setAutomaticNotice("Local rendering cancelled. Check the proposal manually before applying; it will not restart automatically.");
    busyRef.current = false; setBusy(false);
  }
  useImperativeHandle(ref, () => ({ stop }));
  useEffect(() => { if (!active) stop(); }, [active]);
  useEffect(() => { stop(); setDraft(undefined); setGeneration(undefined); setQuality(undefined); setRefinement(undefined); setAutomaticNotice(""); setApplied(false); setError(""); lastCandidate.current = ""; }, [context]);
  useEffect(() => () => { gate.current.cancel(); renderRun.current++; action.current?.abort(); }, []);

  // Both POST and polling use this path. Only an acknowledged explicit POST arms the gate.
  function receive(next: RigGeneration) {
    if (!recording || !rigSourceMatches(next, recording.measurements)) return;
    const decision = gate.current.consume(context, next.request_id, next.status, recording.measurements.duration_seconds);
    setGeneration(next);
    if (next.status === "ready" && next.rig_proposal && (lastCandidate.current !== next.request_id || decision !== undefined)) {
      stop();
      const proposal = parseRigProposal(next.rig_proposal.proposal);
      setDraft(proposal); setOutputLevelDb(-18); setRefinement(undefined); setQuality(undefined); setApplied(false);
      lastCandidate.current = next.request_id;
      setAutomaticNotice(decision === "short" ? "Automatic refinement needs at least six seconds of prepared guitar audio. Check this original proposal manually, or calibrate a longer source."
        : decision === "manual" ? "Automatic refinement is off. Check or refine this proposal manually."
        : decision === "refine" ? "Refining this requested rig locally. Apply and playback remain manual."
        : "Reconnected proposal. Check or refine manually; reconnecting does not start automatic refinement.");
      if (decision === "refine") void check(true, { recording, generation: next, draft: proposal, output: -18 });
    }
  }
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); let timer: number | undefined;
    const signal = () => AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
    void apiJson("/api/health", { signal: signal() }).then(value => { if (!controller.signal.aborted) setAvailable(value.rig_generation_available === true); }).catch(failure => { if (!controller.signal.aborted) setError(String(failure.message)); });
    async function poll() {
      try {
        const job = parseSeparationJob(await apiJson(`/api/jobs/${jobId}`, { signal: signal() }));
        if (controller.signal.aborted) return;
        if (submittingRef.current) { timer = window.setTimeout(() => void poll(), 1000); return; }
        if (!job.result?.reference || job.result.reference_revision !== revision) { stop(); changed.current(); return; }
        if (job.generation?.kind === "rig_proposal") {
          const next = parseRigGeneration(job.generation, revision);
          receive(next);
          if (next.status === "generating") timer = window.setTimeout(() => void poll(), 1000);
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          if (failure instanceof Error && "status" in failure && failure.status === 404) { stop(); changed.current(); }
          else setError(failure instanceof Error ? failure.message : "Could not reconnect to rig generation.");
        }
      }
    }
    void poll(); return () => { controller.abort(); window.clearTimeout(timer); };
  }, [jobId, revision, sourceKey, refresh, active]);
  async function generate() {
    if (!recording || submittingRef.current || busyRef.current || !active) return;
    stop();
    const ticket = gate.current.begin(context, automatic);
    submittingRef.current = true; setSubmitting(true); setError(""); setQuality(undefined); setDraft(undefined); setRefinement(undefined); setApplied(false); setAutomaticNotice("");
    const controller = new AbortController(); action.current = controller;
    try {
      const next = parseRigGeneration(await apiJson(`/api/jobs/${jobId}/rig`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference_revision: revision, source_calibration: recording.measurements }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }), revision);
      if (!controller.signal.aborted && rigSourceMatches(next, recording.measurements) && gate.current.acknowledge(ticket, context, next.request_id)) {
        receive(next); setRefresh(value => value + 1);
      }
    } catch (failure) { if (!controller.signal.aborted) { gate.current.cancel(); setError(failure instanceof Error ? failure.message : "Rig generation failed."); } }
    finally { submittingRef.current = false; setSubmitting(false); }
  }
  async function check(refine = false, supplied?: { recording: CalibratedRecording; generation: RigGeneration; draft: RigProposal; output: number }) {
    const source = supplied?.recording ?? recording, proposal = supplied?.draft ?? draft, generated = supplied?.generation ?? generation;
    if (!source || !proposal || !generated?.target_tone_features || busyRef.current || !active) return;
    const run = ++renderRun.current, controller = new AbortController(); action.current = controller;
    busyRef.current = true; setBusy(true); setError(""); setQuality(undefined); setRenders(0);
    try {
      let candidate = proposal, output = supplied?.output ?? outputLevelDb;
      let result: Awaited<ReturnType<typeof refineRig>> | undefined;
      if (refine) {
        result = await refineRig(source.file, proposal, source.inputGainDb, generated.target_tone_features, { signal: controller.signal, temporal: generated.target_temporal_features, targetRmsDbfs: generated.target_rms_dbfs, targetWindows: generated.target_feature_windows, progress: count => { if (run === renderRun.current) setRenders(count); } });
        if (run !== renderRun.current || controller.signal.aborted) return;
        candidate = result.proposal; output = result.outputLevelDb;
      }
      const [score, neutral] = await Promise.all([scoreRig(source.file, candidate, source.inputGainDb, generated.target_tone_features, controller.signal, generated.target_temporal_features, output),
        scoreRig(source.file, neutralRigProposal(), source.inputGainDb, generated.target_tone_features, controller.signal, generated.target_temporal_features)]);
      if (run === renderRun.current && !controller.signal.aborted) {
        if (result) { setDraft(candidate); setOutputLevelDb(output); setApplied(false); setRefinement(result); setAutomaticNotice("Local refinement and output check finished. Review the result, then Apply deliberately."); }
        setQuality({ candidate: score, neutral, key: JSON.stringify([candidate, output]) });
      }
    } catch (failure) {
      if (run === renderRun.current && !controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : "Rig rendering failed.");
        if (refine) setAutomaticNotice("Refinement did not complete. The original proposal remains available for a manual Check; no automatic retry or extra model request was made.");
      }
    } finally { if (run === renderRun.current) { busyRef.current = false; setBusy(false); } }
  }
  async function apply() {
    if (!draft || !recording || !generation?.rig_proposal || !quality?.candidate.safe || quality.key !== draftKey || busyRef.current || !active) return;
    const run = ++renderRun.current; busyRef.current = true; setBusy(true); setError("");
    try { await onApply(compileRigProposal(draft, recording.inputGainDb, outputLevelDb), generation.rig_proposal); if (run === renderRun.current) setApplied(true); }
    catch (failure) { if (run === renderRun.current) setError(failure instanceof Error ? failure.message : "Rig could not be applied."); }
    finally { if (run === renderRun.current) { busyRef.current = false; setBusy(false); } }
  }
  return <section className="result-panel" aria-labelledby="custom-rig-title">
    <span className="step">05 / CUSTOM RIG</span><h2 id="custom-rig-title">Match individual gear settings</h2>
    <p>Generate a custom chain and individual parameter values from your guitar source and confirmed passage. Automatically refine locally, then review before applying. No sound starts automatically.</p>
    {!recording && <p className="notice">Calibrate Live guitar or Guitar audio above first.</p>}
    {!available && <p className="notice">Rig generation is disabled until the backend has a key and a bounded approved allowance.</p>}
    <label><input type="checkbox" checked={automatic} disabled={busy || submitting || generation?.status === "generating"} onChange={event => setAutomatic(event.currentTarget.checked)} />Automatically refine after generation</label>
    <button disabled={!recording || !available || submitting || busy || generation?.status === "generating" || !active} onClick={() => void generate()}>{generation?.status === "failed" ? "Retry custom rig" : "Generate custom rig"}</button>
    <button className="secondary" disabled={busy || submitting || !active} onClick={() => setRefresh(value => value + 1)}>Reconnect rig status</button>
    {(submitting || generation?.status === "generating") && <p role="status">Generating individual gear settings…</p>}
    {generation?.status === "failed" && <p className="error" role="alert">{generation.error?.message}</p>}
    {automaticNotice && <p role="status">{automaticNotice}</p>}
    {draft && <><h3>{draft.name}</h3><p>{draft.description}</p><p className="hint">{generation?.rig_proposal?.provenance.model} · measured feature proposal · audible match unverified</p>
      <ol>{draft.modules.map((module, index) => { const model = getGearModel(module.model_id); return <li key={index}><strong>{model.name}{module.enabled ? "" : " (bypassed)"}</strong><p>{model.parameters.map(parameter => { const value = module.parameters[parameter.id]; return `${parameter.label}: ${typeof value === "number" ? Number(value.toFixed(3)) : typeof value === "boolean" ? value ? "On" : "Off" : value}${parameter.unit ? ` ${parameter.unit}` : ""}`; }).join(" · ")}</p></li>; })}</ol>
      <button className="secondary" disabled={busy || submitting || generation?.status === "generating" || !active} onClick={() => void check()}>Check custom rig</button>{" "}
      <button className="secondary" disabled={busy || submitting || generation?.status === "generating" || !active} onClick={() => void check(true)}>Refine individual settings locally</button>
      <button className="secondary" disabled={busy || submitting || generation?.status === "generating" || !active} onClick={() => { stop(); setAutomaticNotice("Original proposal restored. Check it before applying; automatic refinement will not restart."); setDraft(parseRigProposal(generation!.rig_proposal!.proposal)); setOutputLevelDb(-18); setRefinement(undefined); setQuality(undefined); setApplied(false); }}>Restore original proposal</button>
      {busy && <><p role="status">Rendering locally{renders ? ` · ${renders}/80 candidates` : ""}…</p><button className="stop" onClick={stop}>Cancel rendering</button></>}
      {refinement && <p>Training feature distance {refinement.before.toFixed(2)} → {refinement.after.toFixed(2)}. Separate-excerpt validation {refinement.validationBefore.toFixed(2)} → {refinement.validationAfter.toFixed(2)}. {refinement.retained ? "Validated refinement retained." : "No validated improvement; original settings retained."} {refinement.renders}/80 local renders · protected output {outputLevelDb.toFixed(1)} dB. Feature scores still need listening review.</p>}
      {quality && quality.key === draftKey && <p role="status">{!quality.candidate.safe ? "Output protection is heavily engaged; revise gain before applying." : quality.candidate.loss < quality.neutral.loss * .9 ? "Closer measured spectral balance than neutral; listen to verify." : "No clear spectral improvement over neutral; review or refine."} Rig {quality.candidate.loss.toFixed(2)} · neutral {quality.neutral.loss.toFixed(2)}. Lower is closer; this is not an accuracy percentage.</p>}
      <button disabled={busy || submitting || generation?.status === "generating" || !active || !quality?.candidate.safe || quality.key !== draftKey} onClick={() => void apply()}>Apply custom rig</button>
      {applied && <p className="success-state" role="status">Custom rig applied. Its individual controls are editable below. Use Play dry recording or live input to hear it.</p>}
    </>}
    {error && <p className="error" role="alert">{error}</p>}
    <p className="hint">Only numeric source descriptors go to Token Factory. Local refinement makes no AI requests. Different playing and separation bleed affect this proxy; the generated settings need listening review.</p>
  </section>;
}
