import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { AudioEngine, type InputLevel } from "@modulo/audio";
import { parsePreset } from "@modulo/contracts";
import example from "../../../fixtures/preset.example.json";
import { calibrateLiveInput, calibrateGuitarFile, type CalibratedRecording } from "./recordingCalibration";
import { audioInputOptions, DEFAULT_AUDIO_INPUT, liveInputErrorMessage, type AudioInputOption } from "./liveInput";

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
  return <section className="result-panel" aria-labelledby="guitar-calibration-title">
    <span className="step">YOUR STARTING POINT</span><h2 id="guitar-calibration-title">Calibrate your guitar source</h2>
    <fieldset disabled={busy}><legend>Guitar source</legend>
      <button type="button" aria-pressed={mode === "live"} className={mode === "live" ? undefined : "secondary"} onClick={() => { if (mode !== "live") { invalidate(); setMode("live"); } }}>Live guitar</button>{" "}
      <button type="button" aria-pressed={mode === "file"} className={mode === "file" ? undefined : "secondary"} onClick={() => { if (mode !== "file") { invalidate(); setMode("file"); } }}>Guitar audio</button>
    </fieldset>
    {mode === "live" ? <>
    <p>Connect your guitar to an instrument input. Set a clean signal with effects off. Use the pickup and guitar volume you will play with.</p>
    <label htmlFor="calibration-device">Guitar input device</label>
    <select id="calibration-device" value={device} disabled={busy} onChange={event => { invalidate(); setDevice(event.target.value); }}>
      {!devices.length && <option value="">Connect an interface, then refresh</option>}
      {devices.map(option => <option key={option.deviceId} value={option.deviceId}>{option.label}</option>)}
    </select>
    <button className="secondary" disabled={busy} onClick={() => { invalidate(); void refresh(); }}>Refresh guitar inputs</button>
    <label htmlFor="calibration-channel">Instrument channel</label>
    <select id="calibration-channel" value={channel} disabled={busy} onChange={event => { invalidate(); setChannel(Number(event.target.value) as 0 | 1); }}>
      <option value={0}>Input 1</option><option value={1}>Input 2</option>
    </select>
    <ol><li>Press Calibrate and allow input access.</li><li>Play single notes across the strings, then normal and strong chords for 10 seconds.</li><li>If the input clips, lower the interface gain and retry.</li></ol>
    <p className="hint">Calibration is silent through the app. Select the physical instrument input, avoiding Loopback or Stereo Mix.</p>
    <button disabled={busy || !device || !active} onClick={() => void start()}>{calibration ? "Calibrate again" : "Calibrate live guitar"}</button>
    {busy && <><button className="stop" onClick={stop}>Cancel calibration</button><p role="status">Listening for up to 10 seconds after access is granted — play notes and chords now.</p></>}
    {level && <p role="status">Dry input: RMS {db(level.rms)} dBFS · peak {db(level.peak)} dBFS{level.clipping ? " · Clipping — lower interface gain" : ""}</p>}
    {calibration && <div className="success-state" role="status"><strong>Live guitar calibrated</strong><p>RMS {calibration.measurements.rms_dbfs.toFixed(1)} dBFS · peak {calibration.measurements.peak_dbfs.toFixed(1)} dBFS · starting input gain {calibration.inputGainDb.toFixed(1)} dB.</p><p>Input level and six spectral bands measured from your playing.</p></div>}
    </> : <>
      <p>Use a dry guitar recording without amp or effects. Calibration and rig comparisons stay on this device; microphone access is not required.</p>
      <label htmlFor="calibration-file">Dry guitar audio for calibration</label><input id="calibration-file" type="file" accept="audio/*" disabled={busy} onChange={event => { invalidate(); setFile(event.target.files?.[0]); }} />
      <label htmlFor="file-channel">Recording channel</label><select id="file-channel" value={channel} disabled={busy} onChange={event => { invalidate(); setChannel(Number(event.target.value) as 0 | 1); }}><option value={0}>Channel 1 / mono</option><option value={1}>Channel 2</option></select>
      <p>{file?.name ?? "Choose 3–90 seconds of dry guitar, up to 20 MiB."}</p>
      <button disabled={!file || busy || !active} onClick={() => void measureFile()}>Calibrate guitar audio</button>{" "}
      <button className="secondary" disabled={busy || !active} onClick={() => void measureFile(true)}>Use supplied dry guitar</button>
      {busy && <><p role="status">Measuring the recording locally…</p><button className="stop" onClick={stop}>Cancel calibration</button></>}
      {calibration && <div className="success-state" role="status"><strong>Guitar audio calibrated</strong><p>{calibration.originalName} · RMS {calibration.measurements.rms_dbfs.toFixed(1)} dBFS · peak {calibration.measurements.peak_dbfs.toFixed(1)} dBFS.</p><p>This recording is now the source for rig comparisons and audition. It does not calibrate a physical guitar/interface.</p></div>}
      <p className="hint">Supplied recording: Guitar-TECHS (2025), CC BY 4.0. <a href="/audio/ATTRIBUTION.txt" target="_blank" rel="noreferrer">Credits and recording changes</a>.</p>
    </>}
    <p className="hint">No recording upload. Temporary live samples stay in browser memory for measurement and optional comparison. Only numeric measurements go to the provider when you Generate. Recalibrate after changing guitar, pickup, guitar volume or interface gain. Tone similarity remains unverified.</p>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
