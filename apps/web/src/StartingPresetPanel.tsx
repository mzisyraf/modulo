import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { AudioEngine } from "@modulo/audio";
import { parsePreset, type Preset } from "@modulo/contracts";
import schema from "../../../contracts/preset.schema.json";
import { auditionPreset } from "./auditionPreset";
import type { CalibratedRecording } from "./recordingCalibration";
import { apiJson, parsePresetGeneration, parseSeparationJob, type PresetGeneration } from "./separation";

export interface PresetAudition { stop(): void }
interface Props {
  jobId: string;
  revision: number;
  recording?: CalibratedRecording;
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

export function StartingPresetPanel({ jobId, revision, recording, onPlay, onReferenceChanged, onApplyPreset, ref }: Props) {
  const [generation, setGeneration] = useState<PresetGeneration>();
  const [draft, setDraft] = useState<Preset>();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [uncapped, setUncapped] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(false);
  const [edited, setEdited] = useState(false);
  const [playing, setPlaying] = useState("Stopped");
  const [startingAudio, setStartingAudio] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [playbackStart, setPlaybackStart] = useState<number | null>(null);
  const playbackDuration = useRef(0);
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
    setPlaybackStart(null);
  }
  useImperativeHandle(ref, () => ({ stop }));

  useEffect(() => {
    stop(); setDraft(undefined); setApplied(false); setEdited(false); setBypass(false);
    currentCandidate.current = "";
  }, [recording?.measurements.id]);

  useEffect(() => {
    if (playbackStart === null) return;
    const timer = window.setInterval(() => setElapsed(Math.min(playbackDuration.current, (performance.now() - playbackStart) / 1000)), 200);
    return () => window.clearInterval(timer);
  }, [playbackStart]);

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
      if (!controller.signal.aborted) {
        setAvailable(health.preset_generation_available === true);
        setUncapped(health.preset_budget_unlimited === true);
      }
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
        if (next?.status === "ready" && next.preset && next.source_calibration?.id === recording?.measurements.id && currentCandidate.current !== next.request_id) {
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
  }, [jobId, revision, refresh, recording?.measurements.id]);

  async function generate() {
    if (submittingRef.current || generation?.status === "generating" || !available || !recording) return;
    submittingRef.current = true; setSubmitting(true); setError("");
    const controller = new AbortController(); actionController.current = controller;
    try {
      const value = await apiJson(`/api/jobs/${jobId}/preset`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference_revision: revision, source_calibration: recording.measurements }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
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
      audio.onEnded = () => { if (alive.current && engine.current === audio) { setPlaying("Stopped"); setPlaybackStart(null); setElapsed(playbackDuration.current); } };
      engine.current = audio;
    }
    engine.current.applyPreset(auditionPreset(draft, bypass)); engine.current.setBypass(bypass);
    setApplied(true); setError("");
  }

  function edit(key: keyof Preset["parameters"], value: number) {
    if (!draft) return;
    const next = parsePreset({ ...draft, parameters: { ...draft.parameters, [key]: value } });
    setDraft(next); setEdited(true);
    if (onApplyPreset) setApplied(false);
    else if (applied) engine.current?.applyPreset(auditionPreset(next, bypass));
  }

  function compare(original: boolean) {
    if (!draft || !applied) return;
    setBypass(original);
    engine.current?.applyPreset(auditionPreset(draft, original));
    engine.current?.setBypass(original);
  }

  async function play(useFile: boolean) {
    if (!applied || !engine.current || startingAudio) return;
    if (useFile && !recording) { setError("Choose and calibrate your guitar recording above first."); return; }
    onPlay();
    const request = ++audioRequest.current;
    setStartingAudio(true); setPlaying("Starting…"); setError("");
    try {
      const started = await (useFile && recording ? engine.current.playFile(recording.file) : engine.current.playTestSignal());
      if (alive.current && request === audioRequest.current) {
        setPlaying(started ? (useFile ? "Playing your calibrated recording" : "Playing synthetic test signal") : "Stopped");
        playbackDuration.current = useFile && recording ? recording.measurements.duration_seconds : 2;
        setElapsed(0); setPlaybackStart(started ? performance.now() : null);
      }
    } catch (failure) { if (alive.current && request === audioRequest.current) { setPlaying("Stopped"); setError(errorMessage(failure)); } }
    finally { if (alive.current && request === audioRequest.current) setStartingAudio(false); }
  }

  return <section className="result-panel starting-preset" aria-labelledby="starting-preset-title"><span className="step">05 / STARTING PRESET</span><h2 id="starting-preset-title">Generate a starting preset</h2>
    <p className="warning-message">{recording ? <><strong>Your input level is calibrated.</strong> Generation adds the song’s starting rig over input gain {recording.inputGainDb.toFixed(1)} dB. Spectral tone and audible similarity remain unverified.</> : <><strong>Choose your recording above first.</strong> New presets need its input-level calibration. Older saved presets may use target energy only.</>}</p>
    {available === false && <p className="notice" role="status">Generation is disabled: a separate backend request/budget allowance is required. No new paid requests are enabled by this integration.</p>}
    {available && uncapped && <p className="hint" role="status">Manual generation is enabled without a dollar cap. New generations and deliberate retries can incur provider charges.</p>}
    <div className="preset-actions"><button disabled={!available || !recording || submitting || generation?.status === "generating" || (generation?.status === "ready" && generation.source_calibration?.id === recording.measurements.id)} onClick={() => void generate()}>{submitting || generation?.status === "generating" ? "Generating starting preset…" : generation?.status === "failed" ? "Retry generation" : "Generate starting preset"}</button><button className="secondary" disabled={submitting} onClick={() => { setError(""); setRefresh((value) => value + 1); }}>Reconnect preset status</button></div>
    {generation?.status === "generating" && <p role="status">Generating for the confirmed passage. Separation and its audio remain available.</p>}
    {generation?.status === "failed" && <p className="error" role="alert">{generation.error?.message} Retry is deliberate; another request may consume allowance.</p>}
    {draft && generation?.status === "ready" && <><h3>{draft.name}</h3><p>{draft.description}</p><div className="provenance"><strong>{edited ? "Edited starting preset" : "AI starting preset"}</strong><span>{draft.provenance.provider} · {draft.provenance.model}</span></div><p className="hint">Quality flags: {draft.quality_flags.join(", ")}. Local edits do not establish a calibrated match.</p>
      <div className="controls">{controls.map(([key, label, step, unit]) => { const bounds = schema.properties.parameters.properties[key]; return <label key={key} htmlFor={`starting-${key}`}><span>{label}<output>{draft.parameters[key]} {unit}</output></span><input id={`starting-${key}`} type="range" min={bounds.minimum} max={bounds.maximum} step={step} value={draft.parameters[key]} onChange={(event) => edit(key, Number(event.target.value))} /></label>; })}</div>
      <button onClick={apply}>Apply starting preset</button><p role="status">{applied ? onApplyPreset ? "Applied to the shared browser amp below. Use its controls, audition or live input; playback remains a separate action." : "Applied to the browser amp. Further edits update the amp; playback remains a separate action." : "Review or edit the controls, then Apply. Nothing is playing automatically."}</p>
      {!onApplyPreset && <>
      <div className="guitar-comparison" aria-labelledby="guitar-comparison-title">
        <span className="step">06 / YOUR GUITAR</span><h2 id="guitar-comparison-title">Compare original and rig</h2>
        <p>Play the same recording used for calibration, and switch modes while it continues from the same position.</p>
        <p className="hint">{recording ? `Selected: ${recording.originalName} · leading quiet audio skipped ${recording.skippedSeconds.toFixed(1)} s` : "Choose and calibrate your guitar recording at the top of this page."}</p>
        <div className="preset-actions" role="group" aria-label="Guitar comparison mode">
          <button className={bypass ? "selected" : "secondary"} aria-pressed={bypass} disabled={!applied} onClick={() => compare(true)}>Original guitar</button>
          <button className={!bypass ? "selected" : "secondary"} aria-pressed={!bypass} disabled={!applied} onClick={() => compare(false)}>Rig applied</button>
        </div>
        <div className="preset-actions"><button disabled={!applied || !recording || startingAudio} onClick={() => void play(true)}>Play guitar recording</button><button className="stop" disabled={!applied} onClick={stop}>Stop preset audio</button><button className="secondary" disabled={!applied || startingAudio} onClick={() => void play(false)}>Play test signal</button></div>
        <progress aria-label="Guitar playback progress" value={elapsed} max={playbackDuration.current || recording?.measurements.duration_seconds || 1} /><span> {elapsed.toFixed(1)} / {(playbackDuration.current || recording?.measurements.duration_seconds || 0).toFixed(1)} s</span>
        <p role="status">{playing} · {bypass ? "Original guitar — input boost, drive and EQ off" : "Rig applied — current preset effects"}</p>
        <p className="hint">Both modes keep the preset’s output level and output protection; loudness may differ. WAV/MP3 recommended, up to 20 MiB. Playback restarts only when you press Play.</p>
        <p className="hint">Audio stays in this browser; generation uses its numeric input-level calibration. The extracted song guitar above is the target; it is never fed through this rig. The test signal is synthetic.</p>
      </div></>}
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
