import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { compileRigProposal, getGearModel, parseRigProposal, type RigProposal, type RigPreset } from "@modulo/audio";
import { apiJson, parseSeparationJob } from "./separation";
import { parseRigGeneration, rigSourceMatches, type GeneratedRig, type RigGeneration } from "./rigGeneration";
import { calibrationKey, type CalibratedRecording } from "./recordingCalibration";
import { neutralRigProposal, refineRig, scoreRig, type RigScore } from "./refineRig";
import type { PresetAudition } from "./StartingPresetPanel";
import { AutomaticRigRefinement } from "./automaticRigRefinement";

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
  const [automatic, setAutomatic] = useState(true), [notice, setNotice] = useState("");
  const automaticRun = useRef(new AutomaticRigRefinement());
  const action = useRef<AbortController | null>(null), renderRun = useRef(0), submittingRef = useRef(false);
  const sourceKey = calibrationKey(recording?.measurements), draftKey = JSON.stringify([draft, outputLevelDb]), lastCandidate = useRef("");
  const changed = useRef(onReferenceChanged); changed.current = onReferenceChanged;
  function stop(cancelAutomatic = true) { if (cancelAutomatic) automaticRun.current.cancel(); renderRun.current++; action.current?.abort(); setBusy(false); }
  useImperativeHandle(ref, () => ({ stop: () => stop() }));
  useEffect(() => { if (!active) stop(); }, [active]);
  useEffect(() => { stop(); setDraft(undefined); setGeneration(undefined); setQuality(undefined); setRefinement(undefined); setApplied(false); setError(""); setNotice(""); lastCandidate.current = ""; }, [sourceKey]);
  useEffect(() => () => { automaticRun.current.cancel(); renderRun.current++; action.current?.abort(); }, []);
  function receive(next: RigGeneration, explicit = false) {
    if (!recording || !rigSourceMatches(next, recording.measurements)) return;
    setGeneration(next);
    if (next.status === "ready" && next.rig_proposal && (explicit || lastCandidate.current !== next.request_id)) {
      stop(false); setDraft(parseRigProposal(next.rig_proposal.proposal)); setOutputLevelDb(-18); setRefinement(undefined); setQuality(undefined); setApplied(false); lastCandidate.current = next.request_id;
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
        if (!job.result?.reference || job.result.reference_revision !== revision) { changed.current(); return; }
        if (job.generation?.kind === "rig_proposal") {
          const next = parseRigGeneration(job.generation, revision);
          receive(next);
          if (next.status === "generating") timer = window.setTimeout(() => void poll(), 1000);
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          if (failure instanceof Error && "status" in failure && failure.status === 404) changed.current();
          else setError(failure instanceof Error ? failure.message : "Could not reconnect to rig generation.");
        }
      }
    }
    void poll(); return () => { controller.abort(); window.clearTimeout(timer); };
  }, [jobId, revision, sourceKey, refresh, active]);
  async function generate() {
    if (!recording || submittingRef.current || busy || !active) return;
    stop(); submittingRef.current = true; setSubmitting(true); setError(""); setNotice("");
    const controller = new AbortController(); action.current = controller;
    try {
      const next = parseRigGeneration(await apiJson(`/api/jobs/${jobId}/rig`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference_revision: revision, source_calibration: recording.measurements }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }), revision);
      if (!controller.signal.aborted) {
        if (!rigSourceMatches(next, recording.measurements)) throw Error("The generated rig belongs to a different guitar source.");
        if (automatic) automaticRun.current.request(sourceKey, next.request_id);
        receive(next, true); setRefresh(value => value + 1);
      }
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Rig generation failed."); }
    finally { submittingRef.current = false; setSubmitting(false); }
  }
  async function check(refine = false) {
    if (!recording || !draft || !generation?.target_tone_features || busy || !active) return;
    const run = ++renderRun.current, controller = new AbortController(); action.current = controller;
    setBusy(true); setError(""); setNotice(""); setQuality(undefined); setRenders(0);
    try {
      let candidate = draft, output = outputLevelDb;
      let refined: Awaited<ReturnType<typeof refineRig>> | undefined;
      if (refine) {
        const result = await refineRig(recording.file, draft, recording.inputGainDb, generation.target_tone_features, { signal: controller.signal, temporal: generation.target_temporal_features, targetRmsDbfs: generation.target_rms_dbfs, targetWindows: generation.target_feature_windows, progress: count => { if (run === renderRun.current) setRenders(count); } });
        if (run !== renderRun.current) return;
        candidate = result.proposal; output = result.outputLevelDb; refined = result;
      }
      const [score, neutral] = await Promise.all([scoreRig(recording.file, candidate, recording.inputGainDb, generation.target_tone_features, controller.signal, generation.target_temporal_features, output),
        scoreRig(recording.file, neutralRigProposal(), recording.inputGainDb, generation.target_tone_features, controller.signal, generation.target_temporal_features)]);
      if (run === renderRun.current) {
        if (refined) { setDraft(candidate); setOutputLevelDb(output); setApplied(false); setRefinement(refined); }
        setQuality({ candidate: score, neutral, key: JSON.stringify([candidate, output]) });
      }
    } catch (failure) { if (run === renderRun.current && !controller.signal.aborted) setError(`${refine ? "Local refinement failed. Previous settings are unchanged; use Check custom rig to review them. " : ""}${failure instanceof Error ? failure.message : "Rig rendering failed."}`); }
    finally { if (run === renderRun.current) setBusy(false); }
  }
  useEffect(() => {
    if (!automatic || !active || busy || submitting || !recording || !generation || (generation.status === "ready" && (!draft || lastCandidate.current !== generation.request_id))) return;
    const next = automaticRun.current.consume(sourceKey, generation, recording.measurements.duration_seconds);
    if (next === "short") setNotice("Automatic refinement needs at least six seconds of clear guitar. Original settings are available; use Check custom rig, or calibrate a longer recording.");
    if (next === "refine") void check(true);
  }, [automatic, active, busy, submitting, recording, generation, draft, sourceKey]);
  async function apply() {
    if (!draft || !recording || !generation?.rig_proposal || !quality?.candidate.safe || quality.key !== draftKey || busy) return;
    const run = ++renderRun.current; setBusy(true); setError("");
    try { await onApply(compileRigProposal(draft, recording.inputGainDb, outputLevelDb), generation.rig_proposal); if (run === renderRun.current) setApplied(true); }
    catch (failure) { if (run === renderRun.current) setError(failure instanceof Error ? failure.message : "Rig could not be applied."); }
    finally { if (run === renderRun.current) setBusy(false); }
  }
  return <section className="result-panel" aria-labelledby="custom-rig-title">
    <span className="step">05 / CUSTOM RIG</span><h2 id="custom-rig-title">Match individual gear settings</h2>
    <p>Generate individual gear settings, refine them locally by default, then review and Apply when ready. Playback stays under your control.</p>
    {!recording && <p className="notice">Calibrate Live guitar or Guitar audio above first.</p>}
    {!available && <p className="notice">Rig generation is disabled until the backend has a key and a bounded approved allowance.</p>}
    <p><label><input type="checkbox" checked={automatic} disabled={busy || submitting} onChange={event => { setAutomatic(event.target.checked); if (!event.target.checked) automaticRun.current.cancel(); }} /> Refine automatically after generation</label></p>
    <button disabled={!recording || !available || submitting || busy || generation?.status === "generating" || !active} onClick={() => void generate()}>{generation?.status === "failed" ? "Retry custom rig" : "Generate custom rig"}</button>
    <button className="secondary" onClick={() => setRefresh(value => value + 1)}>Reconnect rig status</button>
    {(submitting || generation?.status === "generating") && <p role="status">Generating individual gear settings…</p>}
    {generation?.status === "failed" && <p className="error" role="alert">{generation.error?.message}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {draft && <><h3>{draft.name}</h3><p>{draft.description}</p><p className="hint">{generation?.rig_proposal?.provenance.model} · measured feature proposal · audible match unverified</p>
      <ol>{draft.modules.map((module, index) => { const model = getGearModel(module.model_id); return <li key={index}><strong>{model.name}{module.enabled ? "" : " (bypassed)"}</strong><p>{model.parameters.map(parameter => { const value = module.parameters[parameter.id]; return `${parameter.label}: ${typeof value === "number" ? Number(value.toFixed(3)) : typeof value === "boolean" ? value ? "On" : "Off" : value}${parameter.unit ? ` ${parameter.unit}` : ""}`; }).join(" · ")}</p></li>; })}</ol>
      <button className="secondary" disabled={busy || submitting || generation?.status === "generating" || !active} onClick={() => void check()}>Check custom rig</button>{" "}
      <button className="secondary" disabled={busy || submitting || generation?.status === "generating" || !active} onClick={() => void check(true)}>Refine individual settings locally</button>
      <button className="secondary" disabled={busy || submitting || generation?.status === "generating" || !active} onClick={() => { setDraft(parseRigProposal(generation!.rig_proposal!.proposal)); setOutputLevelDb(-18); setRefinement(undefined); setQuality(undefined); setApplied(false); }}>Restore original proposal</button>
      {busy && <><p role="status">Rendering locally{renders ? ` · ${renders}/80 candidates` : ""}…</p><button className="stop" onClick={() => { stop(); setNotice("Local rendering cancelled. Use Check custom rig or Refine individual settings locally when ready."); }}>Cancel rendering</button></>}
      {refinement && <p>Training feature distance {refinement.before.toFixed(2)} → {refinement.after.toFixed(2)}. Separate-excerpt validation {refinement.validationBefore.toFixed(2)} → {refinement.validationAfter.toFixed(2)}. {refinement.retained ? "Validated refinement retained." : "No validated improvement; original settings retained."} {refinement.renders}/80 local renders · protected output {outputLevelDb.toFixed(1)} dB. Feature scores still need listening review.</p>}
      {quality && quality.key === draftKey && <p role="status">{!quality.candidate.safe ? "Output protection is heavily engaged; revise gain before applying." : quality.candidate.loss < quality.neutral.loss * .9 ? "Closer measured spectral balance than neutral; listen to verify." : "No clear spectral improvement over neutral; review or refine."} Rig {quality.candidate.loss.toFixed(2)} · neutral {quality.neutral.loss.toFixed(2)}. Lower is closer; this is not an accuracy percentage.</p>}
      <button disabled={busy || submitting || generation?.status === "generating" || !active || !quality?.candidate.safe || quality.key !== draftKey} onClick={() => void apply()}>Apply custom rig</button>
      {applied && <p className="success-state" role="status">Custom rig applied. Its individual controls are editable below. Use Play dry recording or live input to hear it.</p>}
    </>}
    {error && <p className="error" role="alert">{error}</p>}
    <p className="hint">Only numeric source descriptors go to Token Factory. Local refinement makes no AI requests. Different playing and separation bleed affect this proxy; the generated settings need listening review.</p>
  </section>;
}
