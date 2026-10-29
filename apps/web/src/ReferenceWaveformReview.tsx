import { useEffect, useMemo, useState, type CSSProperties, type RefObject } from "react";
import { demoPassageBounds, formatAudioTime, passageWaveformBars, waveformBars, type PassageBounds } from "./referenceWaveform";

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

function WaveformPlayer({ audioRef, bars, duration, fileName, label, description, sourceUrl, passage, highlightedPassage, onStart }: WaveformPlayerProps) {
  const start = passage?.start ?? 0;
  const end = passage?.end ?? duration;
  const [currentTime, setCurrentTime] = useState(start);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
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
    <Waveform bars={bars} duration={duration} highlightedPassage={highlightedPassage} />
    <div className="waveform-time-labels" aria-hidden="true" style={selectionLabelStyle}>
      <span>{passage ? formatAudioTime(0) : "0:00"}</span>
      {highlightedPassage && <><span className="selection-start">{formatAudioTime(highlightedPassage.start)}</span><span className="selection-end">{formatAudioTime(highlightedPassage.end)}</span></>}
      <span>{formatAudioTime(visibleDuration)}</span>
    </div>
    <div className="waveform-transport">
      <button className="waveform-play" type="button" onClick={() => void togglePlayback()} aria-label={`${playing ? "Pause" : "Play"} ${label.toLowerCase()}`}><span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span></button>
      <output>{formatAudioTime(visibleTime)} / {formatAudioTime(visibleDuration)}</output>
      <input type="range" min={0} max={visibleDuration || 0} step="0.01" value={Math.min(visibleTime, visibleDuration)} onChange={(event) => seek(Number(event.target.value))} aria-label={`Seek ${label.toLowerCase()}`} />
      <button className="waveform-mute" type="button" onClick={toggleMute} aria-label={`${muted ? "Unmute" : "Mute"} ${label.toLowerCase()}`}><span aria-hidden="true">{muted ? "⊘" : "◖))"}</span></button>
    </div>
    <audio className="waveform-audio" ref={audioRef} preload="metadata" src={sourceUrl} onLoadedMetadata={(event) => { event.currentTarget.currentTime = start; setCurrentTime(start); }} onPlay={() => { setPlaying(true); onStart(); }} onPause={() => setPlaying(false)} onTimeUpdate={updateTime} onEnded={() => setPlaying(false)}>Your browser does not support audio playback.</audio>
  </article>;
}

export function ReferenceWaveformReview({ file, sourceUrl, outcome, mixPlayer, referencePlayer, onPlayerStart, onContinue }: ReferenceWaveformReviewProps) {
  const [duration, setDuration] = useState(0);
  const [bars, setBars] = useState<number[]>([]);
  const [selectedBars, setSelectedBars] = useState<number[]>([]);
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
        setSelectedBars(passageWaveformBars(waveformBars(channels, 560), buffer.duration, nextPassage));
        setWaveformState("ready");
      } catch {
        if (active) setWaveformState("error");
      } finally {
        await context?.close().catch(() => undefined);
      }
    })();
    return () => { active = false; };
  }, [file]);

  const passage = useMemo(() => demoPassageBounds(duration), [duration]);
  const passageDescription = `${formatAudioTime(passage.start)}–${formatAudioTime(passage.end)} · Demo selection`;

  return <section className="result-panel reference-review" aria-labelledby="result-title">
    <div className="result-heading">
      <div><span className="step">03 / REFERENCE</span><h2 id="result-title">Review the selected passage</h2><p>Compare your original track with the predefined demo passage.</p></div>
      <span className={outcome === "low_quality" ? "quality-badge warning" : "quality-badge"}>{outcome === "low_quality" ? "Needs another listen" : "Demo result"}</span>
    </div>
    {outcome === "low_quality" && <p className="warning-message" role="status"><strong>This section may be hard to match.</strong> Try another demo result or choose a different song.</p>}
    {waveformState === "loading" && <div className="waveform-loading" role="status">Reading the waveform from your local audio…</div>}
    {waveformState === "error" && <div className="waveform-loading error" role="alert">This browser could not draw the waveform. Choose a supported WAV or MP3 and try again.</div>}
    {waveformState === "ready" && <div className="players waveform-players">
      <WaveformPlayer audioRef={mixPlayer} bars={bars} duration={duration} fileName={file.name} label="Original song" description={`Uploaded audio · ${formatAudioTime(duration)}`} sourceUrl={sourceUrl} highlightedPassage={passage} onStart={() => onPlayerStart("mix")} />
      <WaveformPlayer audioRef={referencePlayer} bars={selectedBars} duration={passage.end - passage.start} label="Selected passage" description={passageDescription} sourceUrl={sourceUrl} passage={passage} onStart={() => onPlayerStart("reference")} />
    </div>}
    <div className="passage-explanation"><span className="passage-info-icon" aria-hidden="true">i</span><div><span>About this passage</span><p>This demo uses a predefined passage from the original file. Guitar isolation and automatic passage analysis have not been performed.</p></div></div>
    <div className="reference-next"><p>Review the selection before continuing.</p><button type="button" onClick={onContinue}>Continue to tone controls <span aria-hidden="true">→</span></button></div>
  </section>;
}
