import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { compileRigProposal, parseRigProposal, type RigProposal, type RigPreset } from "@modulo/audio";
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
  const automatic = true;
  const [automaticNotice, setAutomaticNotice] = useState("");
  const gate = useRef(new AutomaticRigRefinement());
  const action = useRef<AbortController | null>(null), renderRun = useRef(0), submittingRef = useRef(false), busyRef = useRef(false);
  const sourceKey = calibrationKey(recording?.measurements), draftKey = JSON.stringify([draft, outputLevelDb]), lastCandidate = useRef("");
  const context = JSON.stringify([jobId, revision, sourceKey]);
  const changed = useRef(onReferenceChanged); changed.current = onReferenceChanged;
  function stop() {
    gate.current.cancel(); renderRun.current++; action.current?.abort();
    if (busyRef.current) setAutomaticNotice("Tone matching paused. Choose Finish matching to continue.");
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
      setAutomaticNotice(decision === "short" ? "Calibrate again and play for the full ten seconds."
        : decision === "manual" ? "Automatic refinement is off. Check or refine this proposal manually."
        : decision === "refine" ? "Matching your guitar to the selected sound…"
        : "A previous suggestion is available. Choose Finish matching to review it.");
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
      if (!controller.signal.aborted) {
        if (!rigSourceMatches(next, recording.measurements)) throw Error("The generated rig belongs to a different guitar source.");
        if (gate.current.acknowledge(ticket, context, next.request_id)) { receive(next); setRefresh(value => value + 1); }
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
        if (result) { setDraft(candidate); setOutputLevelDb(output); setApplied(false); setRefinement(result); setAutomaticNotice("Suggested tone ready. Use it, then listen and adjust to taste."); }
        setQuality({ candidate: score, neutral, key: JSON.stringify([candidate, output]) });
      }
    } catch (failure) {
      if (run === renderRun.current && !controller.signal.aborted) {
        setError(`${refine ? "Tone matching could not finish. " : ""}${failure instanceof Error ? failure.message : "Rig rendering failed."}`);
        if (refine) setAutomaticNotice("Choose Finish matching to try again with the existing suggestion.");
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
  return <section className="result-panel tone-suggestion" aria-labelledby="custom-rig-title">
    <span className="step">03 / MATCH TONE</span><h2 id="custom-rig-title">Make that sound yours</h2>
    <p>Match the song’s sound to your guitar. Listen before you play at full volume.</p>
    {!recording && <p className="notice">Connect and calibrate your guitar first.</p>}
    {!available && <p className="notice">Tone matching is unavailable. Check your song service connection.</p>}
    {!draft && <button disabled={!recording || !available || submitting || busy || generation?.status === "generating" || !active} onClick={() => void generate()}>{generation?.status === "failed" ? "Retry tone match" : submitting || generation?.status === "generating" ? "Matching tone…" : "Match tone"}</button>}
    {generation?.status === "failed" && <p className="error" role="alert">{generation.error?.message}</p>}
    {automaticNotice && <p role="status">{automaticNotice}</p>}
    {draft && <>
      <h3>{draft.name}</h3><span className="quality-badge">Suggested tone</span>
      {busy && <div className="matching-status" role="status"><span className="job-spinner" aria-hidden="true" />Matching your tone…<button className="stop" onClick={stop}>Cancel matching</button></div>}
      {!busy && !quality && <button className="secondary" disabled={!recording || !active} onClick={() => void check(true)}>Finish matching</button>}
      {quality && quality.key === draftKey && !quality.candidate.safe && <p className="error" role="alert">This suggestion is too loud to apply safely. Match again or adjust your input gain.</p>}
      {quality && quality.key === draftKey && quality.candidate.safe && <p className="hint">{quality.candidate.loss < quality.neutral.loss * .9 ? "Ready to try. Compare it with the reference by ear." : "This is an approximation. Listen and adjust the gear to taste."}</p>}
      <div className="button-row"><button disabled={busy || submitting || !active || !quality?.candidate.safe || quality.key !== draftKey} onClick={() => void apply()}>{applied ? "Tone in use" : "Use this tone"}</button><button className="text-action" disabled={busy || submitting || !active} onClick={() => void generate()}>Match again</button></div>
      {applied && <p className="success-state" role="status">Tone applied. Your signal chain is ready below.</p>}
    </>}
    {error && <p className="error" role="alert">{error} <button className="text-action" disabled={busy || submitting || !active} onClick={() => setRefresh(value => value + 1)}>Reconnect</button></p>}
  </section>;
}
