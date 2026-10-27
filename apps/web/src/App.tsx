import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioEngine, type CalibrationFlag, type CalibrationTake, type InputLevel, type LiveInputInfo } from "@modulo/audio";
import { parsePreset, type Preset } from "@modulo/contracts";
import example from "../../../fixtures/preset.example.json";
import { AppShell, type AppView } from "./AppShell";
import { ChoiceMenu } from "./ChoiceMenu";
import { audioInputOptions, DEFAULT_AUDIO_INPUT, LiveRequestGate, liveInputErrorMessage, type AudioInputOption } from "./liveInput";
import { encodeMonoWav } from "./localAudio";
import { projectTitle, upsertProject } from "./projectSessions";

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
  ["queued", "Getting ready", "Preparing your demo session"],
  ["separating", "Find the guitar", "Preparing the guitar reference"],
  ["selecting", "Choose a passage", "Looking for a clear section"],
  ["generating", "Build the preset", "Turning tone details into controls"],
] as const;

type ActiveStage = (typeof stages)[number][0];
type JobStage = "idle" | ActiveStage | "ready" | "failed";
type FixtureOutcome = "ready" | "low_quality" | "failed";
type LiveState = "stopped" | "starting" | "live" | "error";
type CalibrationState = "idle" | "recording" | "complete" | "error";
type CalibrationPlaybackState = "stopped" | "starting" | "playing" | "error";
type EngineSource = "none" | "sample" | "live";

interface StoredProject {
  id: string;
  updatedAt: number;
  songFile?: File;
  dryFile?: File;
  jobStage: JobStage;
  fixtureOutcome: FixtureOutcome;
  preset: Preset;
  bypass: boolean;
  calibrationTake?: CalibrationTake;
}

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const levelDb = (value: number) => 20 * Math.log10(Math.max(value, 1e-8));
const meterPercent = (value: number) => Math.max(0, Math.min(100, ((levelDb(value) + 60) / 60) * 100));
const qualityFlagLabels: Record<CalibrationFlag, string> = {
  too_short: "The take is under 2 seconds.",
  silence: "The input is too quiet.",
  clipping: "The input clipped. Lower the interface gain.",
  invalid_samples: "The browser returned invalid audio samples.",
};

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
  const [inputDevices, setInputDevices] = useState<AudioInputOption[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [channel, setChannel] = useState<0 | 1>(0);
  const [deviceMessage, setDeviceMessage] = useState("Looking for audio inputs…");
  const [liveState, setLiveState] = useState<LiveState>("stopped");
  const [liveMessage, setLiveMessage] = useState("Stopped");
  const [liveInfo, setLiveInfo] = useState<LiveInputInfo>();
  const [inputLevel, setInputLevel] = useState<InputLevel | null>(null);
  const [calibrationState, setCalibrationState] = useState<CalibrationState>("idle");
  const [calibrationTake, setCalibrationTake] = useState<CalibrationTake>();
  const [calibrationMessage, setCalibrationMessage] = useState("Start live input, then record a clean dry chord for up to 10 seconds.");
  const [calibrationPlaybackState, setCalibrationPlaybackState] = useState<CalibrationPlaybackState>("stopped");
  const [activeProjectId, setActiveProjectId] = useState<string>(() => crypto.randomUUID());
  const [savedProjects, setSavedProjects] = useState<StoredProject[]>([]);
  const [sessionKey, setSessionKey] = useState(0);
  const engine = useRef<AudioEngine | null>(null);
  const jobRun = useRef(0);
  const jobRunning = useRef(false);
  const liveRequests = useRef(new LiveRequestGate());
  const calibrationRun = useRef(0);
  const engineSource = useRef<EngineSource>("none");
  const mixPlayer = useRef<HTMLAudioElement>(null);
  const referencePlayer = useRef<HTMLAudioElement>(null);
  const calibrationPlayer = useRef<HTMLAudioElement>(null);
  const songUrl = useMemo(() => songFile ? URL.createObjectURL(songFile) : "", [songFile]);
  const calibrationPlaybackUrl = useMemo(() => calibrationTake ? URL.createObjectURL(encodeMonoWav(calibrationTake.samples, calibrationTake.sampleRate)) : "", [calibrationTake]);
  const processing = stages.some(([stage]) => stage === jobStage);
  const hasResult = jobStage === "ready";
  const currentStageIndex = stages.findIndex(([stage]) => stage === jobStage);
  const inactiveProjects = savedProjects.filter((project) => project.id !== activeProjectId);

  const refreshInputDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setInputDevices([]);
      setSelectedDeviceId("");
      setDeviceMessage("Live input requires HTTPS or localhost in a supported browser.");
      return;
    }
    try {
      const options = audioInputOptions(await navigator.mediaDevices.enumerateDevices());
      setInputDevices(options);
      setSelectedDeviceId((current) => options.some((option) => option.deviceId === current) ? current : options[0]?.deviceId ?? "");
      setDeviceMessage(options.length ? "Choose your interface and input channel." : "No audio inputs found. Connect your interface, then refresh.");
    } catch (failure) {
      setInputDevices([]);
      setSelectedDeviceId("");
      setDeviceMessage(liveInputErrorMessage(failure));
    }
  }, []);

  useEffect(() => {
    const audio = new AudioEngine(initialPreset);
    audio.onEnded = () => {
      if (engineSource.current === "live") {
        liveRequests.current.cancel();
        calibrationRun.current++;
        setInputLevel(null);
        setCalibrationState("idle");
        setCalibrationTake(undefined);
        setCalibrationMessage("Input disconnected. Reconnect, start live input and record a new take.");
        setLiveState("stopped");
        setLiveMessage("Input disconnected. Refresh the list and start again after reconnecting.");
        void refreshInputDevices();
      }
      engineSource.current = "none";
      setAudioState("Stopped");
    };
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
    return () => {
      controller.abort();
      jobRun.current++;
      liveRequests.current.cancel();
      engineSource.current = "none";
      void audio.dispose();
    };
  }, [refreshInputDevices]);

  useEffect(() => {
    void refreshInputDevices();
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => { void refreshInputDevices(); };
    mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }, [refreshInputDevices]);

  useEffect(() => () => { if (songUrl) URL.revokeObjectURL(songUrl); }, [songUrl]);
  useEffect(() => () => { if (calibrationPlaybackUrl) URL.revokeObjectURL(calibrationPlaybackUrl); }, [calibrationPlaybackUrl]);

  useEffect(() => {
    if (view !== "tone-match" || liveState !== "live") {
      setInputLevel(null);
      return;
    }
    let frame = 0;
    let lastUpdate = 0;
    const readLevel = (time: number) => {
      if (time - lastUpdate >= 80) {
        setInputLevel(engine.current?.getInputLevel() ?? null);
        lastUpdate = time;
      }
      frame = window.requestAnimationFrame(readLevel);
    };
    frame = window.requestAnimationFrame(readLevel);
    return () => window.cancelAnimationFrame(frame);
  }, [liveState, view]);

  function stopCalibrationPlayback() {
    const player = calibrationPlayer.current;
    if (player) {
      player.pause();
      player.currentTime = 0;
    }
    setCalibrationPlaybackState("stopped");
  }

  function snapshotActiveProject(): StoredProject {
    return {
      id: activeProjectId,
      updatedAt: Date.now(),
      songFile,
      dryFile,
      jobStage: processing ? "idle" : jobStage,
      fixtureOutcome,
      preset,
      bypass,
      calibrationTake,
    };
  }

  function projectHasProgress(project: StoredProject): boolean {
    return Boolean(
      project.songFile
      || project.dryFile
      || project.jobStage !== "idle"
      || project.calibrationTake
      || project.bypass
      || project.preset.name !== initialPreset.name
      || controls.some(([key]) => project.preset.parameters[key] !== initialPreset.parameters[key]),
    );
  }

  function openProject(projectId: string) {
    const project = savedProjects.find((candidate) => candidate.id === projectId);
    if (!project) return;
    const current = snapshotActiveProject();
    if (projectHasProgress(current)) setSavedProjects((projects) => upsertProject(projects, current));

    jobRun.current++;
    jobRunning.current = false;
    stopEngineAudio();
    mixPlayer.current?.pause();
    referencePlayer.current?.pause();
    setActiveProjectId(project.id);
    setSongFile(project.songFile);
    setDryFile(project.dryFile);
    setJobStage(project.jobStage);
    setFixtureOutcome(project.fixtureOutcome);
    setPreset(project.preset);
    engine.current?.applyPreset(project.preset);
    setBypass(project.bypass);
    engine.current?.setBypass(project.bypass);
    setCalibrationTake(project.calibrationTake);
    setCalibrationState(project.calibrationTake ? "complete" : "idle");
    setCalibrationMessage(project.calibrationTake
      ? project.calibrationTake.usable ? "Saved calibration sample ready to review." : "Saved sample needs another try."
      : "Start live input, then record a clean dry chord for up to 10 seconds.");
    setLiveInfo(undefined);
    setInputLevel(null);
    setError("");
    setSessionKey((currentKey) => currentKey + 1);
    setView("tone-match");
  }

  function changeControl(key: keyof Preset["parameters"], value: number) {
    const next = parsePreset({ ...preset, parameters: { ...preset.parameters, [key]: value } });
    engine.current?.applyPreset(next);
    setPreset(next);
  }

  function stopEngineAudio(message = "Stopped") {
    liveRequests.current.cancel();
    calibrationRun.current++;
    const wasRecording = calibrationState === "recording";
    engineSource.current = "none";
    engine.current?.stop();
    stopCalibrationPlayback();
    setInputLevel(null);
    if (wasRecording) {
      setCalibrationState("idle");
      setCalibrationMessage("Capture stopped before finishing. Start live input to try again.");
    }
    setAudioState("Stopped");
    setLiveState("stopped");
    setLiveMessage(message);
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
    liveRequests.current.cancel();
    stopCalibrationPlayback();
    engineSource.current = "sample";
    setLiveState("stopped");
    setLiveMessage("Stopped — local audition took over the audio engine.");
    setBusy(true);
    setError("");
    setAudioState("Starting…");
    try {
      mixPlayer.current?.pause();
      referencePlayer.current?.pause();
      const audio = engine.current!;
      const started = await (useFile && dryFile ? audio.playFile(dryFile) : audio.playTestSignal());
      if (!started) engineSource.current = "none";
      setAudioState(started ? (useFile ? "Playing local dry recording" : "Playing synthetic test signal") : "Stopped");
    } catch (failure) {
      engineSource.current = "none";
      setAudioState("Stopped");
      setError(failure instanceof Error ? failure.message : "Audio could not start.");
    } finally { setBusy(false); }
  }

  async function startLiveInput() {
    if (!selectedDeviceId || !engine.current) return;
    const request = liveRequests.current.begin();
    if (request === undefined) return;
    engineSource.current = "live";
    stopCalibrationPlayback();
    mixPlayer.current?.pause();
    referencePlayer.current?.pause();
    setAudioState("Stopped");
    setError("");
    calibrationRun.current++;
    setCalibrationState("idle");
    setCalibrationTake(undefined);
    setCalibrationMessage("Once the level looks healthy, record one clean dry chord.");
    setLiveInfo(undefined);
    setLiveState("starting");
    setLiveMessage("Starting… Allow microphone access if your browser asks.");
    try {
      const deviceId = selectedDeviceId === DEFAULT_AUDIO_INPUT ? undefined : selectedDeviceId;
      const info = await engine.current.startLive(deviceId, channel);
      if (!liveRequests.current.settle(request)) return;
      if (info === false) {
        engineSource.current = "none";
        setLiveState("stopped");
        setLiveMessage("Stopped");
        return;
      }
      setLiveInfo(info);
      setLiveState("live");
      setLiveMessage(`Live · ${info.trackLabel || inputDevices.find((device) => device.deviceId === selectedDeviceId)?.label || "audio input"} · Input ${info.channel + 1}`);
      await refreshInputDevices();
    } catch (failure) {
      if (!liveRequests.current.settle(request)) return;
      engineSource.current = "none";
      setLiveState("error");
      setLiveMessage(liveInputErrorMessage(failure));
      await refreshInputDevices();
    }
  }

  async function recordCalibration() {
    if (liveState !== "live" || !engine.current || calibrationState === "recording") return;
    stopCalibrationPlayback();
    const run = ++calibrationRun.current;
    setCalibrationTake(undefined);
    setCalibrationState("recording");
    setCalibrationMessage("Recording dry input… Play one clean chord, then finish, or wait for 10 seconds.");
    try {
      const take = await engine.current.startCalibration(10);
      if (run !== calibrationRun.current) return;
      setCalibrationTake(take);
      setCalibrationState("complete");
      setCalibrationMessage(take.usable
        ? "Take captured. The local level check passed."
        : "This take needs another try. Review the notes below.");
    } catch (failure) {
      if (run !== calibrationRun.current) return;
      if (failure instanceof DOMException && failure.name === "AbortError") {
        setCalibrationState("idle");
        setCalibrationMessage("Take discarded. Record again when you’re ready.");
        return;
      }
      setCalibrationState("error");
      setCalibrationMessage(failure instanceof Error ? failure.message : "Calibration capture failed. Try again.");
    }
  }

  function finishCalibration() {
    if (calibrationState !== "recording") return;
    setCalibrationMessage("Finishing the take…");
    engine.current?.finishCalibration();
  }

  function discardCalibration(message = "Take discarded. Record again when you’re ready.") {
    calibrationRun.current++;
    engine.current?.cancelCalibration();
    stopCalibrationPlayback();
    setCalibrationTake(undefined);
    setCalibrationState("idle");
    setCalibrationMessage(message);
  }

  async function playCalibrationTake() {
    const player = calibrationPlayer.current;
    if (!player || !calibrationPlaybackUrl) return;
    if (calibrationPlaybackState === "playing") {
      stopCalibrationPlayback();
      return;
    }

    stopEngineAudio("Stopped — calibration review took over the audio output.");
    mixPlayer.current?.pause();
    referencePlayer.current?.pause();
    player.currentTime = 0;
    setCalibrationPlaybackState("starting");
    try {
      await player.play();
      setCalibrationPlaybackState("playing");
    } catch (failure) {
      setCalibrationPlaybackState("error");
      setCalibrationMessage(failure instanceof Error ? failure.message : "The calibration sample could not play.");
    }
  }

  function changeLiveDevice(deviceId: string) {
    discardCalibration("Input changed. Start live input and record a new take.");
    setSelectedDeviceId(deviceId);
  }

  function changeLiveChannel(value: string) {
    discardCalibration("Channel changed. Start live input and record a new take.");
    setChannel(Number(value) as 0 | 1);
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
    stopEngineAudio("Stopped — song preview took over the audio engine.");
    if (player === "mix") referencePlayer.current?.pause();
    else mixPlayer.current?.pause();
  }

  function navigate(nextView: AppView) {
    jobRun.current++;
    jobRunning.current = false;
    if (processing) setJobStage("idle");
    stopEngineAudio();
    mixPlayer.current?.pause();
    referencePlayer.current?.pause();
    setView(nextView);
  }

  function startNewToneMatch() {
    const currentProject = snapshotActiveProject();
    if (projectHasProgress(currentProject)) setSavedProjects((projects) => upsertProject(projects, currentProject));

    jobRun.current++;
    jobRunning.current = false;
    stopEngineAudio();
    mixPlayer.current?.pause();
    referencePlayer.current?.pause();
    setSongFile(undefined);
    setDryFile(undefined);
    setJobStage("idle");
    setFixtureOutcome("ready");
    setPreset(initialPreset);
    engine.current?.applyPreset(initialPreset);
    setBypass(false);
    engine.current?.setBypass(false);
    setError("");
    setLiveInfo(undefined);
    setInputLevel(null);
    discardCalibration("Start live input, then record a clean dry chord for up to 10 seconds.");
    setActiveProjectId(crypto.randomUUID());
    setSessionKey((current) => current + 1);
    setView("tone-match");
  }

  return <AppShell apiState={apiState} onNavigate={navigate} view={view}>
    {view === "workspace" && <div className="workspace-view">
      <section className="workspace-intro" aria-labelledby="workspace-heading">
        <div><span className="eyebrow">YOUR WORKSPACE</span><h2 id="workspace-heading">Good to see you.</h2><p>Continue your tone match or start with a new song.</p></div>
        <button onClick={startNewToneMatch}><span aria-hidden="true">＋</span> New Tone Match</button>
      </section>

      <section className="continue-section" aria-labelledby="continue-heading">
        <div className="section-heading"><div><span className="step">CONTINUE WORKING</span><h2 id="continue-heading">Your latest project</h2></div><span className="local-chip">Saved in this tab</span></div>
        <article className="project-card">
          <div className="amp-preview" aria-hidden="true"><div className="amp-grille" /><div className="amp-panel"><span /><span /><span /><span /></div></div>
          <div className="project-copy">
            <span className="project-kicker">LOCAL PROJECT</span>
            <h3>{projectTitle(songFile?.name)}</h3>
            <p>{preset.name} · Custom amp preset</p>
            <div className="project-meta"><span className={hasResult ? "state-dot complete" : "state-dot"} />{hasResult ? "Tone ready to preview" : processing ? "Building your demo tone" : songFile ? "Song added — ready to continue" : "No reference song added yet"}</div>
          </div>
          <div className="project-song"><span>Reference</span><strong>{songFile?.name ?? "Add a song"}</strong></div>
          <button onClick={() => navigate("tone-match")}>Continue <span aria-hidden="true">→</span></button>
        </article>
      </section>

      <section className="projects-section" aria-labelledby="projects-heading">
        <div className="section-heading"><div><span className="step">YOUR PROJECTS</span><h2 id="projects-heading">Recently updated</h2></div></div>
        {inactiveProjects.length > 0 && <div className="project-list">{inactiveProjects.map((project) => <article className="saved-project" key={project.id}><div className="saved-project-art" aria-hidden="true"><span>MOD</span></div><div><span className="project-kicker">SAVED IN THIS TAB</span><h3>{projectTitle(project.songFile?.name)}</h3><p>{project.songFile?.name ?? "No reference song"} · {project.jobStage === "ready" ? "Tone ready" : project.jobStage === "failed" ? "Needs attention" : project.calibrationTake ? "Calibration captured" : "In progress"}</p></div><button className="secondary" onClick={() => openProject(project.id)}>Open project</button></article>)}</div>}
        <div className="empty-projects"><div className="empty-art" aria-hidden="true"><span className="accent-coral" /><span className="accent-lavender" /><span className="accent-mint" /></div><div><h3>{inactiveProjects.length ? "Start another tone" : "Your next tone starts here"}</h3><p>{inactiveProjects.length ? "Your earlier projects stay available above while this tab remains open." : "Create another project when you’re ready to match a song’s guitar tone."}</p></div><button className="secondary" onClick={startNewToneMatch}>Start a project</button></div>
      </section>
    </div>}

    {view === "tone-match" && <div className="tone-match-view">
      <header className="hero">
        <div><span className="eyebrow">TONE MATCH</span><h2 className="display-title">Find the sound.<br /><em>Make it yours.</em></h2><p>Choose a song, review the reference and shape a playable preset.</p></div>
        <div className="mode-badge"><strong>Demo analysis</strong><span>Live guitar processing works locally</span></div>
      </header>
      <p className="notice"><strong>Guided demo.</strong> The analysis steps and result below are examples. Your selected song stays in this browser and is not separated or analysed.</p>

      <div className="workflow-grid">
        <section className="upload-panel" aria-labelledby="upload-title">
          <span className="step">01 / SONG</span><h2 id="upload-title">Choose a mixed song</h2><p>Use a rights-cleared WAV or MP3. This fixture flow keeps the file in your browser.</p>
          <label className="file-label" htmlFor="song-file">Mixed-song audio</label><input key={`song-${sessionKey}`} id="song-file" type="file" accept="audio/wav,audio/mpeg,.wav,.mp3" disabled={processing} onChange={(event) => selectSong(event.target.files?.[0])} />
          {songFile && <div className="file-summary"><strong>{songFile.name}</strong><span>{(songFile.size / (1024 * 1024)).toFixed(1)} MB · local only</span></div>}
          <label className="select-label" htmlFor="fixture-outcome">Demo result</label><ChoiceMenu id="fixture-outcome" value={fixtureOutcome} disabled={processing} onChange={(value) => setFixtureOutcome(value as FixtureOutcome)} options={[{ label: "Tone ready", value: "ready" }, { label: "Unclear reference", value: "low_quality" }, { label: "Couldn’t finish", value: "failed" }]} placeholder="Choose a demo result" />
          <button className="primary-action" disabled={!songFile || processing} onClick={() => void runFixtureJob()}>{processing ? "Building your demo tone…" : hasResult ? "Run demo again" : "Start tone match"}</button><p className="hint">Choose a result to preview the ready, warning and retry screens.</p>
        </section>
        <section className="progress-panel" aria-labelledby="progress-title"><span className="step">02 / PROGRESS</span><h2 id="progress-title">Analysis stages</h2>
          <ol className="stage-list" aria-label="Fixture analysis progress">{stages.map(([stage, label, description], index) => { const complete = hasResult || currentStageIndex > index || jobStage === "failed"; const current = jobStage === stage; return <li key={stage} className={current ? "is-current" : complete ? "is-complete" : ""} aria-current={current ? "step" : undefined}><span className="stage-marker" aria-hidden="true">{complete ? "✓" : index + 1}</span><span><strong>{label}</strong><small>{description}</small></span></li>; })}</ol>
          {jobStage === "idle" && <p className="empty-state">Add a song when you’re ready to begin.</p>}{processing && <p className="job-state" role="status">{stages[currentStageIndex][1]}…</p>}{jobStage === "failed" && <div className="failure-state"><strong>We couldn’t finish this demo</strong><p>Try again or choose a different result above.</p><button onClick={() => void runFixtureJob()}>Try again</button></div>}{hasResult && <p className="success-state" role="status">Your demo tone is ready to review.</p>}
        </section>
      </div>

      {hasResult && <section className="result-panel" aria-labelledby="result-title"><div className="result-heading"><div><span className="step">03 / REFERENCE</span><h2 id="result-title">Review the selected passage</h2></div><span className={fixtureOutcome === "low_quality" ? "quality-badge warning" : "quality-badge"}>{fixtureOutcome === "low_quality" ? "Needs another listen" : "Demo result"}</span></div>{fixtureOutcome === "low_quality" && <p className="warning-message" role="status"><strong>This section may be hard to match.</strong> In the finished flow, you’ll be able to choose another passage or upload a different song.</p>}<div className="players"><div><h3>Your song</h3><p>The original file from this browser.</p><audio ref={mixPlayer} controls preload="metadata" src={songUrl} onPlay={() => playSource("mix")}>Your browser does not support audio playback.</audio></div><div><h3>Guitar reference</h3><p>Demo passage · 00:42–00:57 · currently plays the original file.</p><audio ref={referencePlayer} controls preload="metadata" src={songUrl} onPlay={() => playSource("reference")}>Your browser does not support audio playback.</audio></div></div><div className="explanation"><span>Why this passage</span><p>This demo highlights a clear, sustained 15-second phrase. No audio measurements are performed yet.</p></div></section>}

      <div className="grid">
        <section aria-labelledby="amp-title"><span className="step">04 / PRESET</span><h2 id="amp-title">{preset.name}</h2><p>{preset.description}</p><div className="provenance"><strong>Demo preset</strong><span>Manually made · not generated from your song</span></div><div className="controls">{controls.map(([key, label, min, max, step, unit]) => <label key={key} htmlFor={key}><span>{label}<output>{preset.parameters[key]} {unit}</output></span><input id={key} type="range" min={min} max={max} step={step} value={preset.parameters[key]} onChange={(event) => changeControl(key, Number(event.target.value))} /></label>)}</div><button className="secondary" onClick={() => void loadApiExample()}>Load demo preset</button></section>
        <section aria-labelledby="audition-title"><span className="step">05 / AUDITION</span><h2 id="audition-title">Hear the browser amp</h2><p>Working gain, drive and EQ. Start at a comfortable listening level.</p><button disabled={busy} onClick={() => void play(false)}>Play test signal</button><p className="hint">A two-second synthesized pluck, not an isolated guitar or AI result.</p><label className="file-label" htmlFor="dry-file">Dry guitar recording · local audition only</label><input key={`dry-${sessionKey}`} id="dry-file" type="file" accept="audio/*" onChange={(event) => setDryFile(event.target.files?.[0])} /><button className="secondary" disabled={!dryFile || busy} onClick={() => void play(true)}>Play dry recording</button><label className="toggle"><input type="checkbox" checked={bypass} onChange={(event) => { setBypass(event.target.checked); engine.current?.setBypass(event.target.checked); }} />Bypass drive and EQ</label><button className="stop" onClick={() => stopEngineAudio()}>Stop audio</button><p role="status">{audioState}</p></section>
        <section aria-labelledby="live-title" className="live-panel">
          <span className="step">06 / LIVE INPUT</span><h2 id="live-title">Connect your guitar</h2>
          <p>Use a local audio interface to play through the same gain, drive, EQ and bypass controls. Song analysis above remains a guided demo.</p>
          <label className="select-label" htmlFor="device">Input device</label>
          <ChoiceMenu id="device" kind="device" searchable value={selectedDeviceId} disabled={!inputDevices.length || liveState === "starting" || liveState === "live"} onChange={changeLiveDevice} options={inputDevices.map((device) => ({ label: device.label, value: device.deviceId }))} placeholder="No audio inputs found" />
          <button className="secondary compact-action" disabled={liveState === "starting" || liveState === "live"} onClick={() => void refreshInputDevices()}>Refresh inputs</button>
          <label className="select-label" htmlFor="channel">Channel</label>
          <ChoiceMenu id="channel" value={String(channel)} disabled={!selectedDeviceId || liveState === "starting" || liveState === "live"} onChange={changeLiveChannel} options={[{ label: "Input 1", value: "0" }, { label: "Input 2", value: "1" }]} placeholder="Choose a channel" />
          <div className="live-actions"><button disabled={!selectedDeviceId || liveState === "starting" || liveState === "live"} onClick={() => void startLiveInput()}>Start live input</button><button className="stop" disabled={liveState !== "starting" && liveState !== "live"} onClick={() => stopEngineAudio()}>Stop</button></div>
          <p className="hint">{deviceMessage} Device names may appear after the first permission grant.</p>
          <p className={`live-status ${liveState}`} role="status"><strong>{liveState === "starting" ? "Starting" : liveState === "live" ? "Live" : liveState === "error" ? "Error" : "Stopped"}</strong><span>{liveMessage}</span></p>

          <div className="calibration" aria-labelledby="calibration-title">
            <div className="calibration-heading"><div><span className="step">INPUT CHECK</span><h3 id="calibration-title">Set a clean dry level</h3></div><span className={`calibration-chip ${calibrationState}`}>{calibrationState === "recording" ? "Recording" : calibrationState === "complete" ? calibrationTake?.usable ? "Ready" : "Retry" : calibrationState === "error" ? "Error" : liveState === "live" ? "Ready" : "Waiting"}</span></div>
            <p>Watch the meter while you play, then capture one chord. This checks local input quality only; it does not identify the chord or analyse tone.</p>
            <div className={`input-meter ${inputLevel?.clipping ? "is-clipping" : ""}`}>
              <div className="meter-label"><span>Dry input</span><output>{inputLevel ? `${levelDb(inputLevel.rms).toFixed(1)} dBFS` : "— dBFS"}</output></div>
              <div className="meter-track" role="meter" aria-label="Dry guitar input level" aria-valuemin={-60} aria-valuemax={0} aria-valuenow={inputLevel ? Math.round(levelDb(inputLevel.rms)) : undefined} aria-valuetext={inputLevel ? `${levelDb(inputLevel.rms).toFixed(1)} decibels full scale` : "No active input"}><span className="meter-zone" /><span className="meter-fill" style={{ width: `${inputLevel ? meterPercent(inputLevel.rms) : 0}%` }} /><span className="meter-peak" style={{ left: `${inputLevel ? meterPercent(inputLevel.peak) : 0}%` }} /></div>
              <div className="meter-scale"><span>−60</span><span>Good level</span><span>0</span></div>
            </div>
            {calibrationTake && <audio className="calibration-audio" ref={calibrationPlayer} src={calibrationPlaybackUrl} preload="metadata" onEnded={() => setCalibrationPlaybackState("stopped")} />}
            <div className="calibration-actions">
              {calibrationState === "idle" && <button disabled={liveState !== "live"} onClick={() => void recordCalibration()}>Record</button>}
              {calibrationState === "recording" && <><button onClick={finishCalibration}>Finish</button><button className="secondary" onClick={() => discardCalibration()}>Discard</button></>}
              {calibrationState === "complete" && <><button className="review-action" disabled={calibrationPlaybackState === "starting"} onClick={() => void playCalibrationTake()}>{calibrationPlaybackState === "playing" ? "Stop sample" : calibrationPlaybackState === "starting" ? "Starting…" : "Play sample"}</button><button disabled={liveState !== "live"} onClick={() => void recordCalibration()}>{liveState === "live" ? calibrationTake?.usable ? "Record again" : "Retry" : "Start live to record again"}</button><button className="secondary" onClick={() => discardCalibration()}>Discard</button></>}
              {calibrationState === "error" && <><button disabled={liveState !== "live"} onClick={() => void recordCalibration()}>Retry</button><button className="secondary" onClick={() => discardCalibration()}>Discard</button></>}
            </div>
            <p className={`calibration-status ${calibrationState}`} role="status">{calibrationMessage}</p>
            {calibrationTake && <div className={`take-summary ${calibrationTake.usable ? "usable" : "needs-retry"}`}><div><strong>{calibrationTake.durationSeconds.toFixed(1)} s take</strong><span>{calibrationTake.sampleRate} Hz · peak {levelDb(calibrationTake.level.peak).toFixed(1)} dBFS · RMS {levelDb(calibrationTake.level.rms).toFixed(1)} dBFS</span></div>{calibrationTake.usable ? <p>Input level looks usable for the next local calibration step.</p> : <ul>{calibrationTake.qualityFlags.map((flag) => <li key={flag}>{qualityFlagLabels[flag]}</li>)}</ul>}</div>}
            <p className="hint">This temporary sample stays in browser memory only. If you change the interface gain, guitar or pickup, discard it and calibrate again.</p>
          </div>

          {liveInfo && <dl className="capture-info"><div><dt>Capture sample rate</dt><dd>{liveInfo.settings.sampleRate ?? "unknown"}</dd></div><div><dt>Capture channels</dt><dd>{liveInfo.settings.channelCount ?? "unknown"}</dd></div><div><dt>Audio-context rate</dt><dd>{liveInfo.contextSampleRate}</dd></div><div><dt>Echo cancellation</dt><dd>{liveInfo.settings.echoCancellation === undefined ? "unknown" : liveInfo.settings.echoCancellation ? "on" : "off"}</dd></div><div><dt>Noise suppression</dt><dd>{liveInfo.settings.noiseSuppression === undefined ? "unknown" : liveInfo.settings.noiseSuppression ? "on" : "off"}</dd></div><div><dt>Automatic gain</dt><dd>{liveInfo.settings.autoGainControl === undefined ? "unknown" : liveInfo.settings.autoGainControl ? "on" : "off"}</dd></div>{liveInfo.baseLatencySeconds !== undefined && <div><dt>Browser base estimate</dt><dd>{(liveInfo.baseLatencySeconds * 1000).toFixed(1)} ms</dd></div>}{liveInfo.outputLatencySeconds !== undefined && <div><dt>Browser output estimate</dt><dd>{(liveInfo.outputLatencySeconds * 1000).toFixed(1)} ms</dd></div>}</dl>}
        </section>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <footer>Song analysis is simulated · live guitar and audition audio run locally in this browser</footer>
    </div>}

    {view === "presets" && <section className="library-panel" aria-labelledby="preset-library-title"><div className="section-heading"><div><span className="step">CURRENT TONE</span><h2 id="preset-library-title">Ready to play</h2></div><span className="quality-badge">1 demo preset</span></div><p>This demo keeps one preset in your current tab. Saving a library comes later.</p><article className="preset-row"><div className="preset-thumbnail" aria-hidden="true"><span>MOD</span></div><div><strong>{preset.name}</strong><span>{preset.description}</span></div><span className="manual-tag">Demo preset</span><button className="secondary" onClick={() => navigate("tone-match")}>Open controls</button></article></section>}

    {view === "recordings" && <section className="availability-panel" aria-labelledby="recordings-title"><span className="availability-icon coral" aria-hidden="true">●</span><span className="step">COMING SOON</span><h2 id="recordings-title">No recordings yet</h2><p>Recording isn’t available in Demo Mode, so you won’t see placeholder takes here.</p><button disabled>Start a recording</button><button className="secondary" onClick={() => navigate("tone-match")}>Return to Tone Match</button></section>}

    {view === "settings" && <section className="availability-panel" aria-labelledby="settings-title"><span className="availability-icon lavender" aria-hidden="true">⚙</span><span className="step">DEMO MODE</span><h2 id="settings-title">Nothing to configure yet</h2><p>There are no accounts or cloud settings in this demo. Your selected audio stays in this browser.</p><button className="secondary" onClick={() => navigate("workspace")}>Return to Workspace</button></section>}
  </AppShell>;
}
