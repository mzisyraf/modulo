import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { AudioEngine, type InputLevel } from "@modulo/audio";
import { parsePreset } from "@modulo/contracts";
import example from "../../../fixtures/preset.example.json";
import { calibrateLiveInput, calibrateGuitarFile, type CalibratedRecording } from "./recordingCalibration";
import { audioInputOptions, DEFAULT_AUDIO_INPUT, liveInputErrorMessage, type AudioInputOption } from "./liveInput";
import { AudioFileDropzone } from "./AudioFileDropzone";
import { ChoiceMenu } from "./ChoiceMenu";

export interface LiveCalibrationControl { stop: () => void; invalidate: () => void }
export function GuitarCalibration({ onChange, onStart, onInputChosen, active = true, ref }: {
  onChange: (calibration?: CalibratedRecording) => void;
  onStart: () => void;
  onInputChosen?: (device: string, channel: 0 | 1) => void;
  active?: boolean;
  ref?: Ref<LiveCalibrationControl>;
}) {
  const [devices, setDevices] = useState<AudioInputOption[]>([]);
  const [device, setDevice] = useState("");
  const [channel, setChannel] = useState<0 | 1>(0);
  const [calibration, setCalibration] = useState<CalibratedRecording>();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"live" | "file">("live");
  const modeRef = useRef(mode); modeRef.current = mode;
  const [file, setFile] = useState<File>();
  const [level, setLevel] = useState<InputLevel | null>(null);
  const [error, setError] = useState("");
  const run = useRef(0);
  const engine = useRef<AudioEngine | null>(null);
  function stop() {
    run.current++;
    const audio = engine.current; engine.current = null;
    if (audio) void audio.dispose();
    setBusy(false); setLevel(null);
  }
  useImperativeHandle(ref, () => ({ stop, invalidate }));
  useEffect(() => { if (!active) stop(); }, [active]);
  useEffect(() => () => { run.current++; void engine.current?.dispose(); }, []);
  async function refresh() {
    try {
      const options = audioInputOptions(await navigator.mediaDevices.enumerateDevices());
      setDevices(options);
      setDevice(current => options.some(option => option.deviceId === current) ? current : options[0]?.deviceId ?? "");
    } catch (failure) { setError(liveInputErrorMessage(failure)); }
  }
  useEffect(() => {
    void refresh();
    const changed = () => { if (modeRef.current === "live") invalidate(); void refresh(); };
    navigator.mediaDevices?.addEventListener("devicechange", changed);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", changed);
  }, []);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setLevel(engine.current?.getInputLevel() ?? null), 80);
    return () => window.clearInterval(timer);
  }, [busy]);
  function invalidate() { stop(); setCalibration(undefined); setError(""); onChange(); }
  async function measureFile(sample = false) {
    if (busy || !active) return;
    onStart(); onChange(); const request = ++run.current; setBusy(true); setError(""); setCalibration(undefined);
    try {
      let input = file;
      if (sample) {
        const response = await fetch("/audio/guitar-techs-dry-di.wav", { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw Error("The supplied dry recording could not load.");
        input = new File([await response.blob()], "Guitar-TECHS dry DI.wav", { type: "audio/wav" });
      }
      if (!input) throw Error("Choose a dry guitar recording first.");
      const measured = await calibrateGuitarFile(input, channel);
      if (request !== run.current) return;
      setFile(input); setCalibration(measured); onChange(measured);
    } catch (failure) { if (request === run.current) setError(failure instanceof Error ? failure.message : "Recording calibration failed."); }
    finally { if (request === run.current) setBusy(false); }
  }
  async function start() {
    if (engine.current || !device) return;
    onStart(); onChange();
    const request = ++run.current;
    const audio = new AudioEngine(parsePreset(example));
    engine.current = audio;
    setCalibration(undefined); setError(""); setBusy(true);
    audio.onEnded = () => {
      if (request !== run.current) return;
      stop(); setError("Input disconnected. Reconnect and calibrate again.");
    };
    try {
      // Silent capture omits the input-to-output connection, including during startup.
      const info = await audio.startLive(device === DEFAULT_AUDIO_INPUT ? undefined : device, channel, false);
      if (request !== run.current || !info) return;
      onInputChosen?.(device, channel);
      void refresh();
      const take = await audio.startCalibration(10);
      if (request !== run.current) return;
      await audio.dispose();
      if (!take.usable) throw new Error("Input is too quiet, clipped or too short. Adjust the interface gain and play again for 10 seconds.");
      const measured = await calibrateLiveInput(take.samples, take.sampleRate);
      if (request !== run.current) return;
      engine.current = null; setBusy(false); setLevel(null);
      setCalibration(measured); onChange(measured);
    } catch (failure) {
      if (request === run.current) setError(liveInputErrorMessage(failure));
    } finally {
      await audio.dispose();
      if (request === run.current) { engine.current = null; setBusy(false); setLevel(null); }
    }
  }
  const db = (value: number) => (20 * Math.log10(Math.max(value, 1e-8))).toFixed(1);
  const channelOptions = mode === "live"
    ? [{ value: "0", label: "Input 1" }, { value: "1", label: "Input 2" }]
    : [{ value: "0", label: "Channel 1 / mono" }, { value: "1", label: "Channel 2" }];
  return <section className="result-panel calibration-panel" aria-labelledby="guitar-calibration-title">
    <header className="calibration-title">
      <span className="step">YOUR STARTING POINT</span>
      <h2 id="guitar-calibration-title">Calibrate your guitar source</h2>
      <p>Set a clean baseline from the guitar, pickup and volume you plan to use. Modulo measures the source before shaping a rig around the song.</p>
    </header>

    <div className="workflow-card calibration-source-card">
      <span className="workflow-card-icon" aria-hidden="true">◇</span>
      <div className="workflow-card-copy"><h3>Guitar source</h3><p>Choose how you’ll provide clean guitar audio for calibration.</p></div>
      <div className="segmented-control" role="group" aria-label="Guitar source">
        <button type="button" disabled={busy} aria-pressed={mode === "live"} className={mode === "live" ? "segmented-option is-selected" : "segmented-option"} onClick={() => { if (mode !== "live") { invalidate(); setMode("live"); } }}><span aria-hidden="true">⌁</span>Live guitar</button>
        <button type="button" disabled={busy} aria-pressed={mode === "file"} className={mode === "file" ? "segmented-option is-selected" : "segmented-option"} onClick={() => { if (mode !== "file") { invalidate(); setMode("file"); } }}><span aria-hidden="true">≋</span>Guitar audio</button>
      </div>
    </div>

    {mode === "live" ? <>
      <div className="workflow-card calibration-config-card">
        <div className="workflow-card-heading"><span className="workflow-card-icon" aria-hidden="true">⌇</span><div><h3>Input &amp; channel</h3><p>Select your instrument input and the channel carrying the guitar.</p></div></div>
        <div className="calibration-control-grid">
          <div className="field-group device-field"><span className="field-label">Guitar input device</span><ChoiceMenu id="calibration-device" kind="device" searchable label="Guitar input device" value={device} disabled={busy} placeholder="Connect an interface, then refresh" options={devices.map(option => ({ value: option.deviceId, label: option.label }))} onChange={value => { invalidate(); setDevice(value); }} /></div>
          <div className="field-group"><span className="field-label">Instrument channel</span><ChoiceMenu id="calibration-channel" label="Instrument channel" value={String(channel)} disabled={busy} placeholder="Choose a channel" options={channelOptions} onChange={value => { invalidate(); setChannel(Number(value) as 0 | 1); }} /></div>
          <button type="button" className="secondary refresh-inputs" disabled={busy} onClick={() => { invalidate(); void refresh(); }}><span aria-hidden="true">↻</span>Refresh guitar inputs</button>
        </div>
      </div>

      <div className="workflow-card calibration-guide">
        <div className="workflow-card-heading"><span className="workflow-card-icon" aria-hidden="true">☷</span><div><h3>How to calibrate</h3><p>Use the same pickup and guitar volume you’ll play with.</p></div></div>
        <ol className="calibration-steps"><li><span>1</span><p>Press Calibrate and allow input access.</p></li><li><span>2</span><p>Play single notes across the strings, then normal and strong chords for about 10 seconds.</p></li><li><span>3</span><p>If the input clips, lower the interface gain and retry.</p></li></ol>
        <div className="calibration-action-row"><button className="calibration-primary" disabled={busy || !device || !active} onClick={() => void start()}><span aria-hidden="true">≋</span>{calibration ? "Calibrate again" : "Calibrate live guitar"}</button>{busy && <button className="stop" onClick={stop}>Cancel calibration</button>}<p className="calibration-privacy">Calibration is silent through the app. Select the physical instrument input, avoiding Loopback or Stereo Mix.</p></div>
        {busy && <p className="calibration-live-status" role="status">Listening for up to 10 seconds after access is granted — play notes and chords now.</p>}
        {level && <p className={`calibration-live-status${level.clipping ? " is-clipping" : ""}`} role="status">Dry input: RMS {db(level.rms)} dBFS · peak {db(level.peak)} dBFS{level.clipping ? " · Clipping — lower interface gain" : ""}</p>}
        {calibration && <div className="success-state" role="status"><strong>Live guitar calibrated</strong><p>RMS {calibration.measurements.rms_dbfs.toFixed(1)} dBFS · peak {calibration.measurements.peak_dbfs.toFixed(1)} dBFS · starting input gain {calibration.inputGainDb.toFixed(1)} dB.</p><p>Input level and six spectral bands measured from your playing.</p></div>}
      </div>
    </> : <>
      <div className="workflow-card calibration-config-card calibration-file-card">
        <div className="workflow-card-heading"><span className="workflow-card-icon" aria-hidden="true">▱</span><div><h3>Dry guitar audio</h3><p>Choose an unprocessed guitar recording. Microphone access is not required.</p></div></div>
        <div className="calibration-file-grid">
          <AudioFileDropzone compact accept="audio/*" disabled={busy} file={file} formats="Audio file" help="3–90 seconds · up to 20 MB · measured only in this browser" id="calibration-file" maxBytes={20 * 1024 * 1024} readyLabel="ready to measure" onFile={next => { invalidate(); setFile(next); }} />
          <div className="field-group"><span className="field-label">Recording channel</span><ChoiceMenu id="file-channel" label="Recording channel" value={String(channel)} disabled={busy} placeholder="Choose a channel" options={channelOptions} onChange={value => { invalidate(); setChannel(Number(value) as 0 | 1); }} /></div>
        </div>
      </div>
      <div className="workflow-card calibration-guide calibration-file-guide">
        <div className="workflow-card-heading"><span className="workflow-card-icon" aria-hidden="true">☷</span><div><h3>Measure your recording</h3><p>Use a dry performance without an amp, effects or backing track.</p></div></div>
        <ol className="calibration-steps"><li><span>1</span><p>Choose a 3–90 second dry guitar recording.</p></li><li><span>2</span><p>Select the channel that contains the guitar.</p></li><li><span>3</span><p>Measure it locally, then review the input level before continuing.</p></li></ol>
        <div className="calibration-action-row"><button className="calibration-primary" disabled={!file || busy || !active} onClick={() => void measureFile()}>Calibrate guitar audio</button><button className="secondary" disabled={busy || !active} onClick={() => void measureFile(true)}>Use supplied dry guitar</button>{busy && <button className="stop" onClick={stop}>Cancel calibration</button>}</div>
        {busy && <p className="calibration-live-status" role="status">Measuring the recording locally…</p>}
        {calibration && <div className="success-state" role="status"><strong>Guitar audio calibrated</strong><p>{calibration.originalName} · RMS {calibration.measurements.rms_dbfs.toFixed(1)} dBFS · peak {calibration.measurements.peak_dbfs.toFixed(1)} dBFS.</p><p>This recording is now the source for rig comparisons and audition. It does not calibrate a physical guitar/interface.</p></div>}
        <p className="calibration-privacy">Supplied recording: Guitar-TECHS (2025), CC BY 4.0. <a href="/audio/ATTRIBUTION.txt" target="_blank" rel="noreferrer">Credits and recording changes</a>.</p>
      </div>
    </>}
    <p className="calibration-disclosure">Temporary live samples and selected guitar audio stay in browser memory for measurement and comparison. Only numeric measurements go to the configured provider when you Generate. Recalibrate after changing guitar, pickup, volume or interface gain. Tone similarity remains unverified.</p>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
