import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { apiJson, isJobId, parseSeparationJob, referenceBounds, type ReferencePassage, type SeparationJob } from "./separation";
import { ReferenceSelector } from "./ReferenceSelector";
import { type PresetAudition } from "./StartingPresetPanel";
import { GuitarCalibration, type LiveCalibrationControl } from "./GuitarCalibrationPanel";
import type { CalibratedRecording } from "./recordingCalibration";
import type { RigPreset } from "@modulo/audio";
import type { GeneratedRig } from "./rigGeneration";
import { RigGenerationPanel } from "./RigGenerationPanel";
import { AudioFileDropzone } from "./AudioFileDropzone";
import { SongTabsPanel } from "./SongTabsPanel";

const storageKey = "modulo.local-separation-job";
const tracks = [["mix", "Original mix", "Decoded original with the same gain as the separated tracks."], ["guitar", "Extracted guitar", "Combined guitar stem; separation may contain bleed or missing notes."], ["backing", "Guitar-reduced backing", "Sum of the aligned non-guitar stems; residual guitar may remain."]] as const;

function rememberJob(jobId: string) {
  try { if (jobId) sessionStorage.setItem(storageKey, jobId); else sessionStorage.removeItem(storageKey); } catch { /* Storage may be disabled; the current page still works. */ }
}

const message = (failure: unknown) => failure instanceof Error ? failure.message : "The song service could not complete this request.";
const timestamp = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;

function releasePlayer(player: HTMLAudioElement | null | undefined) {
  if (!player) return;
  player.pause(); player.removeAttribute("src"); player.load();
}

interface Props {
  embedded?: boolean;
  stage?: number;
  onStageChange?: (stage: number) => void;
  active?: boolean;
  onInputChosen?: (device: string, channel: 0 | 1) => void;
  initialJobId?: string;
  initialFile?: File;
  onJobChange?: (id: string, file: File | undefined, status: SeparationJob["status"] | "idle") => void;
  onApplyRig?: (rig: RigPreset, generated: GeneratedRig) => Promise<void>;
  onSourceChange?: (recording?: CalibratedRecording) => void;
  onStopAudio?: (track?: "mix" | "guitar" | "backing") => void;
  onBackingPlayerChange?: (player: HTMLAudioElement | null) => void;
  onInvalidatePreset?: () => void;
  ref?: Ref<PresetAudition>;
}

export function SeparationPage({ embedded = false, stage = 1, onStageChange, active = true, onInputChosen, initialJobId = "", initialFile, onJobChange, onApplyRig, onSourceChange, onStopAudio, onBackingPlayerChange, onInvalidatePreset, ref }: Props) {
  const [file, setFile] = useState<File | undefined>(initialFile);
  const [listeningTrack, setListeningTrack] = useState<"mix" | "guitar" | "backing">("guitar");
  const [recording, setRecording] = useState<CalibratedRecording>();
  const [jobId, setJobId] = useState(() => {
    if (embedded) return isJobId(initialJobId) ? initialJobId : "";
    try { const saved = sessionStorage.getItem(storageKey); return isJobId(saved) ? saved : ""; } catch { return ""; }
  });
  const [job, setJob] = useState<SeparationJob>();
  const [uploading, setUploading] = useState(false);
  const [reconnect, setReconnect] = useState(0);
  const [connectionLost, setConnectionLost] = useState(false);
  const [error, setError] = useState("");
  const [start, setStart] = useState("0");
  const [end, setEnd] = useState("15");
  const [confirmed, setConfirmed] = useState<ReferencePassage | null>(null);
  const [confirming, setConfirming] = useState(false);
  const idempotency = useRef("");
  const submitting = useRef(false);
  const uploadController = useRef<AbortController | null>(null);
  const selectionController = useRef<AbortController | null>(null);
  const players = useRef<Partial<Record<(typeof tracks)[number][0], HTMLAudioElement | null>>>({});
  const preview = useRef<{ player: HTMLAudioElement; end: number } | null>(null);
  const getBackingPlayer = useCallback(() => players.current.backing ?? undefined, []);
  const liveCalibration = useRef<LiveCalibrationControl | null>(null);
  const rigAudition = useRef<PresetAudition | null>(null);
  const result = job?.status === "ready" ? job.result : undefined;
  const processing = uploading || Boolean(jobId && (!job || job.status === "queued" || job.status === "running"));

  const jobChanged = useRef(onJobChange);
  jobChanged.current = onJobChange;
  const invalidatePreset = useRef(onInvalidatePreset);
  invalidatePreset.current = onInvalidatePreset;
  useEffect(() => { jobChanged.current?.(jobId, file, job?.status ?? (jobId ? "queued" : "idle")); }, [jobId, file, job?.status]);
  function saveJob(id: string) { if (!embedded) rememberJob(id); }
  useImperativeHandle(ref, () => ({ stop: () => pausePlayers(), prepareLiveInput: () => pausePlayers(players.current.backing), invalidateCalibration: () => liveCalibration.current?.invalidate() }));

  function pausePlayers(except?: HTMLAudioElement | null) {
    liveCalibration.current?.stop();
    rigAudition.current?.stop();
    Object.values(players.current).forEach((player) => { if (player && player !== except) player.pause(); });
  }

  useEffect(() => () => {
    uploadController.current?.abort();
    selectionController.current?.abort();
    Object.values(players.current).forEach(releasePlayer);
  }, []);

  useEffect(() => {
    const audio = Object.values(players.current);
    return () => audio.forEach(releasePlayer);
  }, [result?.artifacts.guitar]);

  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    let timer: number | undefined;
    setConnectionLost(false);
    async function poll() {
      try {
        const next = parseSeparationJob(await apiJson(`/api/jobs/${jobId}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }));
        if (controller.signal.aborted) return;
        if (next.job_id !== jobId) throw new Error("The API returned a different job. Reconnect before continuing.");
        setJob(next);
        setError("");
        if (next.status === "ready" && next.result) {
          const passage = next.result.reference ?? next.result.suggestion;
          setStart(String(passage?.start_seconds ?? 0));
          setEnd(String(passage?.end_seconds ?? Math.min(15, Math.floor(next.result.duration_seconds))));
          setConfirmed(next.result.reference);
        } else if (next.status !== "failed") timer = window.setTimeout(() => void poll(), 1000);
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (failure instanceof Error && "status" in failure && failure.status === 404) {
          pausePlayers(); invalidatePreset.current?.();
          setJobId(""); saveJob(""); setJob(undefined); setConfirmed(null);
          setError("This job is missing or expired. Choose a song to start again.");
          return;
        }
        setConnectionLost(true);
        setError(`${message(failure)} The job may still be running; reconnect to check it.`);
      }
    }
    void poll();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [jobId, reconnect]);

  function chooseFile(next?: File) {
    pausePlayers(); invalidatePreset.current?.();
    setJobId(""); saveJob(""); setJob(undefined); setConfirmed(null); setConnectionLost(false); setError("");
    idempotency.current = crypto.randomUUID();
    if (next && (!/\.(wav|mp3)$/i.test(next.name) || next.size === 0 || next.size > 50 * 1024 * 1024)) {
      setFile(undefined); setError("Choose a nonempty WAV or MP3 no larger than 50 MiB.");
    } else setFile(next);
  }

  async function separate() {
    if (!file || submitting.current || processing) return;
    submitting.current = true;
    const controller = new AbortController();
    uploadController.current = controller;
    if (job?.status === "failed" || !idempotency.current) idempotency.current = crypto.randomUUID();
    setUploading(true); setError(""); setJob(undefined); setJobId(""); saveJob(""); setConfirmed(null);
    try {
      const next = await apiJson("/api/jobs", {
        method: "POST", headers: { "Content-Type": /\.mp3$/i.test(file.name) ? "audio/mpeg" : "audio/wav", "Idempotency-Key": idempotency.current, "X-Separation-Backend": "modal" },
        body: file, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(75000)]),
      });
      if (controller.signal.aborted) return;
      if (!isJobId(next.job_id)) throw new Error("The API did not return a valid job ID.");
      saveJob(next.job_id); setJobId(next.job_id);
    } catch (failure) { if (!controller.signal.aborted) setError(message(failure)); }
    finally { submitting.current = false; if (!controller.signal.aborted) setUploading(false); }
  }

  function changeInterval(first: string, last: string) {
    pausePlayers(); invalidatePreset.current?.(); setConfirmed(null); setError("");
    setStart(first); setEnd(last);
  }

  async function confirmPassage() {
    if (!result || confirming) return;
    const controller = new AbortController();
    selectionController.current = controller;
    pausePlayers(); invalidatePreset.current?.(); setConfirmed(null); setError("");
    try {
      const interval = referenceBounds(start, end, result.duration_seconds);
      setConfirming(true);
      await apiJson(`/api/jobs/${jobId}/reference`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(interval), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
      const next = parseSeparationJob(await apiJson(`/api/jobs/${jobId}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }));
      if (!controller.signal.aborted) {
        const reference = next.result?.reference;
        if (!reference || reference.start_seconds !== interval.start_seconds || reference.end_seconds !== interval.end_seconds) throw new Error("The saved passage changed. Review its bounds and confirm again.");
        setConfirmed(reference);
        setJob(next);
        onStageChange?.(3);
      }
    } catch (failure) { if (!controller.signal.aborted) setError(message(failure)); }
    finally { if (!controller.signal.aborted) setConfirming(false); }
  }

  async function playPassage(name: (typeof tracks)[number][0]) {
    const player = players.current[name];
    if (!player || !result) return;
    try {
      const interval = referenceBounds(start, end, result.duration_seconds);
      onStopAudio?.(name); pausePlayers(player); player.currentTime = interval.start_seconds;
      preview.current = { player, end: interval.end_seconds };
      await player.play();
    } catch (failure) { preview.current = null; setError(message(failure)); }
  }

  const jobState = uploading ? "uploading" : connectionLost ? "disconnected" : job?.status ?? (jobId ? "reconnecting" : "idle");
  const jobTitle = uploading ? "Uploading your song"
    : connectionLost ? "Connection lost"
    : job?.status === "ready" ? "Guitar separation complete"
    : job?.status === "failed" ? "Separation could not finish"
    : job?.status === "running" ? "Separating the guitar"
    : job?.status === "queued" ? "Waiting to start"
    : jobId ? "Reconnecting to your job"
    : "Choose a song to begin.";
  const jobDescription = uploading ? "Keep this tab open while your song uploads."
    : connectionLost ? "Reconnect to check your song without starting again."
    : job?.status === "ready" ? "Listen to the guitar and select the sound you want."
    : job?.status === "failed" ? job.error?.message ?? "Please retry your song."
    : job?.status === "running" ? "Finding the guitar in your song…"
    : job?.status === "queued" ? "Your song will start shortly."
    : jobId ? "Checking your saved song…" : "Choose a song, then press Prepare song.";

  const Container = embedded ? "div" : "main";
  return <Container className={embedded ? "separation-page" : "separation-page app-content"}>
    <div hidden={stage !== 1}>
      <GuitarCalibration ref={liveCalibration} active={active && stage === 1} onInputChosen={onInputChosen} onStart={() => { pausePlayers(); onStopAudio?.(); }} onChange={next => { pausePlayers(); invalidatePreset.current?.(); setRecording(next); onSourceChange?.(next); }} />
      <div className="stage-next"><button disabled={!recording} onClick={() => onStageChange?.(2)}>Choose a song →</button><button className="text-action" onClick={() => onStageChange?.(2)}>Explore a song first</button></div>
    </div>
    <div hidden={stage !== 2}>
      <section className="result-panel song-setup" aria-labelledby="song-upload-title">
        <header className="panel-title"><span className="step">02 / CHOOSE SOUND</span><h2 id="song-upload-title">Find your reference sound</h2><p>Upload a song, listen to the guitar and choose a 10–20 second passage.</p></header>
        <AudioFileDropzone accept="audio/wav,audio/mpeg,.wav,.mp3" disabled={processing || confirming} file={file} formats="WAV or MP3" help="10 seconds–4:55 · up to 50 MB · use audio you have permission to process" id="separation-file" maxBytes={50 * 1024 * 1024} readyLabel="ready to prepare" onFile={chooseFile} />
        <button disabled={!file || processing || confirming} onClick={() => void separate()}>{uploading ? "Uploading…" : job?.status === "failed" ? "Retry song" : "Prepare song"}</button>
        {(jobId || uploading) && <div className={`separation-state is-${jobState}`} role="status"><span className="separation-state-icon" aria-hidden="true">{jobState === "ready" ? "✓" : jobState === "failed" || jobState === "disconnected" ? "!" : "◌"}</span><div><strong>{jobTitle}</strong><p>{jobDescription}</p></div></div>}
        {connectionLost && <button className="secondary" onClick={() => setReconnect(value => value + 1)}>Reconnect song</button>}
      </section>
    </div>
    {result && <section className="result-panel song-listening" hidden={stage !== 2 && stage !== 4} aria-labelledby="separated-audio-title">
      <div className="result-heading"><div><span className="step">{stage === 4 ? "PLAY ALONG" : "REFERENCE"}</span><h2 id="separated-audio-title">{stage === 4 ? "Your song" : "Choose the sound to match"}</h2></div><span className="quality-badge">{timestamp(result.duration_seconds)}</span></div>
      <div className="segmented-control track-switch" role="group" aria-label="Listen to song tracks">{tracks.map(([name]) => <button key={name} aria-pressed={listeningTrack === name} className={listeningTrack === name ? "segmented-option is-selected" : "segmented-option"} onClick={() => { pausePlayers(); setListeningTrack(name); }}>{name === "mix" ? "Song" : name === "guitar" ? "Guitar" : "Backing"}</button>)}</div>
      <div className="song-player">{tracks.map(([name, title]) => <div key={name} hidden={listeningTrack !== name}><audio aria-label={title} controls preload="metadata" src={result.artifacts[name]} ref={element => { players.current[name] = element; if (name === "backing") onBackingPlayerChange?.(element); }} onPlay={event => { onStopAudio?.(name); pausePlayers(event.currentTarget); }} onPause={event => { if (preview.current?.player === event.currentTarget) preview.current = null; }} onTimeUpdate={event => { if (preview.current?.player === event.currentTarget && event.currentTarget.currentTime >= preview.current.end) event.currentTarget.pause(); }} onError={() => setError("Song audio could not load. Reconnect; the song may have expired.")} /></div>)}</div>
      {listeningTrack === "backing" && <p className="hint">Some original guitar may remain in the backing. Use headphones.</p>}
      <div hidden={stage !== 2} className="reference-selection">
        <ReferenceSelector key={jobId} jobId={jobId} duration={result.duration_seconds} start={start} end={end} confirmed={Boolean(confirmed)} confirming={confirming} onChange={changeInterval} onPreview={track => void playPassage(track)} onStop={() => pausePlayers()} onConfirm={() => void confirmPassage()} />
        {confirmed && <p className="success-state" role="status">Sound selected: {timestamp(confirmed.start_seconds)}–{timestamp(confirmed.end_seconds)}</p>}
      </div>
    </section>}
    <div hidden={stage !== 3}>
      {result && confirmed && onApplyRig ? <RigGenerationPanel key={`rig-${jobId}:${result.reference_revision ?? 0}`} ref={rigAudition} active={active && stage === 3} recording={recording} jobId={jobId} revision={result.reference_revision ?? 0} onApply={onApplyRig} onReferenceChanged={() => { pausePlayers(); onInvalidatePreset?.(); setConfirmed(null); setReconnect(value => value + 1); setError("Your selected passage changed. Choose the sound again."); }} /> : <section className="result-panel"><h2>Choose your sound first</h2><p>Select a guitar passage from your song to start matching.</p><button onClick={() => onStageChange?.(2)}>Choose sound</button></section>}
      {confirmed && !recording && <button className="secondary" onClick={() => onStageChange?.(1)}>Connect and calibrate guitar</button>}
    </div>
    {result && <details hidden={stage !== 4} className="practice-tabs"><summary>Practice with full-song tabs</summary><SongTabsPanel key={`tabs-${jobId}`} jobId={jobId} duration={result.duration_seconds} active={active && stage === 4} getPlayer={getBackingPlayer}
      onPlay={async () => { const player = players.current.backing; if (!player) throw Error("Backing player is unavailable."); preview.current = null; onStopAudio?.("backing"); pausePlayers(player); await player.play(); }}
      onSeek={time => { preview.current = null; const player = players.current.backing; if (player) player.currentTime = time; }} /></details>}
    {error && <p className="error" role="alert">{error}</p>}
  </Container>;
}
