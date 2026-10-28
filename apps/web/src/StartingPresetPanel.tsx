import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { AudioEngine } from "@modulo/audio";
import { parsePreset, type Preset } from "@modulo/contracts";
import schema from "../../../contracts/preset.schema.json";
import { apiJson, parsePresetGeneration, parseSeparationJob, type PresetGeneration } from "./separation";

export interface PresetAudition { stop(): void }
interface Props {
  jobId: string;
  revision: number;
  onPlay: () => void;
  onReferenceChanged: () => void;
  onApplyPreset?: (preset: Preset) => void;
  ref?: Ref<PresetAudition>;
}

const controls = [
  ["input_gain_db", "Input gain", 0.1, "dB"], ["drive", "Drive", 0.01, ""],
  ["bass_db", "Bass", 0.1, "dB"], ["mid_db", "Mid", 0.1, "dB"],
  ["treble_db", "Treble", 0.1, "dB"], ["master_gain_db", "Output level", 0.1, "dB"],
] as const;

const errorMessage = (failure: unknown) => failure instanceof Error ? failure.message : "Starting-preset generation could not complete.";

export function StartingPresetPanel({ jobId, revision, onPlay, onReferenceChanged, onApplyPreset, ref }: Props) {
  const [generation, setGeneration] = useState<PresetGeneration>();
  const [draft, setDraft] = useState<Preset>();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(false);
  const [edited, setEdited] = useState(false);
  const [playing, setPlaying] = useState("Stopped");
  const [startingAudio, setStartingAudio] = useState(false);
  const [dryFile, setDryFile] = useState<File>();
  const [bypass, setBypass] = useState(false);
  const engine = useRef<AudioEngine | null>(null);
  const audioRequest = useRef(0);
  const submittingRef = useRef(false);
  const currentCandidate = useRef("");
  const actionController = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const referenceChanged = useRef(onReferenceChanged);
  referenceChanged.current = onReferenceChanged;

  function stop() {
    audioRequest.current++;
    engine.current?.stop();
    setStartingAudio(false); setPlaying("Stopped");
  }
  useImperativeHandle(ref, () => ({ stop }));

  useEffect(() => () => {
    alive.current = false; audioRequest.current++;
    actionController.current?.abort();
    const audio = engine.current; engine.current = null;
    void audio?.dispose();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    const signal = () => AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
    apiJson("/api/health", { signal: signal() }).then((health) => {
      if (!controller.signal.aborted) setAvailable(health.preset_generation_available === true);
    }).catch((failure) => { if (!controller.signal.aborted) { setAvailable(null); setError(errorMessage(failure)); } });
    async function poll() {
      try {
        const job = parseSeparationJob(await apiJson(`/api/jobs/${jobId}`, { signal: signal() }));
        if (controller.signal.aborted) return;
        if (job.job_id !== jobId || !job.result?.reference || (job.result.reference_revision ?? 0) !== revision) {
          referenceChanged.current(); return;
        }
        const next = job.generation;
        setGeneration(next);
        if (next?.status === "ready" && next.preset && currentCandidate.current !== next.request_id) {
          stop(); setApplied(false); setEdited(false); setBypass(false);
          engine.current?.setBypass(false); setDraft(parsePreset(next.preset));
          currentCandidate.current = next.request_id;
        }
        if (next?.status === "generating") timer = window.setTimeout(() => void poll(), 1000);
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (failure instanceof Error && "status" in failure && failure.status === 404) {
          referenceChanged.current(); return;
        }
        setError(`${errorMessage(failure)} Reconnect to check the existing attempt; it may still be running.`);
      }
    }
    void poll();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [jobId, revision, refresh]);

  async function generate() {
    if (submittingRef.current || generation?.status === "generating" || !available) return;
    submittingRef.current = true; setSubmitting(true); setError("");
    const controller = new AbortController(); actionController.current = controller;
    try {
      const value = await apiJson(`/api/jobs/${jobId}/preset`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference_revision: revision }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
      if (!controller.signal.aborted) { setGeneration(parsePresetGeneration(value, revision)); setRefresh((value) => value + 1); }
    } catch (failure) { if (!controller.signal.aborted) setError(`${errorMessage(failure)} Reconnect before retrying an ambiguous attempt.`); }
    finally { submittingRef.current = false; if (!controller.signal.aborted) setSubmitting(false); }
  }

  function apply() {
    if (!draft) return;
    onPlay(); stop();
    if (onApplyPreset) {
      onApplyPreset(parsePreset(draft));
      setApplied(true); setError("");
      return;
    }
    if (!engine.current) {
      const audio = new AudioEngine(draft);
      audio.onEnded = () => { if (alive.current && engine.current === audio) setPlaying("Stopped"); };
      engine.current = audio;
    }
    engine.current.applyPreset(draft); engine.current.setBypass(bypass);
    setApplied(true); setError("");
  }

  function edit(key: keyof Preset["parameters"], value: number) {
    if (!draft) return;
    const next = parsePreset({ ...draft, parameters: { ...draft.parameters, [key]: value } });
    setDraft(next); setEdited(true);
    if (onApplyPreset) setApplied(false);
    else if (applied) engine.current?.applyPreset(next);
  }

  async function play(useFile: boolean) {
    if (!applied || !engine.current || startingAudio) return;
    onPlay();
    const request = ++audioRequest.current;
    setStartingAudio(true); setPlaying("Starting…"); setError("");
    try {
      const started = await (useFile && dryFile ? engine.current.playFile(dryFile) : engine.current.playTestSignal());
      if (alive.current && request === audioRequest.current) setPlaying(started ? (useFile ? "Playing local dry recording" : "Playing synthetic test signal") : "Stopped");
    } catch (failure) { if (alive.current && request === audioRequest.current) { setPlaying("Stopped"); setError(errorMessage(failure)); } }
    finally { if (alive.current && request === audioRequest.current) setStartingAudio(false); }
  }

  return <section className="result-panel starting-preset" aria-labelledby="starting-preset-title"><span className="step">05 / STARTING PRESET</span><h2 id="starting-preset-title">Generate a starting preset</h2>
    <p className="warning-message"><strong>Missing guitar calibration.</strong> This starting proposal uses target energy only. Your dry guitar, spectral tone and audible similarity have not been analysed; tone matching is unverified.</p>
    {available === false && <p className="notice" role="status">Generation is disabled: a separate backend request/budget allowance is required. No new paid requests are enabled by this integration.</p>}
    <div className="preset-actions"><button disabled={!available || submitting || generation?.status === "generating" || generation?.status === "ready"} onClick={() => void generate()}>{submitting || generation?.status === "generating" ? "Generating starting preset…" : generation?.status === "failed" ? "Retry generation" : "Generate starting preset"}</button><button className="secondary" disabled={submitting} onClick={() => { setError(""); setRefresh((value) => value + 1); }}>Reconnect preset status</button></div>
    {generation?.status === "generating" && <p role="status">Generating for the confirmed passage. Separation and its audio remain available.</p>}
    {generation?.status === "failed" && <p className="error" role="alert">{generation.error?.message} Retry is deliberate; another request may consume allowance.</p>}
    {draft && generation?.status === "ready" && <><h3>{draft.name}</h3><p>{draft.description}</p><div className="provenance"><strong>{edited ? "Edited starting preset" : "AI starting preset"}</strong><span>{draft.provenance.provider} · {draft.provenance.model}</span></div><p className="hint">Quality flags: {draft.quality_flags.join(", ")}. Local edits do not establish a calibrated match.</p>
      <div className="controls">{controls.map(([key, label, step, unit]) => { const bounds = schema.properties.parameters.properties[key]; return <label key={key} htmlFor={`starting-${key}`}><span>{label}<output>{draft.parameters[key]} {unit}</output></span><input id={`starting-${key}`} type="range" min={bounds.minimum} max={bounds.maximum} step={step} value={draft.parameters[key]} onChange={(event) => edit(key, Number(event.target.value))} /></label>; })}</div>
      <button onClick={apply}>Apply starting preset</button><p role="status">{applied ? onApplyPreset ? "Applied to the shared browser amp below. Use its controls, audition or live input; playback remains a separate action." : "Applied to the browser amp. Further edits update the amp; playback remains a separate action." : "Review or edit the controls, then Apply. Nothing is playing automatically."}</p>
      {!onApplyPreset && <>
      <div className="preset-actions"><button disabled={!applied || startingAudio} onClick={() => void play(false)}>Play test signal</button><button className="stop" disabled={!applied} onClick={stop}>Stop preset audio</button></div><p className="hint">The test signal is synthetic, not a real guitar or a tone-match demonstration.</p><label className="file-label" htmlFor="preset-dry-file">Dry guitar recording · local audition only</label><input id="preset-dry-file" type="file" accept="audio/*" onChange={(event) => { stop(); setDryFile(event.target.files?.[0]); }} /><button className="secondary" disabled={!applied || !dryFile || startingAudio} onClick={() => void play(true)}>Play dry recording</button><p className="hint">A dry file stays in this browser and does not provide source calibration to the model. Reference and backing tracks are never amp inputs.</p><label className="toggle"><input type="checkbox" checked={bypass} disabled={!applied} onChange={(event) => { setBypass(event.target.checked); engine.current?.setBypass(event.target.checked); }} />Bypass drive and EQ</label><p role="status">{playing}</p></>}
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
