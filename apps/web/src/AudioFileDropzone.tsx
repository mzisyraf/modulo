import { useEffect, useRef, useState, type DragEvent } from "react";

interface AudioFileDropzoneProps {
  accept: string;
  compact?: boolean;
  disabled?: boolean;
  file?: File;
  formats: string;
  help?: string;
  id: string;
  maxBytes: number;
  onFile: (file?: File) => void;
  readyLabel?: string;
}

const knownAudioExtension = /\.(aac|flac|m4a|mp3|ogg|opus|wav|webm)$/i;

function fileSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function fileFormat(file: File): string {
  const type = file.type.split(";", 1)[0].replace(/^audio\//, "").trim();
  if (type) return type.toUpperCase();
  return file.name.split(".").pop()?.toUpperCase() || "AUDIO";
}

function AudioDocumentIcon() {
  return <svg aria-hidden="true" viewBox="0 0 32 32"><path d="M8.5 3.5h10l5 5v20h-15z" /><path d="M18.5 3.5v6h5" /><path d="M18.5 14v8.5" /><path d="M18.5 16.5l-5.5 1.4v6" /><circle cx="11.4" cy="24.2" r="2.1" /><circle cx="16.8" cy="22.8" r="2.1" /></svg>;
}

function durationLabel(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function AudioFileDropzone({ accept, compact = false, disabled = false, file, formats, help, id, maxBytes, onFile, readyLabel = "ready locally" }: AudioFileDropzoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [duration, setDuration] = useState<number>();

  useEffect(() => {
    setDuration(undefined);
    if (!file) return;
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    const loaded = () => { if (Number.isFinite(audio.duration)) setDuration(audio.duration); };
    audio.addEventListener("loadedmetadata", loaded);
    return () => {
      audio.removeEventListener("loadedmetadata", loaded);
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
    };
  }, [file]);

  function selectFile(nextFile?: File) {
    if (!nextFile) return;
    const allowedExtensions = accept.split(",").filter((entry) => entry.trim().startsWith("."));
    const extensionAllowed = allowedExtensions.length === 0 || allowedExtensions.some((extension) => nextFile.name.toLowerCase().endsWith(extension.trim().toLowerCase()));
    const looksLikeAudio = nextFile.type.startsWith("audio/") || knownAudioExtension.test(nextFile.name);
    if (!looksLikeAudio || !extensionAllowed) {
      setError(`Choose an audio file in one of these formats: ${formats}.`);
      return;
    }
    if (nextFile.size > maxBytes) {
      setError(`This file is ${fileSize(nextFile.size)}. Choose one no larger than ${fileSize(maxBytes)}.`);
      return;
    }
    setError("");
    onFile(nextFile);
  }

  function dropFile(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (!disabled) selectFile(event.dataTransfer.files[0]);
  }

  function removeFile() {
    setError("");
    if (input.current) input.current.value = "";
    onFile(undefined);
  }

  return <div className={`audio-upload ${compact ? "is-compact" : ""}`}>
    <label
      className={`audio-dropzone ${dragging ? "is-dragging" : ""} ${disabled ? "is-disabled" : ""}`}
      htmlFor={id}
      onDragEnter={(event) => { event.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = disabled ? "none" : "copy"; }}
      onDrop={dropFile}
    >
      <input
        ref={input}
        id={id}
        className="audio-file-input"
        type="file"
        accept={accept}
        disabled={disabled}
        aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
        onChange={(event) => selectFile(event.currentTarget.files?.[0])}
      />
      <span className="audio-upload-icon"><AudioDocumentIcon /></span>
      <strong><span>Drop an audio file</span> here</strong>
      <small>or click to browse</small>
      <span className="audio-upload-button">Choose file</span>
      <span className="audio-upload-help" id={`${id}-help`}>{help ?? `${formats} · up to ${fileSize(maxBytes)} · stays on this device`}</span>
    </label>

    {error && <p className="audio-upload-error" id={`${id}-error`} role="alert">{error}</p>}
    {file && <div className="audio-file-card">
      <span className="audio-file-mark"><AudioDocumentIcon /></span>
      <span className="audio-file-copy"><strong title={file.name}>{file.name}</strong><small>{fileFormat(file)} · {fileSize(file.size)}{duration === undefined ? "" : ` · ${durationLabel(duration)}`} · {readyLabel}</small></span>
      <button type="button" className="audio-file-remove" disabled={disabled} aria-label={`Remove ${file.name}`} onClick={removeFile}>×</button>
    </div>}
  </div>;
}
