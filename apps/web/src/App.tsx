import { useEffect, useRef, useState } from "react";
import { AudioEngine } from "@modulo/audio";
import { parsePreset, type Preset } from "@modulo/contracts";
import example from "../../../fixtures/preset.example.json";

const initialPreset = parsePreset(example);
const controls = [
  ["input_gain_db", "Input gain", -24, 12, 1, "dB"],
  ["drive", "Drive", 0, 1, 0.01, ""],
  ["bass_db", "Bass", -12, 12, 1, "dB"],
  ["mid_db", "Mid", -12, 12, 1, "dB"],
  ["treble_db", "Treble", -12, 12, 1, "dB"],
  ["master_gain_db", "Output level", -36, -6, 1, "dB"],
] as const;

export function App() {
  const [preset, setPreset] = useState<Preset>(initialPreset);
  const [apiState, setApiState] = useState("Checking API…");
  const [audioState, setAudioState] = useState("Stopped");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [bypass, setBypass] = useState(false);
  const [file, setFile] = useState<File>();
  const engine = useRef<AudioEngine | null>(null);

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
      .catch(() => { if (!controller.signal.aborted) setApiState("API unavailable · local example still works"); else setApiState("API check timed out · local example still works"); })
      .finally(() => window.clearTimeout(timeout));
    return () => { controller.abort(); void audio.dispose(); };
  }, []);

  function changeControl(key: keyof Preset["parameters"], value: number) {
    const next = parsePreset({ ...preset, parameters: { ...preset.parameters, [key]: value } });
    engine.current?.applyPreset(next);
    setPreset(next);
  }

  async function play(useFile: boolean) {
    setBusy(true);
    setError("");
    setAudioState("Starting…");
    try {
      const audio = engine.current!;
      const started = await (useFile && file ? audio.playFile(file) : audio.playTestSignal());
      setAudioState(started ? (useFile ? "Playing local recording" : "Playing synthetic test signal") : "Stopped");
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

  return <main>
    <header><span className="eyebrow">modulo / DEVELOPMENT STARTER</span><h1>Find the sound.<br /><em>Make it yours.</em></h1><p>A shared starting point for the guitar tone workflow.</p></header>
    <p className="notice"><strong>Example mode.</strong> Song isolation, automatic passage selection and AI presets are not connected. This preset is manually authored.</p>
    <div className="status" role="status">{apiState}</div>
    <div className="grid">
      <section aria-labelledby="reference-title"><span className="step">01 / REFERENCE</span><h2 id="reference-title">Start with a song</h2><p>Mixed-song upload and guitar analysis will be connected here.</p><button disabled>Song analysis · coming next</button><p className="hint">Isyraf: analysis API · Shazlin: reference player</p><hr /><h3>Team workspace</h3><p>Isyraf — AI &amp; backend<br />Dinnie — audio engine<br />Shazlin — interface</p><p className="hint">Submission deadline: Oct 31, 2026 · 01:00 MYT</p></section>
      <section aria-labelledby="amp-title"><span className="step">02 / PRESET</span><h2 id="amp-title">{preset.name}</h2><p>{preset.description}</p>
        <div className="controls">{controls.map(([key, label, min, max, step, unit]) => <label key={key} htmlFor={key}><span>{label}<output>{preset.parameters[key]} {unit}</output></span><input id={key} type="range" min={min} max={max} step={step} value={preset.parameters[key]} onChange={(event) => changeControl(key, Number(event.target.value))} /></label>)}</div>
        <button className="secondary" onClick={() => void loadApiExample()}>Load API example</button>
      </section>
      <section aria-labelledby="audition-title"><span className="step">03 / AUDITION</span><h2 id="audition-title">Hear the chain</h2><p>Working gain, drive and EQ. Start at a comfortable listening level.</p><button disabled={busy} onClick={() => void play(false)}>Play test signal</button><p className="hint">A two-second synthesized pluck, not an isolated guitar or AI result.</p>
        <label className="file-label" htmlFor="dry-file">Dry guitar recording · local audition only</label><input id="dry-file" type="file" accept="audio/*" onChange={(event) => setFile(event.target.files?.[0])} /><button className="secondary" disabled={!file || busy} onClick={() => void play(true)}>Play dry recording</button>
        <label className="toggle"><input type="checkbox" checked={bypass} onChange={(event) => { setBypass(event.target.checked); engine.current?.setBypass(event.target.checked); }} />Bypass drive and EQ</label>
        <button className="stop" onClick={() => { engine.current?.stop(); setAudioState("Stopped"); }}>Stop audio</button><p role="status">{audioState}</p><hr /><button disabled>Live interface · next audio milestone</button><p className="hint">Cabinet, compressor, delay, reverb and live input remain for Dinnie to implement.</p>
      </section>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    <footer>Draft contract v1 · fixture preset · no audio is uploaded by this starter</footer>
  </main>;
}
