import { useEffect, useRef, useState } from "react";
import { calibrateRecording, type CalibratedRecording } from "./recordingCalibration";

export function RecordingCalibration({ onChange }: { onChange: (recording?: CalibratedRecording) => void }) {
  const [recording, setRecording] = useState<CalibratedRecording>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = useRef(0);
  useEffect(() => () => { run.current++; }, []);
  async function choose(file?: File) {
    const request = ++run.current;
    onChange(); setRecording(undefined); setError(""); setBusy(Boolean(file));
    if (!file) return;
    try {
      const next = await calibrateRecording(file);
      if (request === run.current) { setRecording(next); onChange(next); }
    } catch (failure) { if (request === run.current) setError(failure instanceof Error ? failure.message : "Calibration failed; choose the recording again."); }
    finally { if (request === run.current) setBusy(false); }
  }
  return <section className="result-panel" aria-labelledby="recording-calibration-title">
    <span className="step">YOUR STARTING POINT</span><h2 id="recording-calibration-title">Calibrate your guitar recording</h2>
    <p>Choose a dry guitar recording first. Measure its input level to build a neutral starting preset; the song preset adds drive and EQ afterward.</p>
    <label className="file-label" htmlFor="calibration-file">Guitar recording · WAV/MP3 · 3–90 seconds · up to 20 MiB</label>
    <input id="calibration-file" type="file" accept="audio/*,.wav,.mp3,.m4a" onChange={event => void choose(event.target.files?.[0])} />
    {busy && <p role="status">Decoding and measuring your recording locally…</p>}
    {recording && <div className="success-state" role="status"><strong>Input level calibrated: {recording.originalName}</strong>
      <p>Starting input gain {recording.inputGainDb.toFixed(1)} dB · drive and EQ neutral · output −12 dB.</p>
      <p>RMS {recording.measurements.rms_dbfs.toFixed(1)} dBFS · peak {recording.measurements.peak_dbfs.toFixed(1)} dBFS · {recording.measurements.duration_seconds.toFixed(1)} s.</p>
      <p>Leading quiet audio skipped: {recording.skippedSeconds.toFixed(1)} s. The same prepared recording will be used for comparison.</p></div>}
    <p className="hint">Preparation uses the stronger channel and trims quiet ends; your original file is unchanged. Audio stays in this browser. Numeric level measurements go to the local API and Nebius when you Generate. This calibrates input level, not pickups, spectral tone or equipment; audible similarity remains unverified. Use a recording without existing effects. After refreshing or leaving this page, choose the recording again.</p>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
