import { useEffect, useRef, useState, type PointerEvent } from "react";
import { apiJson, referenceBounds } from "./separation";
import { dragInterval, parseReferenceOptions, referenceTime, type ReferenceOptions } from "./referenceSelection";

interface Props {
  jobId: string;
  duration: number;
  start: string;
  end: string;
  confirmed: boolean;
  confirming: boolean;
  onChange: (start: string, end: string) => void;
  onPreview: (track: "mix" | "guitar") => void;
  onStop: () => void;
  onConfirm: () => void;
}

export function ReferenceSelector({ jobId, duration, start, end, confirmed, confirming, onChange, onPreview, onStop, onConfirm }: Props) {
  const [mode, setMode] = useState<"suggested" | "manual">("suggested");
  const [track, setTrack] = useState<"guitar" | "mix">("guitar");
  const [analysis, setAnalysis] = useState<ReferenceOptions>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const drag = useRef<{ kind: "start" | "end" | "move" | "new"; anchor: number; start: number; end: number } | null>(null);
  const interacted = useRef(false);
  const current = useRef({ confirmed, start, end, onChange });
  current.current = { confirmed, start, end, onChange };

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    apiJson(`/api/jobs/${jobId}/references`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]) })
      .then((value) => {
        if (controller.signal.aborted) return;
        const next = parseReferenceOptions(value, duration);
        setAnalysis(next);
        const active = current.current;
        if (active.confirmed) {
          setMode(next.options.some((option) => option.start_seconds === Number(active.start) && option.end_seconds === Number(active.end)) ? "suggested" : "manual");
        } else if (!interacted.current && next.options.length) {
          active.onChange(String(next.options[0].start_seconds), String(next.options[0].end_seconds));
        } else if (!interacted.current) setMode("manual");
      })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Waveforms could not load."); });
    return () => controller.abort();
  }, [jobId, duration, retry]);

  let interval: { start_seconds: number; end_seconds: number } | undefined;
  try { interval = referenceBounds(start, end, duration); } catch { /* Numeric edits may be incomplete. */ }
  const selected = analysis?.options.findIndex((option) => option.start_seconds === Number(start) && option.end_seconds === Number(end)) ?? -1;
  const canConfirm = Boolean(interval && (mode === "manual" || selected >= 0));
  const peakMax = analysis ? Math.max(0.01, ...analysis.waveforms.guitar, ...analysis.waveforms.mix) : 1;
  const peaks = analysis?.waveforms[track] ?? [];
  const path = peaks.map((peak, index) => {
    const x = (index + 0.5) * 1000 / peaks.length;
    const height = peak / peakMax * 43;
    return `M${x.toFixed(1)},${60 - height}v${(height * 2).toFixed(1)}`;
  }).join(" ");

  function choose(first: string, last: string) {
    interacted.current = true; onChange(first, last);
  }
  function changeMode(next: "suggested" | "manual") {
    if (next === mode) return;
    interacted.current = true; onStop(); setMode(next);
    const option = analysis?.options[selected >= 0 ? selected : 0];
    if (next === "suggested" && option) choose(String(option.start_seconds), String(option.end_seconds));
    else choose(start, end);
  }
  function position(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * Math.floor(duration));
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (mode !== "manual" || confirming || event.button !== 0) return;
    interacted.current = true; event.preventDefault(); onStop();
    const edge = (event.target as HTMLElement).closest<HTMLElement>("[data-edge]")?.dataset.edge;
    const kind = edge === "start" || edge === "end" || edge === "move" ? edge : "new";
    const anchor = position(event);
    const first = interval?.start_seconds ?? 0, last = interval?.end_seconds ?? Math.min(15, Math.floor(duration));
    drag.current = { kind, anchor, start: first, end: last };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (kind === "new") {
      const length = Math.min(15, Math.floor(duration));
      const at = Math.min(anchor, Math.floor(duration) - length);
      choose(String(at), String(at + length));
    }
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const selection = drag.current;
    if (!selection || confirming) return;
    const [first, last] = dragInterval(selection.kind, position(event), selection.anchor, selection.start, selection.end, duration);
    choose(String(first), String(last));
  }
  function keyMove(kind: "start" | "end" | "move", key: string, shift: boolean) {
    if (!interval || confirming || mode !== "manual" || !["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Home", "End"].includes(key)) return false;
    interacted.current = true;
    const value = kind === "end" ? interval.end_seconds : interval.start_seconds;
    const at = key === "Home" ? 0 : key === "End" ? Math.floor(duration) : value + (["ArrowLeft", "ArrowDown"].includes(key) ? -1 : 1) * (shift ? 5 : 1);
    const [first, last] = dragInterval(kind, at, value, interval.start_seconds, interval.end_seconds, duration);
    choose(String(first), String(last)); return true;
  }

  return <div className="reference-selector">
    <div className="reference-toolbar"><div className="reference-switch" role="group" aria-label="Reference selection mode">
      <button className={mode === "suggested" ? "selected" : "secondary"} aria-pressed={mode === "suggested"} disabled={confirming} onClick={() => changeMode("suggested")}>Suggested passages</button>
      <button className={mode === "manual" ? "selected" : "secondary"} aria-pressed={mode === "manual"} disabled={confirming} onClick={() => changeMode("manual")}>Manual selection</button>
    </div><div className="reference-switch" role="group" aria-label="Reference listening source">
      {([['guitar', 'Extracted guitar'], ['mix', 'Original mix']] as const).map(([value, title]) => <button key={value} className={track === value ? "selected" : "secondary"} aria-pressed={track === value} onClick={() => { onStop(); setTrack(value); }}>{title}</button>)}
    </div></div>
    <p className="hint">{mode === "suggested" ? "Choose a marked region or a passage below. Suggested boundaries are fixed." : "Drag a new region, move the highlight or resize its edges. Use arrow keys for 1 second, Shift + arrows for 5 seconds, or edit the timestamps."}</p>
    <div className={`reference-waveform ${mode}`} role="group" aria-label="Full-song reference waveform"
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      <svg viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden="true"><path d="M0 60H1000" className="waveform-axis" /><path d={path} className="waveform-peaks" /></svg>
      {analysis?.options.map((option, index) => <button key={index} className={`waveform-suggestion ${mode === "manual" ? "guide" : ""}`} style={{ left: `${option.start_seconds / duration * 100}%`, width: `${(option.end_seconds - option.start_seconds) / duration * 100}%` }}
        disabled={mode === "manual" || confirming} aria-label={`Select reference ${String.fromCharCode(65 + index)} on waveform`} aria-pressed={selected === index}
        onClick={() => choose(String(option.start_seconds), String(option.end_seconds))}><span>{String.fromCharCode(65 + index)}</span></button>)}
      {interval && <div className="waveform-selection" style={{ left: `${interval.start_seconds / duration * 100}%`, width: `${(interval.end_seconds - interval.start_seconds) / duration * 100}%` }}>
        {mode === "manual" && <>
          <button className="waveform-move" data-edge="move" aria-label="Move selected passage" disabled={confirming} onKeyDown={(event) => { if (keyMove("move", event.key, event.shiftKey)) event.preventDefault(); }} />
          {(["start", "end"] as const).map((edge) => <button key={edge} className={`waveform-handle ${edge}`} data-edge={edge} role="slider" aria-label={`Selection ${edge}`} aria-valuemin={edge === "start" ? Math.max(0, interval!.end_seconds - 20) : interval!.start_seconds + 10} aria-valuemax={edge === "start" ? interval!.end_seconds - 10 : Math.min(Math.floor(duration), interval!.start_seconds + 20)} aria-valuenow={edge === "start" ? interval!.start_seconds : interval!.end_seconds} aria-valuetext={referenceTime(edge === "start" ? interval!.start_seconds : interval!.end_seconds)} disabled={confirming} onKeyDown={(event) => { if (keyMove(edge, event.key, event.shiftKey)) event.preventDefault(); }} />)}
        </>}
      </div>}
      {!analysis && <span className="waveform-loading" role="status">{error ? "Waveform unavailable" : "Loading waveform…"}</span>}
    </div>
    <div className="waveform-times"><span>00:00</span><span>{referenceTime(duration / 2)}</span><span>{referenceTime(duration)}</span></div>
    {analysis && <div className="reference-options">{analysis.options.map((option, index) => <button key={index} className={selected === index ? "selected" : "secondary"} disabled={mode === "manual" || confirming} aria-pressed={selected === index} onClick={() => choose(String(option.start_seconds), String(option.end_seconds))}>
      <strong>Reference {String.fromCharCode(65 + index)}</strong><span>{referenceTime(option.start_seconds)}–{referenceTime(option.end_seconds)}</span><small>{option.label}</small></button>)}</div>}
    {analysis?.options.length === 0 && <p role="status">No contrasting passage suggestions found. Select a passage manually.</p>}
    <p className="hint">Suggestions compare signal brightness and dynamics. They do not identify guitars, amps or separate simultaneous guitar parts. Similar songs may yield only one suggestion.</p>
    {error && <p className="error" role="alert">{error} <button className="secondary" onClick={() => setRetry((value) => value + 1)}>Reload waveform</button> Manual timestamps remain available.</p>}
    <div className="interval-fields"><label htmlFor="reference-start">Start · seconds<input id="reference-start" type="number" min="0" max={Math.floor(duration) - 10} step="1" value={start} disabled={mode === "suggested" || confirming} onChange={(event) => choose(event.target.value, end)} /></label>
      <label htmlFor="reference-end">End · seconds<input id="reference-end" type="number" min="10" max={Math.floor(duration)} step="1" value={end} disabled={mode === "suggested" || confirming} onChange={(event) => choose(start, event.target.value)} /></label>
      <output className="reference-duration" aria-live="polite">{interval ? `${referenceTime(interval.start_seconds)}–${referenceTime(interval.end_seconds)} · ${interval.end_seconds - interval.start_seconds}s` : "Select 10–20 whole seconds"}</output>
    </div><div className="preset-actions"><button className="secondary" disabled={!interval || confirming} onClick={() => onPreview(track)}>Play passage</button><button className="secondary" onClick={onStop}>Stop passage</button><button disabled={!canConfirm || confirming} onClick={onConfirm}>{confirming ? "Checking passage…" : confirmed ? "Confirm reference again" : "Confirm reference"}</button></div>
  </div>;
}
