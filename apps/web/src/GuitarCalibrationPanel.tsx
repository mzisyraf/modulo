import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { AudioEngine, type InputLevel } from "@modulo/audio";
import { parsePreset } from "@modulo/contracts";
import example from "../../../fixtures/preset.example.json";
import { calibrateLiveInput, type CalibratedRecording } from "./recordingCalibration";
import { audioInputOptions, DEFAULT_AUDIO_INPUT, liveInputErrorMessage, type AudioInputOption } from "./liveInput";
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
    const changed = () => { invalidate(); void refresh(); };
    navigator.mediaDevices?.addEventListener("devicechange", changed);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", changed);
  }, []);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setLevel(engine.current?.getInputLevel() ?? null), 80);
    return () => window.clearInterval(timer);
  }, [busy]);
  function invalidate() { stop(); setCalibration(undefined); setError(""); onChange(); }
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
  const channelOptions = [{ value: "0", label: "Input 1" }, { value: "1", label: "Input 2" }];
  return <section className="result-panel calibration-panel" aria-labelledby="guitar-calibration-title">
    <header className="panel-title"><span className="step">01 / CONNECT</span><h2 id="guitar-calibration-title">Connect your guitar</h2><p>Plug into your audio interface. Use headphones and keep the output low.</p></header>
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
        <div className="calibration-action-row"><button className="calibration-primary" disabled={busy || !device || !active} onClick={() => void start()}><span aria-hidden="true">≋</span>{calibration ? "Calibrate again" : "Calibrate live guitar"}</button>{busy && <button className="stop" onClick={stop}>Cancel calibration</button>}<p className="calibration-privacy">Choose the instrument input, not Loopback or Stereo Mix. Calibration is silent.</p></div>
        {busy && <p className="calibration-live-status" role="status">Listening for up to 10 seconds after access is granted — play notes and chords now.</p>}
        {level && <p className={`calibration-live-status${level.clipping ? " is-clipping" : ""}`} role="status">{level.clipping ? "Clipping — lower your interface gain" : level.rms < .003 ? "Too quiet — turn up the interface gain" : "Good input level"}</p>}
        {calibration && <div className="success-state" role="status"><strong>Live guitar calibrated</strong><p>You’re ready to match a song’s guitar tone.</p></div>}
      </div>
    <p className="hint">Recalibrate after changing your guitar, pickup, volume or interface gain.</p>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
