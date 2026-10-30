import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { AudioEngine } from "@modulo/audio";
import { parsePreset, type Preset } from "@modulo/contracts";
import schema from "../../../contracts/preset.schema.json";
import { auditionPreset } from "./auditionPreset";
import type { CalibratedRecording } from "./recordingCalibration";
import {calibrationKey} from "./recordingCalibration";
import {ToneQualityCheck} from "./ToneQualityCheck";
import {measureListeningLevels,type ListeningLevels} from "./listeningLevels";
import { apiJson, parsePresetGeneration, parseSeparationJob, type PresetGeneration } from "./separation";

export interface PresetAudition { stop(): void; prepareLiveInput?(): void; invalidateCalibration?(): void }
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
  const [levelMatch,setLevelMatch]=useState(true);
  const [listening,setListening]=useState<{key:string;levels:ListeningLevels}>();
  const playedFile=useRef(false);
  const engine = useRef<AudioEngine | null>(null);
  const audioRequest = useRef(0);
  const submittingRef = useRef(false);
  const currentCandidate = useRef("");
  const actionController = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const referenceChanged = useRef(onReferenceChanged);
  referenceChanged.current = onReferenceChanged;
  const sourceKey=calibrationKey(recording?.measurements);
  const auditionKey=sourceKey+JSON.stringify(draft?.parameters);
  const currentAudition=useRef(auditionKey);currentAudition.current=auditionKey;

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
  }, [sourceKey]);

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
        if (next?.status === "ready" && next.preset && calibrationKey(next.source_calibration) === sourceKey && currentCandidate.current !== next.request_id) {
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
  }, [jobId, revision, refresh, sourceKey]);

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
    engine.current.setListeningGains(0,0);playedFile.current=false;
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

  async function comparisonLevels():Promise<ListeningLevels|undefined>{
    if(!recording||!draft||!levelMatch)return;
    if(listening?.key===auditionKey)return listening.levels;
    const levels=await measureListeningLevels(recording.file,draft);
    if(alive.current&&currentAudition.current===auditionKey)setListening({key:auditionKey,levels});
    return levels;
  }

  async function compare(original: boolean) {
    if (!draft || !applied || startingAudio) return;
    const request=audioRequest.current,key=auditionKey;
    setStartingAudio(true);setError("");
    try{
      const levels=playedFile.current?await comparisonLevels():undefined;
      if(!alive.current||request!==audioRequest.current||key!==currentAudition.current)return;
      engine.current?.setListeningGains(levels?.originalDb??0,levels?.processedDb??0);
      setBypass(original);
      engine.current?.applyPreset(auditionPreset(draft, original));
      engine.current?.setBypass(original);
    }catch(failure){if(alive.current&&request===audioRequest.current)setError(errorMessage(failure));}
    finally{if(alive.current&&request===audioRequest.current)setStartingAudio(false);}
  }

  async function play(useFile: boolean) {
    if (!applied || !engine.current || startingAudio) return;
    if (useFile && !recording) { setError("Calibrate your live guitar above first."); return; }
    onPlay();
    const request = ++audioRequest.current;
    setStartingAudio(true); setPlaying("Starting…"); setError("");
    try {
      const key=auditionKey;
      const levels=useFile?await comparisonLevels():undefined;
      if(!alive.current||request!==audioRequest.current||key!==currentAudition.current){if(alive.current&&request===audioRequest.current)setPlaying("Stopped");return;}
      engine.current.setListeningGains(levels?.originalDb??0,levels?.processedDb??0);playedFile.current=useFile;
      const started = await (useFile && recording ? engine.current.playFile(recording.file) : engine.current.playTestSignal());
      if (alive.current && request === audioRequest.current) {
        setPlaying(started ? (useFile ? "Replaying your live calibration" : "Playing synthetic test signal") : "Stopped");
        playbackDuration.current = useFile && recording ? recording.measurements.duration_seconds : 2;
        setElapsed(0); setPlaybackStart(started ? performance.now() : null);
      }
    } catch (failure) { if (alive.current && request === audioRequest.current) { setPlaying("Stopped"); setError(errorMessage(failure)); } }
    finally { if (alive.current && request === audioRequest.current) setStartingAudio(false); }
  }

  return <section className="result-panel starting-preset" aria-labelledby="starting-preset-title"><span className="step">05 / STARTING PRESET</span><h2 id="starting-preset-title">Generate a starting preset</h2>
    <p className="warning-message">{recording ? <><strong>Your input level is calibrated; source spectral bands are measured.</strong> Generation uses source/target spectral balance over input gain {recording.inputGainDb.toFixed(1)} dB. Render and listen before accepting its tone.</> : <><strong>Calibrate your live guitar above first.</strong> New presets need measurements from your live instrument. Older saved presets may use target energy only.</>}</p>
    {available === false && <p className="notice" role="status">Generation is unavailable: configure the backend Nebius API key.</p>}
    {available && uncapped && <p className="hint" role="status">Manual generation is enabled without a dollar cap. New generations and deliberate retries can incur provider charges.</p>}
    <div className="preset-actions"><button disabled={!available || !recording || submitting || generation?.status === "generating" || (generation?.status === "ready" && calibrationKey(generation.source_calibration) === sourceKey)} onClick={() => void generate()}>{submitting || generation?.status === "generating" ? "Generating starting preset…" : generation?.status === "failed" ? "Retry generation" : "Generate starting preset"}</button><button className="secondary" disabled={submitting} onClick={() => { setError(""); setRefresh((value) => value + 1); }}>Reconnect preset status</button></div>
    {generation?.status === "generating" && <p role="status">Generating for the confirmed passage. Separation and its audio remain available.</p>}
    {generation?.status === "failed" && <p className="error" role="alert">{generation.error?.message} Retry is deliberate; another request can incur charges.</p>}
    {draft && generation?.status === "ready" && <><h3>{draft.name}</h3><p>{draft.description}</p><div className="provenance"><strong>{edited ? "Edited starting preset" : "AI starting preset"}</strong><span>{draft.provenance.provider} · {draft.provenance.model}</span></div><p className="hint">Quality flags: {draft.quality_flags.join(", ")}. Local edits do not establish a calibrated match.</p>
      <div className="controls">{controls.map(([key, label, step, unit]) => { const bounds = schema.properties.parameters.properties[key]; return <label key={key} htmlFor={`starting-${key}`}><span>{label}<output>{draft.parameters[key]} {unit}</output></span><input id={`starting-${key}`} type="range" min={bounds.minimum} max={bounds.maximum} step={step} value={draft.parameters[key]} onChange={(event) => edit(key, Number(event.target.value))} /></label>; })}</div>
      {recording&&generation.target_tone_features&&<ToneQualityCheck recording={recording} preset={draft} target={generation.target_tone_features} onRefined={preset=>{stop();setDraft(preset);setEdited(true);setApplied(false);}} />}
      <button onClick={apply}>Apply starting preset</button><p role="status">{applied ? onApplyPreset ? "Applied to the shared browser amp below. Use its controls, audition or live input; playback remains a separate action." : "Applied to the browser amp. Further edits update the amp; playback remains a separate action." : "Review or edit the controls, then Apply. Nothing is playing automatically."}</p>
      {!onApplyPreset && <>
      <div className="guitar-comparison" aria-labelledby="guitar-comparison-title">
        <span className="step">06 / YOUR GUITAR</span><h2 id="guitar-comparison-title">Compare original and rig</h2>
        <p>Replay the live notes and chords captured during calibration; switch modes while the same exercise continues.</p>
        <p className="hint">{recording ? `Selected: ${recording.originalName} · leading quiet audio skipped ${recording.skippedSeconds.toFixed(1)} s` : "Calibrate your connected guitar at the top of this page."}</p>
        <div className="preset-actions" role="group" aria-label="Guitar comparison mode">
          <button className={bypass ? "selected" : "secondary"} aria-pressed={bypass} disabled={!applied||startingAudio} onClick={() => void compare(true)}>Original guitar</button>
          <button className={!bypass ? "selected" : "secondary"} aria-pressed={!bypass} disabled={!applied||startingAudio} onClick={() => void compare(false)}>Rig applied</button>
        </div>
        <label className="toggle"><input type="checkbox" checked={levelMatch} onChange={event=>{stop();setLevelMatch(event.target.checked);setListening(undefined);engine.current?.setListeningGains(0,0);}} />Match listening levels</label>
        <p className="hint">{levelMatch?listening?.key===auditionKey?`Recording comparison matched to approximately ${listening.levels.rmsDbfs.toFixed(1)} dBFS RMS, with peak headroom.`:"Play to measure and match recording levels locally.":"Raw preset output levels; loudness can differ."} Only listening gain changes; preset parameters stay unchanged.</p>
        <div className="preset-actions"><button disabled={!applied || !recording || startingAudio} onClick={() => void play(true)}>Replay calibration exercise</button><button className="stop" disabled={!applied} onClick={stop}>Stop preset audio</button><button className="secondary" disabled={!applied || startingAudio} onClick={() => void play(false)}>Play test signal</button></div>
        <progress aria-label="Guitar playback progress" value={elapsed} max={playbackDuration.current || recording?.measurements.duration_seconds || 1} /><span> {elapsed.toFixed(1)} / {(playbackDuration.current || recording?.measurements.duration_seconds || 0).toFixed(1)} s</span>
        <p role="status">{playing} · {bypass ? "Original guitar — input boost, drive and EQ off" : "Rig applied — current preset effects"}</p>
        <p className="hint">Both modes keep output protection. Level matching applies to the recording, not the synthetic test signal. The captured live exercise replays only when you press Play.</p>
        <p className="hint">Audio stays in this browser; generation uses its numeric level/spectral measurements. The extracted song guitar above is the target; it is never fed through this rig. The test signal is synthetic.</p>
      </div></>}
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
