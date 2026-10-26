import { useEffect, useMemo, useRef, useState } from "react";
import { AudioEngine } from "@modulo/audio";
import { parsePreset, type Preset } from "@modulo/contracts";
import example from "../../../fixtures/preset.example.json";
import { AppShell, type AppView } from "./AppShell";

const initialPreset = parsePreset(example);
const controls = [
  ["input_gain_db", "Input gain", -24, 12, 1, "dB"],
  ["drive", "Drive", 0, 1, 0.01, ""],
  ["bass_db", "Bass", -12, 12, 1, "dB"],
  ["mid_db", "Mid", -12, 12, 1, "dB"],
  ["treble_db", "Treble", -12, 12, 1, "dB"],
  ["master_gain_db", "Output level", -36, -6, 1, "dB"],
] as const;

const stages = [
  ["queued", "Queued", "Waiting for an analysis worker"],
  ["separating", "Separate guitar", "Creating a guitar stem"],
  ["selecting", "Select reference", "Finding a useful passage"],
  ["generating", "Generate preset", "Mapping measured features to controls"],
] as const;

type ActiveStage = (typeof stages)[number][0];
type JobStage = "idle" | ActiveStage | "ready" | "failed";
type FixtureOutcome = "ready" | "low_quality" | "failed";

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export function App() {
  const [view, setView] = useState<AppView>("workspace");
  const [preset, setPreset] = useState<Preset>(initialPreset);
  const [apiState, setApiState] = useState("Checking API…");
  const [audioState, setAudioState] = useState("Stopped");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [bypass, setBypass] = useState(false);
  const [songFile, setSongFile] = useState<File>();
  const [dryFile, setDryFile] = useState<File>();
  const [jobStage, setJobStage] = useState<JobStage>("idle");
  const [fixtureOutcome, setFixtureOutcome] = useState<FixtureOutcome>("ready");
  const engine = useRef<AudioEngine | null>(null);
  const jobRun = useRef(0);
  const jobRunning = useRef(false);
  const mixPlayer = useRef<HTMLAudioElement>(null);
  const referencePlayer = useRef<HTMLAudioElement>(null);
  const songUrl = useMemo(() => songFile ? URL.createObjectURL(songFile) : "", [songFile]);
  const processing = stages.some(([stage]) => stage === jobStage);
  const hasResult = jobStage === "ready";
  const currentStageIndex = stages.findIndex(([stage]) => stage === jobStage);

  useEffect(() => {
    const audio = new AudioEngine(initialPreset);
    audio.onEnded = () => setAudioState("Stopped");
    engine.current = audio;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    fetch("/api/health", { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((health) => {
        if (health.status !== "ok" || health.mode !== "scaffold") throw new Error();
        setApiState("API connected · scaffold mode");
      })
      .catch(() => { if (!controller.signal.aborted) setApiState("API unavailable · local fixture still works"); else setApiState("API check timed out · local fixture still works"); })
      .finally(() => window.clearTimeout(timeout));
    return () => { controller.abort(); jobRun.current++; void audio.dispose(); };
  }, []);

  useEffect(() => () => { if (songUrl) URL.revokeObjectURL(songUrl); }, [songUrl]);

  function changeControl(key: keyof Preset["parameters"], value: number) {
    const next = parsePreset({ ...preset, parameters: { ...preset.parameters, [key]: value } });
    engine.current?.applyPreset(next);
    setPreset(next);
  }

  function selectSong(nextFile?: File) {
    jobRun.current++;
    jobRunning.current = false;
    mixPlayer.current?.pause();
    referencePlayer.current?.pause();
    setSongFile(nextFile);
    setJobStage("idle");
    setError("");
  }

  async function runFixtureJob() {
    if (!songFile || jobRunning.current) return;
    jobRunning.current = true;
    const run = ++jobRun.current;
    setError("");
    try {
      for (const [stage] of stages) {
        if (run !== jobRun.current) return;
        setJobStage(stage);
        await wait(stage === "queued" ? 350 : 650);
      }
      if (run !== jobRun.current) return;
      if (fixtureOutcome === "failed") {
        setJobStage("failed");
        setError("Fixture failure: preset generation timed out. Retry this file or choose a different fixture outcome.");
        return;
      }
      setJobStage("ready");
      engine.current?.applyPreset(initialPreset);
      setPreset(initialPreset);
    } finally {
      if (run === jobRun.current) jobRunning.current = false;
    }
  }

  async function play(useFile: boolean) {
    setBusy(true);
    setError("");
    setAudioState("Starting…");
    try {
      mixPlayer.current?.pause();
      referencePlayer.current?.pause();
      const audio = engine.current!;
      const started = await (useFile && dryFile ? audio.playFile(dryFile) : audio.playTestSignal());
      setAudioState(started ? (useFile ? "Playing local dry recording" : "Playing synthetic test signal") : "Stopped");
    } catch (failure) {
      setAudioState("Stopped");
      setError(failure instanceof Error ? failure.message : "Audio could not start.");
    } finally { setBusy(false); }
  }

  async function loadApiExample() {
    setError("");
    try {
      const response = await fetch("/api/presets/example", { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("Start the local API to load its example preset.");
      const next = parsePreset(await response.json());
      engine.current?.applyPreset(next);
      setPreset(next);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load the preset."); }
  }

  function playSource(player: "mix" | "reference") {
    engine.current?.stop();
    setAudioState("Stopped");
    if (player === "mix") referencePlayer.current?.pause();
    else mixPlayer.current?.pause();
  }

  function navigate(nextView: AppView) {
    jobRun.current++;
    jobRunning.current = false;
    if (processing) setJobStage("idle");
    engine.current?.stop();
    mixPlayer.current?.pause();
    referencePlayer.current?.pause();
    setAudioState("Stopped");
    setView(nextView);
  }

  return <AppShell apiState={apiState} onNavigate={navigate} view={view}>
    {view === "workspace" && <div className="workspace-view">
      <section className="workspace-hero" aria-labelledby="workspace-heading">
        <div><span className="eyebrow">LOCAL WORKSPACE</span><h2 className="display-title" id="workspace-heading">Shape a playable tone,<br /><em>then make it yours.</em></h2><p>Continue the current fixture-labelled tone match or review its manual preset. This browser session is not a stored cloud project.</p></div>
        <button onClick={() => navigate("tone-match")}>Open tone match <span aria-hidden="true">→</span></button>
      </section>
      <div className="workspace-grid">
        <section aria-labelledby="session-heading"><div className="section-heading"><div><span className="step">CURRENT SESSION</span><h2 id="session-heading">Untitled local tone match</h2></div><span className="quality-badge">Fixture</span></div>
          <div className="session-summary"><span>Song</span><strong>{songFile?.name ?? "No song selected"}</strong><span>Analysis</span><strong>{hasResult ? "Fixture result ready" : processing ? "Fixture running" : "Not started"}</strong><span>Preset</span><strong>{preset.name} · manual</strong></div>
          <button className="secondary" onClick={() => navigate("tone-match")}>{songFile ? "Continue session" : "Start with a song"}</button>
        </section>
        <section aria-labelledby="milestones-heading"><span className="step">WORKFLOW STATUS</span><h2 id="milestones-heading">What is available</h2>
          <ul className="milestone-list"><li><span className="milestone-dot ready" /><span><strong>Fixture journey</strong><small>Upload, named stages, result states and manual preset</small></span></li><li><span className="milestone-dot ready" /><span><strong>Browser audition</strong><small>Synthetic signal or a local dry recording</small></span></li><li><span className="milestone-dot pending" /><span><strong>Live input controls</strong><small>Engine API exists; interface controls are the next UI milestone</small></span></li><li><span className="milestone-dot blocked" /><span><strong>Record and play along</strong><small>Waiting for recording and backing-track APIs</small></span></li></ul>
        </section>
      </div>
    </div>}

    {view === "tone-match" && <div className="tone-match-view">
      <header className="hero">
        <div><span className="eyebrow">FIXTURE WORKFLOW</span><h2 className="display-title">Find the sound.<br /><em>Make it yours.</em></h2><p>Walk through the upload-to-play journey before the real analysis service is connected.</p></div>
        <div className="mode-badge"><strong>Fixture mode</strong><span>No song data leaves this browser</span></div>
      </header>
      <p className="notice"><strong>Development fixture.</strong> Stage timing, stem/reference results and preset generation below are simulated. The selected song is only reused locally to exercise the player layouts; it is not separated or analysed.</p>

      <div className="workflow-grid">
        <section className="upload-panel" aria-labelledby="upload-title">
          <span className="step">01 / SONG</span><h2 id="upload-title">Choose a mixed song</h2><p>Use a rights-cleared WAV or MP3. This fixture flow keeps the file in your browser.</p>
          <label className="file-label" htmlFor="song-file">Mixed-song audio</label><input id="song-file" type="file" accept="audio/wav,audio/mpeg,.wav,.mp3" disabled={processing} onChange={(event) => selectSong(event.target.files?.[0])} />
          {songFile && <div className="file-summary"><strong>{songFile.name}</strong><span>{(songFile.size / (1024 * 1024)).toFixed(1)} MB · local only</span></div>}
          <label className="select-label" htmlFor="fixture-outcome">Fixture outcome</label><select id="fixture-outcome" value={fixtureOutcome} disabled={processing} onChange={(event) => setFixtureOutcome(event.target.value as FixtureOutcome)}><option value="ready">Ready result</option><option value="low_quality">Low-quality reference</option><option value="failed">Provider failure</option></select>
          <button className="primary-action" disabled={!songFile || processing} onClick={() => void runFixtureJob()}>{processing ? "Fixture job running…" : hasResult ? "Run fixture again" : "Start fixture analysis"}</button><p className="hint">The outcome selector is a development aid for testing success, warning and retry states.</p>
        </section>
        <section className="progress-panel" aria-labelledby="progress-title"><span className="step">02 / PROGRESS</span><h2 id="progress-title">Analysis stages</h2>
          <ol className="stage-list" aria-label="Fixture analysis progress">{stages.map(([stage, label, description], index) => { const complete = hasResult || currentStageIndex > index || jobStage === "failed"; const current = jobStage === stage; return <li key={stage} className={current ? "is-current" : complete ? "is-complete" : ""} aria-current={current ? "step" : undefined}><span className="stage-marker" aria-hidden="true">{complete ? "✓" : index + 1}</span><span><strong>{label}</strong><small>{description}</small></span></li>; })}</ol>
          {jobStage === "idle" && <p className="empty-state">Choose a song to preview the real job stages.</p>}{processing && <p className="job-state" role="status">Fixture job · {stages[currentStageIndex][1].toLowerCase()}…</p>}{jobStage === "failed" && <div className="failure-state"><strong>Fixture job failed</strong><p>No preset or analysis result was accepted.</p><button onClick={() => void runFixtureJob()}>Retry fixture job</button></div>}{hasResult && <p className="success-state" role="status">Fixture result ready. Review the passage and preset below.</p>}
        </section>
      </div>

      {hasResult && <section className="result-panel" aria-labelledby="result-title"><div className="result-heading"><div><span className="step">03 / REFERENCE</span><h2 id="result-title">Review the selected passage</h2></div><span className={fixtureOutcome === "low_quality" ? "quality-badge warning" : "quality-badge"}>{fixtureOutcome === "low_quality" ? "Low-quality fixture" : "Fixture result"}</span></div>{fixtureOutcome === "low_quality" && <p className="warning-message" role="status"><strong>Reference may be unreliable.</strong> The fixture represents heavy bleed and unstable tone. A real result should offer another passage or a new upload.</p>}<div className="players"><div><h3>Mixed-song preview</h3><p>Original local file.</p><audio ref={mixPlayer} controls preload="metadata" src={songUrl} onPlay={() => playSource("mix")}>Your browser does not support audio playback.</audio></div><div><h3>Guitar stem / reference layout</h3><p>Fixture placeholder · 00:42–00:57 · currently replays the original file.</p><audio ref={referencePlayer} controls preload="metadata" src={songUrl} onPlay={() => playSource("reference")}>Your browser does not support audio playback.</audio></div></div><div className="explanation"><span>Why this passage</span><p>Fixture explanation: stable energy and a clear sustained phrase made this 15-second window the strongest candidate. No measurements were performed in this browser flow.</p></div></section>}

      <div className="grid">
        <section aria-labelledby="amp-title"><span className="step">04 / PRESET</span><h2 id="amp-title">{preset.name}</h2><p>{preset.description}</p><div className="provenance"><strong>Manual fixture preset</strong><span>Not AI-generated · not tone-matched</span></div><div className="controls">{controls.map(([key, label, min, max, step, unit]) => <label key={key} htmlFor={key}><span>{label}<output>{preset.parameters[key]} {unit}</output></span><input id={key} type="range" min={min} max={max} step={step} value={preset.parameters[key]} onChange={(event) => changeControl(key, Number(event.target.value))} /></label>)}</div><button className="secondary" onClick={() => void loadApiExample()}>Load API example</button></section>
        <section aria-labelledby="audition-title"><span className="step">05 / AUDITION</span><h2 id="audition-title">Hear the browser amp</h2><p>Working gain, drive and EQ. Start at a comfortable listening level.</p><button disabled={busy} onClick={() => void play(false)}>Play test signal</button><p className="hint">A two-second synthesized pluck, not an isolated guitar or AI result.</p><label className="file-label" htmlFor="dry-file">Dry guitar recording · local audition only</label><input id="dry-file" type="file" accept="audio/*" onChange={(event) => setDryFile(event.target.files?.[0])} /><button className="secondary" disabled={!dryFile || busy} onClick={() => void play(true)}>Play dry recording</button><label className="toggle"><input type="checkbox" checked={bypass} onChange={(event) => { setBypass(event.target.checked); engine.current?.setBypass(event.target.checked); }} />Bypass drive and EQ</label><button className="stop" onClick={() => { engine.current?.stop(); setAudioState("Stopped"); }}>Stop audio</button><p role="status">{audioState}</p></section>
        <section aria-labelledby="live-title"><span className="step">06 / LIVE INPUT</span><h2 id="live-title">Connect your guitar</h2><p>The engine API is available, but device controls are outside this shell-only increment.</p><label className="select-label" htmlFor="device">Input device</label><select id="device" disabled><option>Controls coming in the next UI milestone</option></select><label className="select-label" htmlFor="channel">Channel</label><select id="channel" disabled><option>Channel selection pending</option></select><button disabled>Start live input</button><button className="stop" disabled>Mute / stop</button><p className="hint">No microphone permission is requested by this shell. Real interface capture and hardware acceptance remain open.</p></section>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <footer>Draft contract v1 · fixture data stays visibly labelled · no audio is uploaded by this frontend increment</footer>
    </div>}

    {view === "presets" && <section className="library-panel" aria-labelledby="preset-library-title"><div className="section-heading"><div><span className="step">SESSION PRESETS</span><h2 id="preset-library-title">Available in this browser</h2></div><span className="quality-badge">1 manual fixture</span></div><p>Preset storage and accounts are not implemented. This list contains only the currently loaded, validated preset.</p><article className="preset-row"><div className="preset-thumbnail" aria-hidden="true"><span>MOD</span></div><div><strong>{preset.name}</strong><span>{preset.description}</span></div><span className="manual-tag">Manual fixture</span><button className="secondary" onClick={() => navigate("tone-match")}>Open controls</button></article></section>}

    {view === "recordings" && <section className="availability-panel" aria-labelledby="recordings-title"><span className="availability-icon" aria-hidden="true">●</span><span className="step">NOT IMPLEMENTED</span><h2 id="recordings-title">No recordings yet</h2><p>The audio engine does not currently expose processed-guitar recording, preview, discard or download. This destination is reserved for that reviewed lifecycle; it does not show simulated takes.</p><button disabled>Start a recording</button><button className="secondary" onClick={() => navigate("tone-match")}>Return to Tone Match</button></section>}

    {view === "settings" && <section className="availability-panel" aria-labelledby="settings-title"><span className="availability-icon" aria-hidden="true">⚙</span><span className="step">LOCAL DEVELOPMENT</span><h2 id="settings-title">No account settings</h2><p>Modulo has no user accounts, cloud project storage or telemetry settings in this scaffold. Audio selected for the fixture path stays in the browser.</p><button className="secondary" onClick={() => navigate("workspace")}>Return to Workspace</button></section>}
  </AppShell>;
}
