import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { demoPassageBounds, formatAudioTime, movePassage, passageWaveformBars, resizePassage, waveformBars, type PassageBounds } from "./referenceWaveform";

interface ReferenceWaveformReviewProps {
  file: File;
  sourceUrl: string;
  outcome: "ready" | "low_quality" | "failed";
  mixPlayer: RefObject<HTMLAudioElement | null>;
  referencePlayer: RefObject<HTMLAudioElement | null>;
  onPlayerStart: (player: "mix" | "reference") => void;
  onContinue: () => void;
}

interface WaveformPlayerProps {
  audioRef: RefObject<HTMLAudioElement | null>;
  bars: readonly number[];
  duration: number;
  fileName?: string;
  label: string;
  description: string;
  sourceUrl: string;
  passage?: PassageBounds;
  highlightedPassage?: PassageBounds;
  onPassageChange?: (passage: PassageBounds) => void;
  onStart: () => void;
}

function Waveform({ bars, duration, highlightedPassage }: Pick<WaveformPlayerProps, "bars" | "duration" | "highlightedPassage">) {
  return <div className="waveform" aria-hidden="true">
    {bars.map((height, index) => {
      const time = duration * ((index + 0.5) / bars.length);
      const highlighted = highlightedPassage && time >= highlightedPassage.start && time <= highlightedPassage.end;
      return <span className={highlighted ? "is-highlighted" : undefined} key={index} style={{ "--bar-height": `${Math.round(height * 100)}%` } as CSSProperties} />;
    })}
  </div>;
}

function VolumeIcon({ muted }: { muted: boolean }) {
  return <svg className="volume-icon" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M3 8h3l4-3v10l-4-3H3z" fill="currentColor" />
    {!muted && <><path d="M12.5 7.2c1.1 1.5 1.1 4.1 0 5.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /><path d="M15 5.4c2.1 2.5 2.1 6.7 0 9.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></>}
    {muted && <path d="M13 7l4 6m0-6-4 6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />}
  </svg>;
}

type PassageDragMode = "start" | "move" | "end";

interface PassageDrag {
  mode: PassageDragMode;
  pointerId: number;
  startX: number;
  passage: PassageBounds;
}

function PassageSelector({ bars, duration, passage, onChange }: { bars: readonly number[]; duration: number; passage: PassageBounds; onChange: (passage: PassageBounds) => void }) {
  const editor = useRef<HTMLDivElement>(null);
  const drag = useRef<PassageDrag | undefined>(undefined);
  const left = duration > 0 ? (passage.start / duration) * 100 : 0;
  const width = duration > 0 ? ((passage.end - passage.start) / duration) * 100 : 0;

  function beginDrag(event: PointerEvent<HTMLButtonElement>, mode: PassageDragMode) {
    event.preventDefault();
    drag.current = { mode, pointerId: event.pointerId, startX: event.clientX, passage };
    editor.current?.setPointerCapture(event.pointerId);
  }

  function updateDrag(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    const bounds = editor.current?.getBoundingClientRect();
    if (!active || !bounds || event.pointerId !== active.pointerId || bounds.width <= 0) return;
    const delta = ((event.clientX - active.startX) / bounds.width) * duration;
    if (active.mode === "move") onChange(movePassage(active.passage, delta, duration));
    else onChange(resizePassage(active.passage, active.mode, (active.mode === "start" ? active.passage.start : active.passage.end) + delta, duration));
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    if (editor.current?.hasPointerCapture(event.pointerId)) editor.current.releasePointerCapture(event.pointerId);
    drag.current = undefined;
  }

  function keyboardAdjust(event: KeyboardEvent<HTMLButtonElement>, mode: PassageDragMode) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 1 : 0.25;
    if (mode === "move") {
      const delta = event.key === "Home" ? -duration : event.key === "End" ? duration : event.key === "ArrowLeft" ? -step : step;
      onChange(movePassage(passage, delta, duration));
      return;
    }
    const current = mode === "start" ? passage.start : passage.end;
    const next = event.key === "Home" ? 0 : event.key === "End" ? duration : current + (event.key === "ArrowLeft" ? -step : step);
    onChange(resizePassage(passage, mode, next, duration));
  }

  return <div className="waveform-editor" ref={editor} onPointerMove={updateDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
    <Waveform bars={bars} duration={duration} highlightedPassage={passage} />
    <div className="passage-selection" style={{ left: `${left}%`, width: `${width}%` }}>
      <button className="passage-handle start" type="button" aria-label={`Change passage start, currently ${formatAudioTime(passage.start)}`} onPointerDown={(event) => beginDrag(event, "start")} onKeyDown={(event) => keyboardAdjust(event, "start")} />
      <button className="passage-move" type="button" aria-label={`Move selected passage, ${formatAudioTime(passage.start)} to ${formatAudioTime(passage.end)}`} onPointerDown={(event) => beginDrag(event, "move")} onKeyDown={(event) => keyboardAdjust(event, "move")}><span>Drag passage</span></button>
      <button className="passage-handle end" type="button" aria-label={`Change passage end, currently ${formatAudioTime(passage.end)}`} onPointerDown={(event) => beginDrag(event, "end")} onKeyDown={(event) => keyboardAdjust(event, "end")} />
    </div>
  </div>;
}

function WaveformPlayer({ audioRef, bars, duration, fileName, label, description, sourceUrl, passage, highlightedPassage, onPassageChange, onStart }: WaveformPlayerProps) {
  const start = passage?.start ?? 0;
  const end = passage?.end ?? duration;
  const [currentTime, setCurrentTime] = useState(start);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const visibleTime = Math.max(0, currentTime - start);
  const visibleDuration = Math.max(0, end - start);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = start;
    setCurrentTime(start);
    setPlaying(false);
  }, [audioRef, sourceUrl, start]);

  function updateTime() {
    const audio = audioRef.current;
    if (!audio) return;
    if (passage && audio.currentTime >= end) {
      audio.pause();
      audio.currentTime = end;
      setCurrentTime(end);
      setPlaying(false);
      return;
    }
    setCurrentTime(audio.currentTime);
  }

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (audio.currentTime < start || audio.currentTime >= end - 0.05) audio.currentTime = start;
    try {
      await audio.play();
    } catch {
      setPlaying(false);
    }
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.min(end, Math.max(start, value + start));
    setCurrentTime(audio.currentTime);
  }

  function toggleMute() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  }

  function changeVolume(value: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = value;
    audio.muted = false;
    setVolume(value);
    setMuted(false);
  }

  const selectionLabelStyle = highlightedPassage && duration > 0 ? {
    "--selection-start": `${(highlightedPassage.start / duration) * 100}%`,
    "--selection-end": `${(highlightedPassage.end / duration) * 100}%`,
  } as CSSProperties : undefined;

  return <article className="waveform-player">
    <header className="waveform-player-heading">
      <div><h3>{label}</h3><p>{description}</p></div>
      {fileName && <span className="audio-file-chip" title={fileName}><span aria-hidden="true">♫</span>{fileName}</span>}
      {passage && <span className="passage-length">{Math.round(visibleDuration)} sec</span>}
    </header>
    {highlightedPassage && onPassageChange
      ? <PassageSelector bars={bars} duration={duration} passage={highlightedPassage} onChange={onPassageChange} />
      : <Waveform bars={bars} duration={duration} highlightedPassage={highlightedPassage} />}
    <div className="waveform-time-labels" aria-hidden="true" style={selectionLabelStyle}>
      <span>{passage ? formatAudioTime(0) : "0:00"}</span>
      {highlightedPassage && <><span className="selection-start">{formatAudioTime(highlightedPassage.start)}</span><span className="selection-end">{formatAudioTime(highlightedPassage.end)}</span></>}
      <span>{formatAudioTime(visibleDuration)}</span>
    </div>
    <div className="waveform-transport">
      <button className="waveform-play" type="button" onClick={() => void togglePlayback()} aria-label={`${playing ? "Pause" : "Play"} ${label.toLowerCase()}`}><span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span></button>
      <output>{formatAudioTime(visibleTime)} / {formatAudioTime(visibleDuration)}</output>
      <input type="range" min={0} max={visibleDuration || 0} step="0.01" value={Math.min(visibleTime, visibleDuration)} onChange={(event) => seek(Number(event.target.value))} aria-label={`Seek ${label.toLowerCase()}`} />
      <div className="waveform-volume">
        <button className="waveform-mute" type="button" onClick={toggleMute} aria-label={`${muted ? "Unmute" : "Mute"} ${label.toLowerCase()}`}><VolumeIcon muted={muted || volume === 0} /></button>
        <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(event) => changeVolume(Number(event.target.value))} aria-label={`${label} volume`} aria-valuetext={`${Math.round(volume * 100)} percent`} />
      </div>
    </div>
    <audio className="waveform-audio" ref={audioRef} preload="metadata" src={sourceUrl} onLoadedMetadata={(event) => { event.currentTarget.currentTime = start; setCurrentTime(start); }} onPlay={() => { setPlaying(true); onStart(); }} onPause={() => setPlaying(false)} onTimeUpdate={updateTime} onEnded={() => setPlaying(false)}>Your browser does not support audio playback.</audio>
  </article>;
}

export function ReferenceWaveformReview({ file, sourceUrl, outcome, mixPlayer, referencePlayer, onPlayerStart, onContinue }: ReferenceWaveformReviewProps) {
  const [duration, setDuration] = useState(0);
  const [bars, setBars] = useState<number[]>([]);
  const [detailedBars, setDetailedBars] = useState<number[]>([]);
  const [passage, setPassage] = useState<PassageBounds>({ start: 0, end: 0 });
  const [waveformState, setWaveformState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    setWaveformState("loading");
    void (async () => {
      let context: AudioContext | undefined;
      try {
        context = new AudioContext();
        const buffer = await context.decodeAudioData(await file.arrayBuffer());
        if (!active) return;
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
        const nextPassage = demoPassageBounds(buffer.duration);
        setDuration(buffer.duration);
        setBars(waveformBars(channels));
        setDetailedBars(waveformBars(channels, 560));
        setPassage(nextPassage);
        setWaveformState("ready");
      } catch {
        if (active) setWaveformState("error");
      } finally {
        await context?.close().catch(() => undefined);
      }
    })();
    return () => { active = false; };
  }, [file]);

  const selectedBars = useMemo(() => passageWaveformBars(detailedBars, duration, passage), [detailedBars, duration, passage]);
  const passageDescription = `${formatAudioTime(passage.start)}–${formatAudioTime(passage.end)} · Your selection`;

  return <section className="result-panel reference-review" aria-labelledby="result-title">
    <div className="result-heading">
      <div><span className="step">03 / REFERENCE</span><h2 id="result-title">Choose your passage</h2><p>Drag the highlighted region or resize its edges, then compare your selection.</p></div>
      <span className={outcome === "low_quality" ? "quality-badge warning" : "quality-badge"}>{outcome === "low_quality" ? "Needs another listen" : "Demo result"}</span>
    </div>
    {outcome === "low_quality" && <p className="warning-message" role="status"><strong>This section may be hard to match.</strong> Try another demo result or choose a different song.</p>}
    {waveformState === "loading" && <div className="waveform-loading" role="status">Reading the waveform from your local audio…</div>}
    {waveformState === "error" && <div className="waveform-loading error" role="alert">This browser could not draw the waveform. Choose a supported WAV or MP3 and try again.</div>}
    {waveformState === "ready" && <div className="players waveform-players">
      <WaveformPlayer audioRef={mixPlayer} bars={bars} duration={duration} fileName={file.name} label="Original song" description={`Uploaded audio · ${formatAudioTime(duration)}`} sourceUrl={sourceUrl} highlightedPassage={passage} onPassageChange={setPassage} onStart={() => onPlayerStart("mix")} />
      <WaveformPlayer audioRef={referencePlayer} bars={selectedBars} duration={passage.end - passage.start} label="Selected passage" description={passageDescription} sourceUrl={sourceUrl} passage={passage} onStart={() => onPlayerStart("reference")} />
    </div>}
    <div className="passage-explanation"><span className="passage-info-icon" aria-hidden="true">i</span><div><span>About your selection</span><p>This preview uses the passage you choose from the original file. Guitar isolation and automatic passage analysis have not been performed.</p></div></div>
    <div className="reference-next"><p>Review the selection before continuing.</p><button type="button" onClick={onContinue}>Continue to tone controls <span aria-hidden="true">→</span></button></div>
  </section>;
}
