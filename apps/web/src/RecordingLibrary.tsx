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

function stopReasonLabel(recording: PerformanceRecording): string {
  if (recording.stopReason === "duration_limit") return "3-minute limit";
  if (recording.stopReason === "source_stopped") return "Source stopped";
  return "Finished manually";
}

export function RecordingLibrary({ onDelete, onOpenToneMatch, recordings }: RecordingLibraryProps) {
  const sources = useMemo(() => new Map(recordings.map((recording) => [recording.id, URL.createObjectURL(recording.blob)])), [recordings]);

  useEffect(() => () => {
    for (const source of sources.values()) URL.revokeObjectURL(source);
  }, [sources]);

  return <div className="recordings-view">
    <section className="recordings-intro" aria-labelledby="recordings-title">
      <div><span className="eyebrow">LOCAL RECORDINGS</span><h2 id="recordings-title">Your performances.</h2><p>Review processed guitar takes captured during this browser session.</p></div>
      <div className="recording-memory-note"><span aria-hidden="true">◌</span><div><strong>Saved in this tab</strong><small>Refresh or close the tab to clear them.</small></div></div>
    </section>

    <section className="recording-capture-status" aria-labelledby="capture-status-title">
      <div className="recording-status-icon" aria-hidden="true">●</div>
      <div><span className="step">PERFORMANCE CAPTURE</span><h3 id="capture-status-title">Record from Tone Match</h3><p>Start live input, then use Record, Finish or Discard below the input check. Modulo captures the processed guitar sound—not your dry calibration sample.</p></div>
      <button onClick={onOpenToneMatch}>Open recorder</button>
    </section>

    <section className="recording-library" aria-labelledby="take-library-title">
      <div className="section-heading"><div><span className="step">THIS SESSION</span><h2 id="take-library-title">Saved takes</h2></div><span className="local-chip">{recordings.length} {recordings.length === 1 ? "take" : "takes"}</span></div>
      {recordings.length === 0 ? <div className="recording-empty">
        <div className="recording-empty-mark" aria-hidden="true"><span>●</span></div>
        <div><h3>No performance recordings yet</h3><p>Start live input in Tone Match and record a processed take. Finished recordings will appear here; nothing is uploaded.</p></div>
        <button className="secondary" onClick={onOpenToneMatch}>Return to Tone Match</button>
      </div> : <div className="recording-list">{recordings.map((recording, index) => <article className="recording-card" key={recording.id}>
        <div className="recording-number" aria-hidden="true">{String(recordings.length - index).padStart(2, "0")}</div>
        <div className="recording-details"><span className="project-kicker">PROCESSED GUITAR</span><h3>{recording.projectTitle}</h3><p>{recording.presetName} · {formatRecordingDuration(recording.durationSeconds)} · {stopReasonLabel(recording)} · {recording.mimeType}{recording.sampleRate ? ` · ${recording.sampleRate} Hz` : ""}</p><audio controls preload="metadata" src={sources.get(recording.id)}>Your browser does not support audio playback.</audio></div>
        <div className="recording-actions"><a className="button-link" href={sources.get(recording.id)} download={downloadName(recording)}>Download</a><button className="danger-action" onClick={() => onDelete(recording.id)}>Delete</button></div>
      </article>)}</div>}
    </section>
  </div>;
}

