import { useEffect, useMemo } from "react";
import { formatRecordingDuration, recordingFileExtension, type PerformanceRecording } from "./performanceRecordings";

interface RecordingLibraryProps {
  onDelete: (recordingId: string) => void;
  onOpenToneMatch: () => void;
  recordings: PerformanceRecording[];
}

function downloadName(recording: PerformanceRecording): string {
  const safeTitle = recording.projectTitle.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "modulo-take";
  return `${safeTitle}-${new Date(recording.createdAt).toISOString().slice(0, 10)}.${recordingFileExtension(recording.mimeType)}`;
}

function masterDownloadName(recording: PerformanceRecording): string {
  const base = downloadName(recording).replace(/\.[^.]+$/, "");
  return `${base}-guitar-master.${recordingFileExtension(recording.guitarOnly?.mimeType ?? "audio/webm")}`;
}

function stopReasonLabel(recording: PerformanceRecording): string {
  if (recording.stopReason === "duration_limit") return "3-minute limit";
  if (recording.stopReason === "source_stopped") return "Source stopped";
  return "Finished manually";
}

export function RecordingLibrary({ onDelete, onOpenToneMatch, recordings }: RecordingLibraryProps) {
  const sources = useMemo(() => new Map(recordings.map((recording) => [recording.id, {
    presentation: URL.createObjectURL(recording.blob),
    master: recording.guitarOnly ? URL.createObjectURL(recording.guitarOnly.blob) : undefined,
  }])), [recordings]);

  useEffect(() => () => {
    for (const source of sources.values()) {
      URL.revokeObjectURL(source.presentation);
      if (source.master) URL.revokeObjectURL(source.master);
    }
  }, [sources]);

  return <div className="recordings-view">
    <section className="recordings-intro" aria-labelledby="recordings-title">
      <div><span className="eyebrow">LOCAL RECORDINGS</span><h2 id="recordings-title">Your performances.</h2><p>Review guitar-only, mixed-backing and optional camera takes captured during this browser session.</p></div>
      <div className="recording-memory-note"><span aria-hidden="true">◌</span><div><strong>Saved in this tab</strong><small>Refresh or close the tab to clear them.</small></div></div>
    </section>

    <section className="recording-capture-status" aria-labelledby="capture-status-title">
      <div className="recording-status-icon" aria-hidden="true">●</div>
      <div><span className="step">PERFORMANCE CAPTURE</span><h3 id="capture-status-title">Record from Tone Match</h3><p>Start live input or a dry recording, choose guitar-only or guitar + backing, then optionally enable the camera. Everything stays local to this tab.</p></div>
      <button onClick={onOpenToneMatch}>Open recorder</button>
    </section>

    <section className="recording-library" aria-labelledby="take-library-title">
      <div className="section-heading"><div><span className="step">THIS SESSION</span><h2 id="take-library-title">Saved takes</h2></div><span className="local-chip">{recordings.length} {recordings.length === 1 ? "take" : "takes"}</span></div>
      {recordings.length === 0 ? <div className="recording-empty">
        <div className="recording-empty-mark" aria-hidden="true"><span>●</span></div>
        <div><h3>No performance recordings yet</h3><p>Start live input or dry-audio playback in Tone Match and record a processed, mixed or camera take. Finished recordings appear here; nothing is uploaded.</p></div>
        <button className="secondary" onClick={onOpenToneMatch}>Return to Tone Match</button>
      </div> : <div className="recording-list">{recordings.map((recording, index) => <article className="recording-card" key={recording.id}>
        <div className="recording-number" aria-hidden="true">{String(recordings.length - index).padStart(2, "0")}</div>
        <div className="recording-details"><span className="project-kicker">{recording.camera ? "CAMERA PERFORMANCE" : recording.mode === "mix" ? "GUITAR + BACKING" : "PROCESSED GUITAR"}</span><h3>{recording.projectTitle}</h3><p>{recording.presetName} · {formatRecordingDuration(recording.durationSeconds)} · {stopReasonLabel(recording)} · {recording.mimeType}{recording.sampleRate ? ` · ${recording.sampleRate} Hz` : ""}</p>{recording.backing && <p className="recording-backing">Guitar-reduced backing · starts at {formatRecordingDuration(recording.backing.startSeconds)} · {recording.backing.gainDb} dB · residual guitar may remain.</p>}{recording.camera ? <video controls playsInline preload="metadata" src={sources.get(recording.id)?.presentation}>Your browser does not support video playback.</video> : <audio controls preload="metadata" src={sources.get(recording.id)?.presentation}>Your browser does not support audio playback.</audio>}{sources.get(recording.id)?.master && <details className="recording-master"><summary>Processed-guitar master</summary><p>This independent master excludes the backing and camera.</p><audio controls preload="metadata" src={sources.get(recording.id)?.master} /></details>}</div>
        <div className="recording-actions"><a className="button-link" href={sources.get(recording.id)?.presentation} download={downloadName(recording)}>Download {recording.camera ? "video" : recording.mode === "mix" ? "mix" : "take"}</a>{sources.get(recording.id)?.master && <a className="button-link secondary" href={sources.get(recording.id)?.master} download={masterDownloadName(recording)}>Guitar master</a>}<button className="danger-action" onClick={() => onDelete(recording.id)}>Delete</button></div>
      </article>)}</div>}
    </section>
  </div>;
}

