import { useCallback, useEffect, useRef, useState } from "react";
import { AudioEngine, type InputLevel, type LiveInputInfo, type RigPreset } from "@modulo/audio";

import { parsePreset, type Preset } from "@modulo/contracts";
import example from "../../../fixtures/preset.example.json";
import { AppShell, type AppView } from "./AppShell";
import { AudioFileDropzone } from "./AudioFileDropzone";
import { ChoiceMenu } from "./ChoiceMenu";
import { audioInputOptions, DEFAULT_AUDIO_INPUT, LiveRequestGate, liveInputErrorMessage, type AudioInputOption } from "./liveInput";
import { projectTitle, upsertProject } from "./projectSessions";
import { SeparationPage } from "./SeparationPage";
import type { PresetAudition } from "./StartingPresetPanel";
import "./separation.css";
import { RecordingLibrary } from "./RecordingLibrary";
import { addPerformanceRecording, createPerformanceRecording, type PerformanceRecording } from "./performanceRecordings";
import { ModelRigPanel } from "./ModelRigPanel";
import type { GeneratedRig } from "./rigGeneration";


const initialPreset = parsePreset(example);
const controls = [
  ["input_gain_db", "Input gain", -24, 12, 1, "dB"],
  ["drive", "Drive", 0, 1, 0.01, ""],
  ["bass_db", "Bass", -12, 12, 1, "dB"],
  ["mid_db", "Mid", -12, 12, 1, "dB"],
  ["treble_db", "Treble", -12, 12, 1, "dB"],
  ["master_gain_db", "Output level", -36, -6, 1, "dB"],
] as const;

type JobStage = "idle" | "queued" | "running" | "ready" | "failed";

type LiveState = "stopped" | "starting" | "live" | "error";
type PerformanceRecordingState = "idle" | "recording" | "finalizing" | "error";
type EngineSource = "none" | "sample" | "live";

interface StoredProject {
  id: string;
  updatedAt: number;
  songFile?: File;
  dryFile?: File;
  jobStage: JobStage;
  jobId: string;
  preset: Preset;
  rigPreset?: RigPreset;
  rigOrigin?: GeneratedRig;
  bypass: boolean;
}

const levelDb = (value: number) => 20 * Math.log10(Math.max(value, 1e-8));
export function App() {
  const [view, setView] = useState<AppView>("workspace");
  const [preset, setPreset] = useState<Preset>(initialPreset);
  const [modelRig, setModelRig] = useState<RigPreset | null>(null);
  const [rigOrigin, setRigOrigin] = useState<GeneratedRig>();
  const [apiState, setApiState] = useState("Checking API…");
  const [audioState, setAudioState] = useState("Stopped");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [bypass, setBypass] = useState(false);
  const [songFile, setSongFile] = useState<File>();
  const [dryFile, setDryFile] = useState<File>();
  const [jobStage, setJobStage] = useState<JobStage>("idle");
  const [jobId, setJobId] = useState("");
  const [inputDevices, setInputDevices] = useState<AudioInputOption[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [channel, setChannel] = useState<0 | 1>(0);
  const [deviceMessage, setDeviceMessage] = useState("Looking for audio inputs…");
  const [liveState, setLiveState] = useState<LiveState>("stopped");
  const [liveMessage, setLiveMessage] = useState("Stopped");
  const [liveInfo, setLiveInfo] = useState<LiveInputInfo>();
  const [inputLevel, setInputLevel] = useState<InputLevel | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string>(() => crypto.randomUUID());
  const [savedProjects, setSavedProjects] = useState<StoredProject[]>([]);
  const [recordings, setRecordings] = useState<PerformanceRecording[]>([]);
  const [performanceState, setPerformanceState] = useState<PerformanceRecordingState>("idle");
  const [performanceMessage, setPerformanceMessage] = useState("Start live input or an audition, then record your processed sound.");
  const [sessionKey, setSessionKey] = useState(0);
  const engine = useRef<AudioEngine | null>(null);
  const workflow = useRef<PresetAudition | null>(null);
  const audioRun = useRef(0);
  const rigRestoreRun = useRef(0);

  const liveRequests = useRef(new LiveRequestGate());
  const performanceRun = useRef(0);
  const performanceStateRef = useRef<PerformanceRecordingState>("idle");
  const engineSource = useRef<EngineSource>("none");
  const processing = jobStage === "queued" || jobStage === "running";
  const hasResult = preset.provenance.kind === "generated" || Boolean(modelRig && rigOrigin);
  const inactiveProjects = savedProjects.filter((project) => project.id !== activeProjectId);

  const updatePerformanceStatus = useCallback((state: PerformanceRecordingState, message: string) => {
    performanceStateRef.current = state;
    setPerformanceState(state);
    setPerformanceMessage(message);
  }, []);

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
    audio.onRigChange = setModelRig;
    audio.onRigError = message => { audio.onEnded?.(); setError(message); setLiveState("error"); setLiveMessage(message); };
    audio.onEnded = () => {
      if (performanceStateRef.current === "recording") {
        updatePerformanceStatus("finalizing", "The audio source stopped. Finalizing your take…");
      }
      if (engineSource.current === "live") {
        liveRequests.current.cancel();
        setInputLevel(null);
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
        setApiState(health.separation_available ? "API connected · separation available" : "API connected · separation unavailable");
      })
      .catch(() => { if (!controller.signal.aborted) setApiState("API unavailable · local amp still works"); else setApiState("API check timed out · local amp still works"); })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      controller.abort();
      audioRun.current++;
      rigRestoreRun.current++;

      liveRequests.current.cancel();
      performanceRun.current++;
      audio.cancelPerformanceRecording();
      audio.onRigChange = undefined;
      engineSource.current = "none";
      void audio.dispose();
    };
  }, [refreshInputDevices, updatePerformanceStatus]);

  useEffect(() => {
    void refreshInputDevices();
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => { void refreshInputDevices(); };
    mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }, [refreshInputDevices]);


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

  function snapshotActiveProject(): StoredProject {
    return {
      id: activeProjectId,
      updatedAt: Date.now(),
      songFile,
      dryFile,
      jobStage,
      jobId,
      preset,
      rigPreset: engine.current?.getRigPreset() ?? undefined,
      rigOrigin,
      bypass,
    };
  }

  function projectHasProgress(project: StoredProject): boolean {
    return Boolean(
      project.songFile
      || project.jobId
      || project.dryFile
      || project.jobStage !== "idle"
      || project.bypass
      || project.rigPreset
      || project.preset.name !== initialPreset.name
      || controls.some(([key]) => project.preset.parameters[key] !== initialPreset.parameters[key]),
    );
  }

  function markPerformanceFinalizing(message = "The audio source stopped. Finalizing your take…") {
    if (performanceStateRef.current === "recording") updatePerformanceStatus("finalizing", message);
  }

  function discardPerformanceRecording(message = "Take discarded. Record again when you’re ready.") {
    performanceRun.current++;
    engine.current?.cancelPerformanceRecording();
    updatePerformanceStatus("idle", message);
  }

  async function recordPerformance() {
    const audio = engine.current;
    if (!audio || engineSource.current === "none" || performanceStateRef.current === "recording" || performanceStateRef.current === "finalizing") return;

    const run = ++performanceRun.current;
    const details = {
      projectId: activeProjectId,
      projectTitle: projectTitle(songFile?.name),
      presetName: modelRig?.name ?? preset.name,
    };
    updatePerformanceStatus("recording", "Recording processed audio… Finish when you’re done, or discard this take.");
    try {
      const take = await audio.startPerformanceRecording();
      if (run !== performanceRun.current) return;
      const recording = createPerformanceRecording(take, details);
      setRecordings((current) => addPerformanceRecording(current, recording));
      const message = take.stopReason === "duration_limit"
        ? "The 3-minute limit was reached. Your take was saved."
        : take.stopReason === "source_stopped"
          ? "The audio source stopped. Your take was saved."
          : "Take saved to Recordings for playback or download.";
      updatePerformanceStatus("idle", message);
    } catch (failure) {
      if (run !== performanceRun.current) return;
      if (failure instanceof DOMException && failure.name === "AbortError") {
        updatePerformanceStatus("idle", "Take discarded. Record again when you’re ready.");
        return;
      }
      updatePerformanceStatus("error", failure instanceof Error ? failure.message : "The performance recording failed. Try again.");
    }
  }

  function finishPerformanceRecording() {
    if (performanceStateRef.current !== "recording") return;
    updatePerformanceStatus("finalizing", "Finalizing the recording so it can be played back…");
    engine.current?.finishPerformanceRecording();
  }

  function openProject(projectId: string) {
    const project = savedProjects.find((candidate) => candidate.id === projectId);
    if (!project) return;
    const current = snapshotActiveProject();
    if (projectHasProgress(current)) setSavedProjects((projects) => upsertProject(projects, current));

    discardPerformanceRecording("Ready to record a take for this project.");
    stopEngineAudio();
    setActiveProjectId(project.id);
    setSongFile(project.songFile);
    setDryFile(project.dryFile);
    setJobStage(project.jobStage);
    setJobId(project.jobId);
    setPreset(project.preset);
    setRigOrigin(project.rigOrigin);
    engine.current?.applyPreset(project.preset);
    const restore = ++rigRestoreRun.current;
    if (project.rigPreset) void engine.current?.applyRigPreset(project.rigPreset).catch(failure => { if (restore === rigRestoreRun.current) setError(failure instanceof Error ? failure.message : "Could not restore model rig."); });
    setBypass(project.bypass);
    engine.current?.setBypass(project.bypass);
    setError("");
    setSessionKey((currentKey) => currentKey + 1);
    setView("tone-match");
  }

  function stopEngineAudio(message = "Stopped", stopWorkflow = true) {
    audioRun.current++; setBusy(false);
    if (stopWorkflow) workflow.current?.stop();
    rigRestoreRun.current++;

    liveRequests.current.cancel();
    markPerformanceFinalizing();
    engineSource.current = "none";
    engine.current?.stop();
    setInputLevel(null);
    setAudioState("Stopped");
    setLiveState("stopped");
    setLiveMessage(message);
  }

  function applyStartingPreset(next: Preset) {
    stopEngineAudio();
    const validated = parsePreset(next);
    engine.current?.applyPreset(validated);
    engine.current?.setBypass(false);
    setPreset(validated); setBypass(false);
    setRigOrigin(undefined);
  }

  async function applyStartingRig(next: RigPreset, origin: GeneratedRig) {
    stopEngineAudio("Stopped — applying your custom rig.", false);
    const audio = engine.current, request = rigRestoreRun.current;
    if (!audio) throw Error("The audio engine is unavailable.");
    if (!await audio.applyRigPreset(next) || request !== rigRestoreRun.current) throw Error("Rig application was cancelled because the source or project changed.");
    audio.setBypass(false); setBypass(false); setRigOrigin(origin);
  }

  function invalidateStartingPreset() {
    stopEngineAudio();
    if (preset.provenance.kind === "generated" || rigOrigin) {
      engine.current?.applyPreset(initialPreset);
      setPreset(initialPreset);
      setRigOrigin(undefined);
    }
  }

  async function play(useFile: boolean) {
    stopEngineAudio();
    const run = ++audioRun.current;
    liveRequests.current.cancel();
    markPerformanceFinalizing("The previous audio source stopped. Finalizing your take…");
    engineSource.current = "sample";
    setLiveState("stopped");
    setLiveMessage("Stopped — local audition took over the audio engine.");
    setBusy(true);
    setError("");
    setAudioState("Starting…");
    try {
      workflow.current?.stop();
      const audio = engine.current!;
      const started = await (useFile && dryFile ? audio.playFile(dryFile) : audio.playTestSignal());
      if (run !== audioRun.current) return;
      if (!started) engineSource.current = "none";
      setAudioState(started ? (useFile ? "Playing local dry recording" : "Playing synthetic test signal") : "Stopped");
    } catch (failure) {
      if (run !== audioRun.current) return;
      engineSource.current = "none";
      setAudioState("Stopped");
      setError(failure instanceof Error ? failure.message : "Audio could not start.");
    } finally { if (run === audioRun.current) setBusy(false); }
  }

  async function startLiveInput() {
    if (!selectedDeviceId || !engine.current) return;
    const request = liveRequests.current.begin();
    if (request === undefined) return;
    audioRun.current++; setBusy(false);
    markPerformanceFinalizing("The previous audio source stopped. Finalizing your take…");
    engineSource.current = "live";
    workflow.current?.prepareLiveInput?.();
    setAudioState("Stopped");
    setError("");
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

  function changeLiveDevice(deviceId: string) {
    workflow.current?.invalidateCalibration?.();
    setSelectedDeviceId(deviceId);
  }

  function changeLiveChannel(value: string) {
    workflow.current?.invalidateCalibration?.();
    setChannel(Number(value) as 0 | 1);
  }

  function navigate(nextView: AppView) {
    stopEngineAudio();
    setView(nextView);
  }

  function startNewToneMatch() {
    const currentProject = snapshotActiveProject();
    if (projectHasProgress(currentProject)) setSavedProjects((projects) => upsertProject(projects, currentProject));

    discardPerformanceRecording("Ready to record a take for your new project.");
    stopEngineAudio();
    setSongFile(undefined);
    setDryFile(undefined);
    setJobStage("idle");
    setJobId("");
    setPreset(initialPreset);
    setRigOrigin(undefined);
    engine.current?.applyPreset(initialPreset);
    setBypass(false);
    engine.current?.setBypass(false);
    setError("");
    setLiveInfo(undefined);
    setInputLevel(null);
    setActiveProjectId(crypto.randomUUID());
    setSessionKey((current) => current + 1);
    setView("tone-match");
  }

  return <AppShell apiState={apiState} onNavigate={navigate} view={view}>
    {view === "workspace" && <div className="workspace-view">
      <section className="workspace-intro" aria-labelledby="workspace-heading">
        <div><span className="eyebrow">YOUR WORKSPACE</span><h2 id="workspace-heading">Good to see you.</h2><p>Continue your tone match or start with a new song.</p></div>
        <button onClick={startNewToneMatch}><span aria-hidden="true">ï¼‹</span> New Tone Match</button>
      </section>

      <section className="continue-section" aria-labelledby="continue-heading">
        <div className="section-heading"><div><span className="step">CONTINUE WORKING</span><h2 id="continue-heading">Your latest project</h2></div><span className="local-chip">Saved in this tab</span></div>
        <article className="project-card">
          <div className="amp-preview" aria-hidden="true"><div className="amp-grille" /><div className="amp-panel"><span /><span /><span /><span /></div></div>
          <div className="project-copy">
            <span className="project-kicker">LOCAL PROJECT</span>
            <h3>{projectTitle(songFile?.name)}</h3>
            <p>{modelRig?.name ?? preset.name} · Custom amp preset</p>
            <div className="project-meta"><span className={hasResult ? "state-dot complete" : "state-dot"} />{hasResult ? "Tone ready to preview" : processing ? "Separating your song" : songFile ? "Song added — ready to continue" : "No reference song added yet"}</div>

          </div>
          <div className="project-song"><span>Reference</span><strong>{songFile?.name ?? "Add a song"}</strong></div>
          <button onClick={() => navigate("tone-match")}>Continue <span aria-hidden="true">→</span></button>
        </article>
      </section>

      <section className="projects-section" aria-labelledby="projects-heading">
        <div className="section-heading"><div><span className="step">YOUR PROJECTS</span><h2 id="projects-heading">Recently updated</h2></div></div>
        {inactiveProjects.length > 0 && <div className="project-list">{inactiveProjects.map((project) => <article className="saved-project" key={project.id}><div className="saved-project-art" aria-hidden="true"><span>MOD</span></div><div><span className="project-kicker">SAVED IN THIS TAB</span><h3>{projectTitle(project.songFile?.name)}</h3><p>{project.songFile?.name ?? "No reference song"} · {project.jobStage === "ready" ? "Tone ready" : project.jobStage === "failed" ? "Needs attention" : "In progress"}</p></div><button className="secondary" onClick={() => openProject(project.id)}>Open project</button></article>)}</div>}
        <div className="empty-projects"><div className="empty-art" aria-hidden="true"><span className="accent-coral" /><span className="accent-lavender" /><span className="accent-mint" /></div><div><h3>{inactiveProjects.length ? "Start another tone" : "Your next tone starts here"}</h3><p>{inactiveProjects.length ? "Your earlier projects stay available above while this tab remains open." : "Create another project when you’re ready to match a song’s guitar tone."}</p></div><button className="secondary" onClick={startNewToneMatch}>Start a project</button></div>
      </section>
    </div>}

    <div className="tone-match-view" hidden={view !== "tone-match"}>
      <header className="hero">
        <div><span className="eyebrow">TONE MATCH</span><h2 className="display-title">Find the sound.<br /><em>Make it yours.</em></h2><p>Choose a song, confirm the reference and apply a starting preset to your browser amp.</p></div>
        <div className="mode-badge"><strong>Local or Cloud API separation</strong><span>Tone match remains unverified</span></div>
      </header>
      <SeparationPage key={activeProjectId} ref={workflow} embedded active={view === "tone-match"} onInputChosen={(device, inputChannel) => { setSelectedDeviceId(device); setChannel(inputChannel); }} initialJobId={jobId} initialFile={songFile}
        onJobChange={(id, file, status) => { setJobId(id); setSongFile(file); setJobStage(status); }}
        onApplyPreset={applyStartingPreset} onApplyRig={applyStartingRig} onSourceChange={source => setDryFile(source?.file)} onStopAudio={track => { if (track !== "backing" || engineSource.current !== "live") stopEngineAudio("Stopped — song preview took over the audio output.", false); }} onInvalidatePreset={invalidateStartingPreset} />

      <ModelRigPanel key={`rig-${sessionKey}`} engineRef={engine} value={modelRig} legacyPreset={preset} />
      <div className="grid">
        <section aria-labelledby="audition-title"><span className="step">06 / AUDITION</span><h2 id="audition-title">Hear your rig</h2><p>Play through the active preset or model rig. Start at a comfortable listening level.</p><button disabled={busy} onClick={() => void play(false)}>Play test signal</button><p className="hint">A two-second synthesized pluck, not an isolated guitar or AI result.</p><label className="file-label" htmlFor="dry-file">Dry guitar recording · local audition only</label><AudioFileDropzone key={`dry-${sessionKey}`} id="dry-file" accept="audio/*" formats="Browser-supported audio" maxBytes={20 * 1024 * 1024} file={dryFile} onFile={next => { workflow.current?.invalidateCalibration?.(); setDryFile(next); }} /><button className="secondary" disabled={!dryFile || busy} onClick={() => void play(true)}>Play dry recording</button><label className="toggle"><input type="checkbox" checked={bypass} onChange={(event) => { setBypass(event.target.checked); engine.current?.setBypass(event.target.checked); }} />Bypass effects</label><button className="stop" onClick={() => stopEngineAudio()}>Stop audio</button><p role="status">{audioState}</p></section>
        <section aria-labelledby="live-title" className="live-panel">
          <span className="step">07 / LIVE INPUT</span><h2 id="live-title">Connect your guitar</h2>
          <p>Use a local audio interface to play through the active preset or model rig. Starting rigs still require listening verification.</p>

          <label className="select-label" htmlFor="device">Input device</label>
          <ChoiceMenu id="device" kind="device" searchable value={selectedDeviceId} disabled={!inputDevices.length || liveState === "starting" || liveState === "live"} onChange={changeLiveDevice} options={inputDevices.map((device) => ({ label: device.label, value: device.deviceId }))} placeholder="No audio inputs found" />
          <button className="secondary compact-action" disabled={liveState === "starting" || liveState === "live"} onClick={() => void refreshInputDevices()}>Refresh inputs</button>
          <label className="select-label" htmlFor="channel">Channel</label>
          <ChoiceMenu id="channel" value={String(channel)} disabled={!selectedDeviceId || liveState === "starting" || liveState === "live"} onChange={changeLiveChannel} options={[{ label: "Input 1", value: "0" }, { label: "Input 2", value: "1" }]} placeholder="Choose a channel" />
          <div className="live-actions"><button disabled={!selectedDeviceId || liveState === "starting" || liveState === "live"} onClick={() => void startLiveInput()}>Start live input</button><button className="stop" disabled={liveState !== "starting" && liveState !== "live"} onClick={() => stopEngineAudio()}>Stop</button></div>
          <p className="hint">{deviceMessage} Device names may appear after the first permission grant.</p>
          <p className={`live-status ${liveState}`} role="status"><strong>{liveState === "starting" ? "Starting" : liveState === "live" ? "Live" : liveState === "error" ? "Error" : "Stopped"}</strong><span>{liveMessage}</span></p>

          <p className="hint">Calibrate your connected guitar at the top of this page before generating a tone. Live input here monitors your playing through the amp; keep volume low and select the physical instrument input.</p>
          {inputLevel && <p role="status">Dry input: RMS {levelDb(inputLevel.rms).toFixed(1)} dBFS · peak {levelDb(inputLevel.peak).toFixed(1)} dBFS{inputLevel.clipping ? " · Clipping — lower interface gain" : ""}</p>}
          <div className="performance-capture" aria-labelledby="performance-capture-title">
            <div className="calibration-heading"><div><span className="step">PERFORMANCE</span><h3 id="performance-capture-title">Record your processed guitar</h3></div><span className={`calibration-chip ${performanceState}`}>{performanceState === "recording" ? "Recording" : performanceState === "finalizing" ? "Finalizing" : performanceState === "error" ? "Error" : "Ready"}</span></div>
            <p>Capture the protected output of the active preset or model rig. Takes stay in this tab for playback, download or deletion.</p>
            <div className="performance-actions">
              {(performanceState === "idle" || performanceState === "error") && <button disabled={engineSource.current === "none"} onClick={() => void recordPerformance()}>{performanceState === "error" ? "Retry recording" : "Record"}</button>}
              {performanceState === "recording" && <><button onClick={finishPerformanceRecording}>Finish</button><button className="secondary" onClick={() => discardPerformanceRecording()}>Discard</button></>}
              {performanceState === "finalizing" && <><button disabled>Finalizing…</button><button className="secondary" onClick={() => discardPerformanceRecording()}>Discard</button></>}
            </div>
            <p className={`performance-status ${performanceState}`} role="status">{performanceMessage}</p>
            <button className="text-action" onClick={() => navigate("recordings")}>View {recordings.length ? `${recordings.length} saved ${recordings.length === 1 ? "take" : "takes"}` : "recordings"} <span aria-hidden="true">→</span></button>
          </div>

          {liveInfo && <dl className="capture-info"><div><dt>Capture sample rate</dt><dd>{liveInfo.settings.sampleRate ?? "unknown"}</dd></div><div><dt>Capture channels</dt><dd>{liveInfo.settings.channelCount ?? "unknown"}</dd></div><div><dt>Audio-context rate</dt><dd>{liveInfo.contextSampleRate}</dd></div><div><dt>Echo cancellation</dt><dd>{liveInfo.settings.echoCancellation === undefined ? "unknown" : liveInfo.settings.echoCancellation ? "on" : "off"}</dd></div><div><dt>Noise suppression</dt><dd>{liveInfo.settings.noiseSuppression === undefined ? "unknown" : liveInfo.settings.noiseSuppression ? "on" : "off"}</dd></div><div><dt>Automatic gain</dt><dd>{liveInfo.settings.autoGainControl === undefined ? "unknown" : liveInfo.settings.autoGainControl ? "on" : "off"}</dd></div>{liveInfo.baseLatencySeconds !== undefined && <div><dt>Browser base estimate</dt><dd>{(liveInfo.baseLatencySeconds * 1000).toFixed(1)} ms</dd></div>}{liveInfo.outputLatencySeconds !== undefined && <div><dt>Browser output estimate</dt><dd>{(liveInfo.outputLatencySeconds * 1000).toFixed(1)} ms</dd></div>}</dl>}
        </section>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <footer>Separation runs on the local API · measured descriptors, not audio, go to the model on Generate · tone similarity remains unverified</footer>
    </div>

    {view === "presets" && <section className="library-panel" aria-labelledby="preset-library-title"><div className="section-heading"><div><span className="step">CURRENT TONE</span><h2 id="preset-library-title">Ready to play</h2></div><span className="quality-badge">1 current preset</span></div><p>Your current preset stays in this tab. Saving a library comes later.</p><article className="preset-row"><div className="preset-thumbnail" aria-hidden="true"><span>MOD</span></div><div><strong>{preset.name}</strong><span>{preset.description}</span></div><span className="manual-tag">{hasResult ? "AI starting preset" : "Manual example"}</span><button className="secondary" onClick={() => navigate("tone-match")}>Open controls</button></article></section>}

    {view === "recordings" && <RecordingLibrary recordings={recordings} onDelete={(recordingId) => setRecordings((current) => current.filter((recording) => recording.id !== recordingId))} onOpenToneMatch={() => navigate("tone-match")} />}

    {view === "settings" && <section className="availability-panel" aria-labelledby="settings-title"><span className="availability-icon lavender" aria-hidden="true">⚙</span><span className="step">DEMO MODE</span><h2 id="settings-title">Nothing to configure yet</h2><p>There are no accounts or cloud settings in this demo. Guitar recording audio stays in this browser; numeric descriptors go to the provider on Generate. Mixed songs go to the local separation API.</p><button className="secondary" onClick={() => navigate("workspace")}>Return to Workspace</button></section>}
  </AppShell>;
}
