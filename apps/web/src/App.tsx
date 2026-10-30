import { useCallback, useEffect, useRef, useState } from "react";
import { AudioEngine, type InputLevel, type RigPreset } from "@modulo/audio";

import { parsePreset, type Preset } from "@modulo/contracts";
import example from "../../../fixtures/preset.example.json";
import { AppShell, type AppView } from "./AppShell";
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
type PerformanceRecordingState = "idle" | "countdown" | "recording" | "finalizing" | "error";
type PerformanceMode = "guitar" | "mix";
type EngineSource = "none" | "live";

interface StoredProject {
  id: string;
  updatedAt: number;
  songFile?: File;
  jobStage: JobStage;
  jobId: string;
  preset: Preset;
  rigPreset?: RigPreset;
  rigOrigin?: GeneratedRig;
  bypass: boolean;
}

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
  const [sourceReady, setSourceReady] = useState(false);
  const [stage, setStage] = useState(1);
  const [jobStage, setJobStage] = useState<JobStage>("idle");
  const [jobId, setJobId] = useState("");
  const [inputDevices, setInputDevices] = useState<AudioInputOption[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [channel, setChannel] = useState<0 | 1>(0);
  const [deviceMessage, setDeviceMessage] = useState("Looking for audio inputs…");
  const [liveState, setLiveState] = useState<LiveState>("stopped");
  const [liveMessage, setLiveMessage] = useState("Stopped");
  const [inputLevel, setInputLevel] = useState<InputLevel | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string>(() => crypto.randomUUID());
  const [savedProjects, setSavedProjects] = useState<StoredProject[]>([]);
  const [recordings, setRecordings] = useState<PerformanceRecording[]>([]);
  const [performanceState, setPerformanceState] = useState<PerformanceRecordingState>("idle");
  const [performanceMessage, setPerformanceMessage] = useState("Start playing, then record a take.");
  const [performanceMode, setPerformanceMode] = useState<PerformanceMode>("guitar");
  const [backingPlayer, setBackingPlayer] = useState<HTMLAudioElement | null>(null);
  const [backingGainDb, setBackingGainDb] = useState(-6);
  const [useCountdown, setUseCountdown] = useState(true);
  const [cameraState, setCameraState] = useState<"off" | "starting" | "ready" | "error">("off");
  const [cameraMessage, setCameraMessage] = useState("Camera off");
  const [sessionKey, setSessionKey] = useState(0);
  const engine = useRef<AudioEngine | null>(null);
  const workflow = useRef<PresetAudition | null>(null);
  const audioRun = useRef(0);
  const rigRestoreRun = useRef(0);

  const liveRequests = useRef(new LiveRequestGate());
  const performanceRun = useRef(0);
  const performanceStateRef = useRef<PerformanceRecordingState>("idle");
  const performanceBacking = useRef<HTMLAudioElement | null>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const cameraPreview = useRef<HTMLVideoElement | null>(null);
  const cameraRequest = useRef(0);
  const engineSource = useRef<EngineSource>("none");
  const processing = jobStage === "queued" || jobStage === "running";
  const hasResult = preset.provenance.kind === "generated" || Boolean(modelRig && rigOrigin);
  const inactiveProjects = savedProjects.filter((project) => project.id !== activeProjectId);

  const updatePerformanceStatus = useCallback((state: PerformanceRecordingState, message: string) => {
    performanceStateRef.current = state;
    setPerformanceState(state);
    setPerformanceMessage(message);
  }, []);

  const stopCamera = useCallback((message = "Camera off") => {
    cameraRequest.current++;
    cameraStream.current?.getTracks().forEach(track => track.stop());
    cameraStream.current = null;
    if (cameraPreview.current) cameraPreview.current.srcObject = null;
    setCameraState("off");
    setCameraMessage(message);
  }, []);

  async function enableCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("error"); setCameraMessage("Camera capture requires HTTPS or localhost in a supported browser."); return;
    }
    const request = ++cameraRequest.current;
    setCameraState("starting"); setCameraMessage("Requesting camera permission…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }, audio: false });
      if (request !== cameraRequest.current) { stream.getTracks().forEach(track => track.stop()); return; }
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState === "ended") throw new Error("No active camera was returned.");
      cameraStream.current?.getTracks().forEach(current => current.stop());
      cameraStream.current = stream;
      if (cameraPreview.current) { cameraPreview.current.srcObject = stream; void cameraPreview.current.play().catch(() => {}); }
      setCameraState("ready"); setCameraMessage(track.label ? `Camera ready · ${track.label}` : "Camera ready");
    } catch (failure) {
      if (request !== cameraRequest.current) return;
      cameraStream.current?.getTracks().forEach(track => track.stop()); cameraStream.current = null;
      if (cameraPreview.current) cameraPreview.current.srcObject = null;
      setCameraState("error");
      setCameraMessage(failure instanceof DOMException && failure.name === "NotAllowedError" ? "Camera permission was denied. Allow it in browser settings and retry." : failure instanceof Error ? failure.message : "Camera could not start.");
    }
  }

  function setCameraPreview(element: HTMLVideoElement | null) {
    cameraPreview.current = element;
    if (element && cameraStream.current) { element.srcObject = cameraStream.current; void element.play().catch(() => {}); }
  }

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
      if (performanceStateRef.current === "countdown") {
        performanceRun.current++;
        stopCamera();
        updatePerformanceStatus("idle", "The audio source stopped before recording began. Start it again and retry.");
      } else if (performanceStateRef.current === "recording") {
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
      .catch(() => { if (!controller.signal.aborted) setApiState("Song service unavailable"); else setApiState("Song service connection timed out"); })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      controller.abort();
      audioRun.current++;
      rigRestoreRun.current++;

      liveRequests.current.cancel();
      performanceRun.current++;
      audio.cancelPerformanceRecording();
      stopCamera();
      audio.onRigChange = undefined;
      engineSource.current = "none";
      void audio.dispose();
    };
  }, [refreshInputDevices, stopCamera, updatePerformanceStatus]);

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
    performanceBacking.current?.pause();
    performanceBacking.current = null;
    stopCamera();
    updatePerformanceStatus("idle", message);
  }

  async function recordPerformance() {
    const audio = engine.current;
    if (!audio || engineSource.current === "none" || ["countdown", "recording", "finalizing"].includes(performanceStateRef.current)) return;
    const mode = performanceMode;
    const player = mode === "mix" ? backingPlayer : null;
    if (mode === "mix" && !player) { updatePerformanceStatus("error", "Separate a song and load its guitar-reduced backing before recording a mix."); return; }

    const run = ++performanceRun.current;
    if (player) player.pause();
    if (useCountdown) {
      for (let count = 3; count > 0; count--) {
        updatePerformanceStatus("countdown", `Recording starts in ${count}…`);
        await new Promise(resolve => window.setTimeout(resolve, 1000));
        if (run !== performanceRun.current) return;
      }
    }
    const backingStartSeconds = player?.currentTime ?? 0;
    const videoTrack = cameraState === "ready" ? cameraStream.current?.getVideoTracks()[0] : undefined;
    const details = {
      projectId: activeProjectId,
      projectTitle: projectTitle(songFile?.name),
      presetName: modelRig?.name ?? preset.name,
      mode,
      camera: Boolean(videoTrack),
      backing: player ? { jobId, title: songFile?.name ?? "Separated backing", startSeconds: backingStartSeconds, gainDb: backingGainDb } : undefined,
    };
    performanceBacking.current = player;
    updatePerformanceStatus("recording", `${videoTrack ? "Recording camera, " : "Recording "}${mode === "mix" ? "processed guitar + backing" : "processed guitar"}… Finish when you’re done, or discard this take.`);
    const finishAtBackingEnd = () => {
      if (performanceStateRef.current !== "recording") return;
      updatePerformanceStatus("finalizing", "The backing track ended. Finalizing your take…");
      audio.finishPerformanceRecording();
    };
    player?.addEventListener("ended", finishAtBackingEnd, { once: true });
    try {
      if (player) {
        await audio.connectBackingElement(player);
        audio.setBackingGain(backingGainDb);
      }
      const capture = audio.startPerformanceRecording({ includeBacking: mode === "mix", retainGuitarMaster: mode === "mix" || Boolean(videoTrack), videoTrack });
      if (player) {
        try { await player.play(); }
        catch (failure) { audio.cancelPerformanceRecording(); void capture.catch(() => {}); throw failure; }
      }
      const take = await capture;
      if (run !== performanceRun.current) return;
      const recording = createPerformanceRecording(take, details);
      setRecordings((current) => addPerformanceRecording(current, recording));
      const message = take.stopReason === "duration_limit"
        ? "The 3-minute limit was reached. Your take was saved."
        : take.stopReason === "source_stopped"
          ? "The audio source stopped. Your take was saved."
          : `${videoTrack ? "Camera performance" : mode === "mix" ? "Mixed performance" : "Take"} saved to Recordings for playback or download.`;
      stopCamera();
      updatePerformanceStatus("idle", message);
    } catch (failure) {
      if (run !== performanceRun.current) return;
      if (failure instanceof DOMException && failure.name === "AbortError") {
        stopCamera(); updatePerformanceStatus("idle", "Take discarded. Record again when you’re ready.");
        return;
      }
      stopCamera();
      updatePerformanceStatus("error", failure instanceof Error ? failure.message : "The performance recording failed. Try again.");
    } finally {
      player?.removeEventListener("ended", finishAtBackingEnd);
      player?.pause();
      performanceBacking.current = null;
    }
  }

  function finishPerformanceRecording() {
    if (performanceStateRef.current !== "recording") return;
    updatePerformanceStatus("finalizing", "Finalizing the recording so it can be played back…");
    performanceBacking.current?.pause();
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
    setSourceReady(false); setStage(1);
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

  async function applyStartingRig(next: RigPreset, origin: GeneratedRig) {
    stopEngineAudio("Stopped — applying your custom rig.", false);
    const audio = engine.current, request = rigRestoreRun.current;
    if (!audio) throw Error("The audio engine is unavailable.");
    if (!await audio.applyRigPreset(next) || request !== rigRestoreRun.current) throw Error("Rig application was cancelled because the source or project changed.");
    audio.setBypass(false); setBypass(false); setRigOrigin(origin); setStage(4);
  }

  function invalidateStartingPreset() {
    stopEngineAudio();
    if (preset.provenance.kind === "generated" || rigOrigin) {
      engine.current?.applyPreset(initialPreset);
      setPreset(initialPreset);
      setRigOrigin(undefined);
    }
  }

  async function startLiveInput() {
    if (!sourceReady || !selectedDeviceId || !engine.current) return;
    const request = liveRequests.current.begin();
    if (request === undefined) return;
    audioRun.current++; setBusy(false);
    markPerformanceFinalizing("The previous audio source stopped. Finalizing your take…");
    engineSource.current = "live";
    workflow.current?.prepareLiveInput?.();
    setAudioState("Stopped");
    setError("");
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

  function navigate(nextView: AppView) {
    stopEngineAudio();
    stopCamera();
    setView(nextView);
  }

  function startNewToneMatch() {
    const currentProject = snapshotActiveProject();
    if (projectHasProgress(currentProject)) setSavedProjects((projects) => upsertProject(projects, currentProject));

    discardPerformanceRecording("Ready to record a take for your new project.");
    stopEngineAudio();
    setSongFile(undefined);
    setSourceReady(false); setStage(1);
    setJobStage("idle");
    setJobId("");
    setPreset(initialPreset);
    setRigOrigin(undefined);
    engine.current?.applyPreset(initialPreset);
    setBypass(false);
    engine.current?.setBypass(false);
    setError("");
    setInputLevel(null);
    setActiveProjectId(crypto.randomUUID());
    setSessionKey((current) => current + 1);
    setView("tone-match");
  }

  function chooseStage(next: number) {
    stopEngineAudio(); stopCamera(); setStage(next);
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
            <span className="project-kicker">YOUR PROJECT</span>
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
      <header className="hero guided-hero"><div><span className="eyebrow">YOUR SOUND, REIMAGINED</span><h2 className="display-title">Find the sound. <em>Make it yours.</em></h2><p>Connect your guitar, choose a song and play your own take.</p></div><button className="stop global-stop" onClick={() => { stopEngineAudio(); stopCamera(); }}>Stop all</button></header>
      <nav className="flow-stages" aria-label="Tone match stages">{["Connect", "Choose sound", "Match tone", "Play & record"].map((label, index) => <button key={label} aria-current={stage === index + 1 ? "step" : undefined} className={stage === index + 1 ? "is-current" : ""} onClick={() => chooseStage(index + 1)}><span>{index + 1 === 1 && sourceReady ? "✓" : index + 1}</span><strong>{label}</strong><small>{[sourceReady ? "Guitar ready" : "Set up your input", songFile ? projectTitle(songFile.name) : "Pick a guitar passage", hasResult ? "Tone applied" : "Shape your sound", "Make it yours"][index]}</small></button>)}</nav>
      <SeparationPage key={activeProjectId} ref={workflow} embedded stage={stage} onStageChange={chooseStage} active={view === "tone-match"} onInputChosen={(device, inputChannel) => { setSelectedDeviceId(device); setChannel(inputChannel); }} initialJobId={jobId} initialFile={songFile}
        onJobChange={(id, file, status) => { setJobId(id); setSongFile(file); setJobStage(status); }}
        onApplyRig={applyStartingRig} onSourceChange={source => setSourceReady(source?.measurements.origin === "live")} onBackingPlayerChange={setBackingPlayer} onStopAudio={track => { if (track !== "backing" || engineSource.current !== "live") stopEngineAudio("Stopped — song preview took over the audio output.", false); }} onInvalidatePreset={invalidateStartingPreset} />

      <div hidden={stage !== 3 && stage !== 4}><ModelRigPanel key={`rig-${sessionKey}`} engineRef={engine} value={modelRig} /></div>
      <div className="play-stage" hidden={stage !== 4}>
        <section aria-labelledby="live-title" className="live-panel">
          <span className="step">04 / PLAY &amp; RECORD</span><h2 id="live-title">Make it yours</h2>
          <p>Use headphones. Start at a comfortable volume.</p>
          {!sourceReady && <p className="notice">Calibrate your connected guitar before playing. <button className="text-action" onClick={() => chooseStage(1)}>Connect guitar</button></p>}
          <div className="live-actions"><button disabled={!sourceReady || !selectedDeviceId || liveState === "starting" || liveState === "live"} onClick={() => void startLiveInput()}>{liveState === "starting" ? "Connecting…" : liveState === "live" ? "Playing live" : "Start playing"}</button><label className="switch-control"><span>Effects on</span><input className="modulo-switch" type="checkbox" role="switch" checked={!bypass} onChange={event => { setBypass(!event.target.checked); engine.current?.setBypass(!event.target.checked); }} /></label></div>
          <p className={`live-status ${liveState}`} role="status">{liveMessage}</p>
          {inputLevel && <p role="status">{inputLevel.clipping ? "Clipping — lower your interface gain" : inputLevel.rms < .003 ? "Input is quiet — check your guitar and interface gain" : "Good input level"}</p>}
          <div className="performance-capture" aria-labelledby="performance-capture-title">
            <div className="calibration-heading"><div><span className="step">PERFORMANCE</span><h3 id="performance-capture-title">Record your performance</h3></div><span className={`calibration-chip ${performanceState}`}>{performanceState === "countdown" ? "Get ready" : performanceState === "recording" ? "Recording" : performanceState === "finalizing" ? "Finalizing" : performanceState === "error" ? "Error" : "Ready"}</span></div>
            <p>Save a take to listen back or download. Recordings stay in this tab.</p>
            <details className="recording-settings"><summary>Recording options</summary><div className="recording-options">
              <fieldset disabled={["countdown", "recording", "finalizing"].includes(performanceState)}><legend>Record mode</legend><div className="segmented-control" role="group" aria-label="Performance recording mode"><button type="button" className={performanceMode === "guitar" ? "segmented-option is-selected" : "segmented-option"} aria-pressed={performanceMode === "guitar"} onClick={() => setPerformanceMode("guitar")}>Guitar only</button><button type="button" className={performanceMode === "mix" ? "segmented-option is-selected" : "segmented-option"} aria-pressed={performanceMode === "mix"} disabled={!backingPlayer} onClick={() => setPerformanceMode("mix")}>Guitar + backing</button></div></fieldset>
              {performanceMode === "mix" && <label className="backing-level">Backing level <span>{backingGainDb} dB</span><input type="range" min={-36} max={6} step={1} value={backingGainDb} disabled={["countdown", "recording", "finalizing"].includes(performanceState)} onChange={event => setBackingGainDb(Number(event.target.value))} /></label>}
              <label className="switch-control recording-switch"><span className="switch-control-copy"><strong>Include camera</strong><small>Preview and save video with the performance.</small></span><input className="modulo-switch" type="checkbox" role="switch" checked={cameraState === "ready" || cameraState === "starting"} disabled={["countdown", "recording", "finalizing"].includes(performanceState)} onChange={event => { if (event.target.checked) void enableCamera(); else stopCamera(); }} /></label>
              <label className="switch-control recording-switch"><span className="switch-control-copy"><strong>3-second countdown</strong><small>Give yourself time to get ready before capture starts.</small></span><input className="modulo-switch" type="checkbox" role="switch" checked={useCountdown} disabled={["countdown", "recording", "finalizing"].includes(performanceState)} onChange={event => setUseCountdown(event.target.checked)} /></label>
            </div></details>
            {cameraState !== "off" && <div className={`camera-preview ${cameraState}`}><video ref={setCameraPreview} muted playsInline aria-label="Camera preview" /><p role={cameraState === "error" ? "alert" : "status"}>{cameraMessage}</p>{cameraState === "error" && <button className="secondary compact-action" onClick={() => void enableCamera()}>Retry camera</button>}</div>}
            {performanceMode === "mix" && <p className="hint">Starts from the backing player’s current position at {backingPlayer ? `${Math.floor(backingPlayer.currentTime / 60)}:${String(Math.floor(backingPlayer.currentTime % 60)).padStart(2, "0")}` : "—"}. Residual separated guitar may remain. Use headphones.</p>}
            <div className="performance-actions">
              {(performanceState === "idle" || performanceState === "error") && <button disabled={engineSource.current === "none" || cameraState === "starting" || (performanceMode === "mix" && !backingPlayer)} onClick={() => void recordPerformance()}>{performanceState === "error" ? "Retry recording" : cameraState === "ready" ? "Start camera performance" : performanceMode === "mix" ? "Start mixed performance" : "Record"}</button>}
              {performanceState === "countdown" && <><button disabled>Get ready…</button><button className="secondary" onClick={() => discardPerformanceRecording("Countdown cancelled.")}>Cancel</button></>}
              {performanceState === "recording" && <><button onClick={finishPerformanceRecording}>Finish</button><button className="secondary" onClick={() => discardPerformanceRecording()}>Discard</button></>}
              {performanceState === "finalizing" && <><button disabled>Finalizing…</button><button className="secondary" onClick={() => discardPerformanceRecording()}>Discard</button></>}
            </div>
            <p className={`performance-status ${performanceState}`} role="status">{performanceMessage}</p>
            <button className="text-action" onClick={() => navigate("recordings")}>View {recordings.length ? `${recordings.length} saved ${recordings.length === 1 ? "take" : "takes"}` : "recordings"} <span aria-hidden="true">→</span></button>
          </div>

        </section>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <details className="workflow-help"><summary>Help &amp; credits</summary><p>Song audio is processed to isolate the guitar. Tone matching sends measured guitar features to the AI service. Your live guitar and recordings stay in this browser. Suggestions approximate a sound; separation and playing style affect the result.</p><p>Projects and recordings last for this tab only. Download takes before refreshing. Song audio expires after 24 hours.</p><a href="/audio/ATTRIBUTION.txt" target="_blank" rel="noreferrer">Audio credits</a></details>
    </div>

    {view === "recordings" && <RecordingLibrary recordings={recordings} onDelete={(recordingId) => setRecordings((current) => current.filter((recording) => recording.id !== recordingId))} onOpenToneMatch={() => navigate("tone-match")} />}

  </AppShell>;
}
