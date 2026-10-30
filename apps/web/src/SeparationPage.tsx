import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { apiJson, isJobId, parseSeparationJob, referenceBounds, type ReferencePassage, type SeparationJob } from "./separation";
import { ReferenceSelector } from "./ReferenceSelector";
import type { Preset } from "@modulo/contracts";
import { StartingPresetPanel, type PresetAudition } from "./StartingPresetPanel";
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

const message = (failure: unknown) => failure instanceof Error ? failure.message : "The local API could not complete this request.";
const timestamp = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;

function releasePlayer(player: HTMLAudioElement | null | undefined) {
  if (!player) return;
  player.pause(); player.removeAttribute("src"); player.load();
}

interface Props {
  embedded?: boolean;
  active?: boolean;
  onInputChosen?: (device: string, channel: 0 | 1) => void;
  initialJobId?: string;
  initialFile?: File;
  onJobChange?: (id: string, file: File | undefined, status: SeparationJob["status"] | "idle") => void;
  onApplyPreset?: (preset: Preset) => void;
  onApplyRig?: (rig: RigPreset, generated: GeneratedRig) => Promise<void>;
  onSourceChange?: (recording?: CalibratedRecording) => void;
  onStopAudio?: (track?: "mix" | "guitar" | "backing") => void;
  onInvalidatePreset?: () => void;
  ref?: Ref<PresetAudition>;
}

export function SeparationPage({ embedded = false, active = true, onInputChosen, initialJobId = "", initialFile, onJobChange, onApplyPreset, onApplyRig, onSourceChange, onStopAudio, onInvalidatePreset, ref }: Props) {
  const [file, setFile] = useState<File | undefined>(initialFile);
  const [backend, setBackend] = useState<"local" | "modal">("local");
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
  const presetAudition = useRef<PresetAudition | null>(null);
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
    presetAudition.current?.stop();
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
        setBackend(next.backend ?? "local");
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
        method: "POST", headers: { "Content-Type": /\.mp3$/i.test(file.name) ? "audio/mpeg" : "audio/wav", "Idempotency-Key": idempotency.current, "X-Separation-Backend": backend },
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
  const jobDescription = uploading ? "Preparing the selected audio for the configured processing service."
    : connectionLost ? "The job may still be running. Reconnect to check its current state."
    : job?.status === "ready" ? `${backend === "modal" ? "Cloud API" : "Local"} separation is ready. Review the extracted guitar and backing audio below.`
    : job?.status === "failed" ? job.error?.message ?? "The separation service returned an error."
    : job?.status === "running" ? `The ${backend === "modal" ? "cloud" : "local"} service is processing your song. Progress is shown only when the service reports it.`
    : job?.status === "queued" ? `Your song is queued for ${backend === "modal" ? "cloud" : "local"} separation.`
    : jobId ? "Checking the saved job without starting another separation."
    : "Upload a mixed song and choose Separate guitar to start.";

  const Container = embedded ? "div" : "main";
  return <Container className={embedded ? "separation-page" : "separation-page app-content"}>
    {!embedded && <><header className="hero"><div><a className="separation-brand" href="/">modulo <span>↗ Browser amp</span></a><span className="eyebrow">TONE WORKFLOW</span><h1>From song to your guitar.</h1><p>Calibrate your connected guitar, choose a target song, then compare your live exercise with the rig on or off. An instrument input is required for calibration.</p></div><div className="mode-badge"><strong>{backend === "modal" ? "Cloud API separation" : "Local separation"}</strong><span>Tone match remains unverified</span></div></header>
      <ol className="local-flow-guide"><li><strong>Calibrate your live guitar.</strong> Set your guitar’s starting input level.</li><li><strong>Choose a target song.</strong> Separate it and listen to the extracted guitar.</li><li><strong>Confirm a passage.</strong> Choose a suggestion or highlight a manual region.</li><li><strong>Generate and Apply.</strong> Add the song’s starting rig over your input calibration.</li><li><strong>Compare your guitar.</strong> Compare the captured live exercise with Original / Rig applied.</li></ol></>}
    <aside className="processing-banner" aria-label="Processing and privacy information">
      <span className="processing-banner-icon" aria-hidden="true">▦</span>
      <div><strong>{backend === "modal" ? "Cloud separation is selected." : "Local separation is selected."}</strong><p>{backend === "modal" ? "The configured API sends the song to a Modal worker and returns the separated audio to this browser." : "The configured API processes the song through its local separation service and hardware."}</p>
        <details><summary>Privacy, retention and preset generation</summary><p>The API keeps up to four jobs for 24 hours. Abandoned cloud jobs expire after 24–25 hours. Preset generation sends measured numeric descriptors—not raw audio—to the configured Nebius provider, and only when generation is requested.</p></details>
      </div>
    </aside>
    <GuitarCalibration ref={liveCalibration} active={active} onInputChosen={onInputChosen} onStart={() => { pausePlayers(); onStopAudio?.(); }} onChange={next => { pausePlayers(); invalidatePreset.current?.(); setRecording(next); onSourceChange?.(next); }} />
    <div className="workflow-grid">
      <section className="upload-panel separation-upload-panel" aria-labelledby="local-upload-title">
        <header className="panel-title"><span className="step">01 / SONG</span><h2 id="local-upload-title">Choose a mixed song</h2><p>Use audio you have permission to process. WAV or MP3, mono/stereo, 10 seconds–4:55.</p></header>
        <div className="processing-choice"><div className="workflow-card-heading"><span className="workflow-card-icon" aria-hidden="true">≋</span><div><h3>Separation processing</h3><p>Choose where the guitar separation should run.</p></div></div>
          <div className="segmented-control processing-segments" role="group" aria-label="Separation processing">
            <button type="button" disabled={processing || confirming} className={backend === "local" ? "segmented-option is-selected" : "segmented-option"} aria-pressed={backend === "local"} onClick={() => { if (backend !== "local") { chooseFile(file); setBackend("local"); } }}><span aria-hidden="true">▣</span>Local</button>
            <button type="button" disabled={processing || confirming} className={backend === "modal" ? "segmented-option is-selected" : "segmented-option"} aria-pressed={backend === "modal"} onClick={() => { if (backend !== "modal") { chooseFile(file); setBackend("modal"); } }}><span aria-hidden="true">☁</span>Cloud API</button>
          </div>
          <p className="processing-description">{backend === "modal" ? "Runs through the configured Modal cloud worker. Cloud access must be enabled by the API." : "Runs through the configured local separation service. Hardware availability is reported by the API."}</p>
        </div>
        <div className="song-upload"><div className="song-upload-heading"><span className="workflow-card-icon" aria-hidden="true">♫</span><div><h3>Mixed-song audio</h3><p>Selecting a file does not start processing.</p></div></div>
          <AudioFileDropzone accept="audio/wav,audio/mpeg,.wav,.mp3" disabled={processing || confirming} file={file} formats="WAV or MP3" help="WAV or MP3 · mono or stereo · 10 seconds–4:55 · up to 50 MiB" id="separation-file" maxBytes={50 * 1024 * 1024} readyLabel="ready to separate" onFile={chooseFile} />
        </div>
        <button className="separation-primary" disabled={!file || processing || confirming} onClick={() => void separate()}><span aria-hidden="true">✣</span>{uploading ? "Starting separation…" : job?.status === "failed" ? "Retry separation" : "Separate guitar"}</button>
        <p className="separation-note"><span aria-hidden="true">ⓘ</span>One separation job runs at a time. Separation does not generate a tone preset.</p>
      </section>
      <section className="progress-panel separation-status-panel" aria-labelledby="local-progress-title">
        <header className="panel-title"><span className="step">02 / SEPARATION</span><h2 id="local-progress-title">Job status</h2></header>
        <div className={`separation-state is-${jobState}`} role="status" aria-live="polite"><span className="separation-state-icon" aria-hidden="true">{jobState === "ready" ? "✓" : jobState === "failed" || jobState === "disconnected" ? "!" : jobState === "idle" ? "♫" : "◌"}</span><div><strong>{jobTitle}</strong><p>{jobDescription}</p></div>{!["idle", "ready", "failed", "disconnected"].includes(jobState) && <span className="job-spinner" aria-hidden="true" />}</div>
        {job?.status === "failed" && file && <button className="secondary status-action" disabled={processing} onClick={() => void separate()}>Retry separation</button>}
        {connectionLost && <button className="secondary status-action" onClick={() => setReconnect((value) => value + 1)}>Reconnect to job</button>}
        {result && <button className="secondary status-action" onClick={() => document.getElementById("separated-audio-title")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Review separated audio</button>}
        {jobId && <p className="job-detail">Job <code>{jobId}</code> · {embedded ? "saved with this project in this tab; refreshing clears in-tab projects." : "refreshing this tab reconnects to it."}</p>}
        {result && <p className="job-detail">{timestamp(result.duration_seconds)} · {result.sample_rate.toLocaleString()} Hz · {result.provenance.model} · {result.provenance.device}</p>}
        {!jobId && !uploading && <div className="separation-explainer"><h3>How it works</h3><p>The configured service extracts guitar audio while keeping the aligned mix and guitar-reduced backing.</p><ol><li><span>1</span><strong>Upload song</strong><small>Choose a mixed audio file.</small></li><li><span>2</span><strong>Run separation</strong><small>Process it using the selected service.</small></li><li><span>3</span><strong>Review result</strong><small>Listen and choose a reference passage.</small></li></ol></div>}
      </section>
    </div>
    {result && <section className="result-panel" aria-labelledby="separated-audio-title"><div className="result-heading"><div><span className="step">03 / LISTEN</span><h2 id="separated-audio-title">Compare the same passage</h2></div><span className="quality-badge warning">Separation quality unverified</span></div><p>The tracks share one gain and timeline. Play the backing alongside live input; Stop audio stops both. Recording captures your processed guitar. The backing does not pass through the guitar amp.</p><div className="players">{tracks.map(([name, title, description]) => <div key={name}><h3>{title}</h3><p>{description}</p><audio aria-label={title} controls preload="metadata" src={result.artifacts[name]} ref={(element) => { players.current[name] = element; }} onPlay={(event) => { onStopAudio?.(name); pausePlayers(event.currentTarget); }} onPause={(event) => { if (preview.current?.player === event.currentTarget) preview.current = null; }} onTimeUpdate={(event) => { if (preview.current?.player === event.currentTarget && event.currentTarget.currentTime >= preview.current.end) { event.currentTarget.pause(); } }} onError={() => setError("An audio artifact could not load. Reconnect to the job; it may have expired.")} />{name === "backing" && <button className="secondary" onClick={() => void playPassage(name)}>Play backing passage</button>}</div>)}</div>
      <div className="reference-selection"><span className="step">04 / REFERENCE</span><h2>Choose your reference passage</h2>
        <ReferenceSelector key={jobId} jobId={jobId} duration={result.duration_seconds} start={start} end={end} confirmed={Boolean(confirmed)} confirming={confirming}
          onChange={changeInterval} onPreview={(track) => void playPassage(track)} onStop={() => pausePlayers()} onConfirm={() => void confirmPassage()} />
        {confirmed && <div className="success-state" role="status"><strong>Reference confirmed: {timestamp(confirmed.start_seconds)}–{timestamp(confirmed.end_seconds)}</strong><p>{confirmed.explanation}</p><p>Quality flags: {confirmed.quality_flags.join(", ")}</p><p>Calibrate your connected guitar above to include source measurements in a new preset.</p></div>}
      </div>
    </section>}
    {result && confirmed && onApplyRig && <RigGenerationPanel key={`rig-${jobId}:${result.reference_revision ?? 0}`} ref={rigAudition} active={active} recording={recording} jobId={jobId} revision={result.reference_revision ?? 0} onApply={onApplyRig} onReferenceChanged={() => { pausePlayers(); onInvalidatePreset?.(); setConfirmed(null); setReconnect(value => value + 1); setError("The confirmed passage changed. Review it and confirm again."); }} />}
    {result && (confirmed ? <details open={!onApplyRig}><summary>Legacy six-control starting preset</summary><StartingPresetPanel key={`${jobId}:${result.reference_revision ?? 0}`} recording={recording} ref={presetAudition} jobId={jobId} revision={result.reference_revision ?? 0} onApplyPreset={onApplyPreset} onPlay={() => { pausePlayers(); onStopAudio?.(); }} onReferenceChanged={() => { pausePlayers(); onInvalidatePreset?.(); setConfirmed(null); setReconnect((value) => value + 1); setError("The confirmed passage changed. Review it and confirm again."); }} /></details> : <p className="notice">Confirm a passage to unlock rig generation and audition.</p>)}
    {result && <SongTabsPanel key={`tabs-${jobId}`} jobId={jobId} duration={result.duration_seconds} active={active} getPlayer={getBackingPlayer}
      onPlay={async () => { const player=players.current.backing;if(!player)throw Error("Backing player is unavailable.");preview.current=null;onStopAudio?.("backing");pausePlayers(player);await player.play(); }}
      onSeek={time => { preview.current=null;const player=players.current.backing;if(player)player.currentTime=time; }} />}
    {error && <p className="error" role="alert">{error}</p>}
    {!embedded && <footer>Measured starting rigs · render and listen · tone similarity unverified. <a href="/">Return to the browser amp</a></footer>}
  </Container>;
}
