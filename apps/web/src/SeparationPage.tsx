import { useEffect, useRef, useState } from "react";
import { apiJson, isJobId, parseSeparationJob, referenceBounds, type ReferencePassage, type SeparationJob } from "./separation";
import { StartingPresetPanel, type PresetAudition } from "./StartingPresetPanel";

const storageKey = "modulo.local-separation-job";
const tracks = [["mix", "Original mix", "Decoded original with the same gain as the separated tracks."], ["guitar", "Extracted guitar", "Combined guitar stem; separation may contain bleed or missing notes."], ["backing", "Guitar-reduced backing", "Sum of the aligned non-guitar stems; residual guitar may remain."]] as const;

function rememberJob(jobId: string) {
  try { if (jobId) sessionStorage.setItem(storageKey, jobId); else sessionStorage.removeItem(storageKey); } catch { /* Storage may be disabled; the current page still works. */ }
}

const message = (failure: unknown) => failure instanceof Error ? failure.message : "The local API could not complete this request.";
const timestamp = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;

export function SeparationPage() {
  const [file, setFile] = useState<File>();
  const [jobId, setJobId] = useState(() => {
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
  const presetAudition = useRef<PresetAudition | null>(null);
  const result = job?.status === "ready" ? job.result : undefined;
  const processing = uploading || Boolean(jobId && (!job || job.status === "queued" || job.status === "running"));

  function pausePlayers(except?: HTMLAudioElement) {
    presetAudition.current?.stop();
    Object.values(players.current).forEach((player) => { if (player && player !== except) player.pause(); });
  }

  useEffect(() => () => {
    uploadController.current?.abort();
    selectionController.current?.abort();
    Object.values(players.current).forEach((player) => player?.pause());
  }, []);

  useEffect(() => {
    const audio = Object.values(players.current);
    return () => audio.forEach((player) => player?.pause());
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
          setJobId(""); rememberJob(""); setJob(undefined); setConfirmed(null);
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
    pausePlayers();
    setJobId(""); rememberJob(""); setJob(undefined); setConfirmed(null); setConnectionLost(false); setError("");
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
    setUploading(true); setError(""); setJob(undefined); setJobId(""); rememberJob(""); setConfirmed(null);
    try {
      const next = await apiJson("/api/jobs", {
        method: "POST", headers: { "Content-Type": /\.mp3$/i.test(file.name) ? "audio/mpeg" : "audio/wav", "Idempotency-Key": idempotency.current },
        body: file, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(75000)]),
      });
      if (controller.signal.aborted) return;
      if (!isJobId(next.job_id)) throw new Error("The API did not return a valid job ID.");
      rememberJob(next.job_id); setJobId(next.job_id);
    } catch (failure) { if (!controller.signal.aborted) setError(message(failure)); }
    finally { submitting.current = false; if (!controller.signal.aborted) setUploading(false); }
  }

  function changeInterval(which: "start" | "end", value: string) {
    pausePlayers(); setConfirmed(null); setError("");
    if (which === "start") setStart(value); else setEnd(value);
  }

  async function confirmPassage() {
    if (!result || confirming) return;
    const controller = new AbortController();
    selectionController.current = controller;
    setConfirmed(null); setError("");
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
      pausePlayers(player); player.currentTime = interval.start_seconds;
      preview.current = { player, end: interval.end_seconds };
      await player.play();
    } catch (failure) { preview.current = null; setError(message(failure)); }
  }

  return <main className="separation-page app-content">
    <header className="hero"><div><a className="separation-brand" href="/">modulo <span>↗ Browser amp</span></a><span className="eyebrow">LOCAL TONE WORKFLOW</span><h1>Hear the guitar.<br />Choose your reference.</h1><p>Upload, separate, confirm a passage, then propose and edit a starting preset without an audio interface.</p></div><div className="mode-badge"><strong>Real local separation</strong><span>Starting presets remain uncalibrated</span></div></header>
    <p className="notice">Your song is sent to this laptop’s local API. Jobs expire after 24 hours; only four are kept. Separation stays local. Preset generation sends measured target energy, not audio, to Nebius only with a separate configured allowance.</p>
    <div className="workflow-grid">
      <section className="upload-panel" aria-labelledby="local-upload-title"><span className="step">01 / SONG</span><h2 id="local-upload-title">Choose a mixed song</h2><p>Use audio you have permission to process. WAV or MP3, mono/stereo, 10 seconds–4:55, up to 50 MiB.</p><label className="file-label" htmlFor="separation-file">Mixed-song audio</label><input id="separation-file" type="file" accept="audio/wav,audio/mpeg,.wav,.mp3" disabled={processing || confirming} onChange={(event) => chooseFile(event.target.files?.[0])} />{file && <p className="file-summary"><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(1)} MiB</span></p>}<button disabled={!file || processing || confirming} onClick={() => void separate()}>{uploading ? "Uploading…" : job?.status === "failed" ? "Retry separation" : "Separate guitar"}</button><p className="hint">One local job runs at a time. Separation does not generate a tone preset.</p></section>
      <section className="progress-panel" aria-labelledby="local-progress-title"><span className="step">02 / SEPARATION</span><h2 id="local-progress-title">Job status</h2><p className="job-state" role="status">{uploading ? "Uploading to this laptop…" : connectionLost ? "Connection lost — status unverified" : job?.status === "ready" ? "Separation ready — review the audio below" : job?.status === "failed" ? "Separation failed" : job?.status === "running" ? "Running local guitar separation…" : job?.status === "queued" ? "Queued for local separation…" : jobId ? "Reconnecting to your job…" : "Choose a song to begin."}</p>{job?.status === "failed" && <p className="error" role="alert">{job.error?.message}</p>}{connectionLost && <button className="secondary" onClick={() => setReconnect((value) => value + 1)}>Reconnect to job</button>}{jobId && <p className="hint">Job <code>{jobId}</code> · refreshing this tab reconnects to it.</p>}{result && <p className="hint">{timestamp(result.duration_seconds)} · {result.sample_rate.toLocaleString()} Hz · {result.provenance.model} · {result.provenance.device}</p>}</section>
    </div>
    {result && <section className="result-panel" aria-labelledby="separated-audio-title"><div className="result-heading"><div><span className="step">03 / LISTEN</span><h2 id="separated-audio-title">Compare the same passage</h2></div><span className="quality-badge warning">Separation quality unverified</span></div><p>The tracks share one gain and timeline. The backing plays directly and does not pass through the guitar amp.</p><div className="players">{tracks.map(([name, title, description]) => <div key={name}><h3>{title}</h3><p>{description}</p><audio aria-label={title} controls preload="metadata" src={result.artifacts[name]} ref={(element) => { players.current[name] = element; }} onPlay={(event) => pausePlayers(event.currentTarget)} onPause={(event) => { if (preview.current?.player === event.currentTarget) preview.current = null; }} onTimeUpdate={(event) => { if (preview.current?.player === event.currentTarget && event.currentTarget.currentTime >= preview.current.end) { event.currentTarget.pause(); } }} onError={() => setError("An audio artifact could not load. Reconnect to the job; it may have expired.")} /><button className="secondary" onClick={() => void playPassage(name)}>Play {name === "mix" ? "original" : name} passage</button></div>)}</div>
      <div className="reference-selection"><div><span className="step">04 / REFERENCE</span><h2>Confirm 10–20 seconds</h2><p>Listen first, then confirm whole-second start and end times. Changing either time clears the confirmation.</p>{result.suggestion && <p className="hint">Suggested passage: {timestamp(result.suggestion.start_seconds)}–{timestamp(result.suggestion.end_seconds)}. Energy ranking does not verify guitar presence or bleed.</p>}</div><div className="interval-fields"><label htmlFor="reference-start">Start · seconds<input id="reference-start" type="number" min="0" step="1" max={Math.floor(result.duration_seconds) - 10} value={start} disabled={confirming} onChange={(event) => changeInterval("start", event.target.value)} /></label><label htmlFor="reference-end">End · seconds<input id="reference-end" type="number" min="10" step="1" max={Math.floor(result.duration_seconds)} value={end} disabled={confirming} onChange={(event) => changeInterval("end", event.target.value)} /></label><button disabled={confirming} onClick={() => void confirmPassage()}>{confirming ? "Checking passage…" : "Confirm reference"}</button></div>{confirmed && <div className="success-state" role="status"><strong>Reference confirmed: {timestamp(confirmed.start_seconds)}–{timestamp(confirmed.end_seconds)}</strong><p>{confirmed.explanation}</p><p>Quality flags: {confirmed.quality_flags.join(", ")}</p><p>Reference checks measure energy only. Starting presets do not include source-guitar calibration.</p></div>}</div>
    </section>}
    {result && (confirmed ? <StartingPresetPanel key={`${jobId}:${result.reference_revision ?? 0}`} ref={presetAudition} jobId={jobId} revision={result.reference_revision ?? 0} onPlay={() => pausePlayers()} onReferenceChanged={() => { pausePlayers(); setConfirmed(null); setError("The confirmed passage changed. Review it and confirm again."); }} /> : <p className="notice">Confirm a passage to unlock starting-preset generation and audition.</p>)}
    {error && <p className="error" role="alert">{error}</p>}
    <footer>Uncalibrated starting presets · target energy only · tone similarity unverified. <a href="/">Return to the browser amp</a></footer>
  </main>;
}
