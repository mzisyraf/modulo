export const MAX_PERFORMANCE_RECORDINGS = 12;
export const MAX_PERFORMANCE_RECORDING_SECONDS = 180;
export const MAX_PERFORMANCE_RECORDING_BYTES = 50 * 1024 * 1024;

export interface PerformanceTake {
  blob: Blob;
  durationSeconds: number;
  mimeType: string;
  sampleRate?: number;
  stopReason: "manual" | "duration_limit" | "source_stopped";
  guitarOnly?: PerformanceTake;
}

export type PerformanceRecordingMode = "guitar" | "mix";

export interface BackingRecordingDetails {
  jobId: string;
  title: string;
  startSeconds: number;
  gainDb: number;
}

export interface PerformanceRecording extends PerformanceTake {
  id: string;
  createdAt: number;
  projectId: string;
  projectTitle: string;
  presetName: string;
  mode: PerformanceRecordingMode;
  camera: boolean;
  backing?: BackingRecordingDetails;
}

export interface PerformanceRecordingDetails {
  id?: string;
  createdAt?: number;
  projectId: string;
  projectTitle: string;
  presetName: string;
  mode?: PerformanceRecordingMode;
  camera?: boolean;
  backing?: BackingRecordingDetails;
}

export function createPerformanceRecording(
  take: PerformanceTake,
  details: PerformanceRecordingDetails,
): PerformanceRecording {
  if (!(take.blob instanceof Blob) || take.blob.size === 0) {
    throw new Error("The performance recording is empty.");
  }
  const totalBytes = take.blob.size + (take.guitarOnly?.blob.size ?? 0);
  if (totalBytes > MAX_PERFORMANCE_RECORDING_BYTES) {
    throw new Error("Performance recordings must be 50 MB or smaller.");
  }
  if (!Number.isFinite(take.durationSeconds) || take.durationSeconds <= 0 || take.durationSeconds > MAX_PERFORMANCE_RECORDING_SECONDS) {
    throw new Error("Performance recordings must be between 0 and 3 minutes.");
  }
  const mimeType = take.mimeType.trim().toLowerCase();
  const mediaType = mimeType.split(";", 1)[0];
  if (!mediaType.startsWith("audio/") && !mediaType.startsWith("video/")) {
    throw new Error("The performance recorder must return an audio or video format.");
  }
  const mode = details.mode ?? "guitar";
  const camera = details.camera ?? mediaType.startsWith("video/");
  if (camera !== mediaType.startsWith("video/")) throw new Error("Camera recordings must use a video format.");
  if (mode === "mix" && !details.backing) throw new Error("Mixed performances must retain backing metadata.");
  if ((mode === "mix" || camera) && !take.guitarOnly) throw new Error("Mixed and camera performances must retain a guitar-only master.");
  if (take.guitarOnly && !take.guitarOnly.mimeType.toLowerCase().startsWith("audio/")) throw new Error("The guitar-only master must use an audio format.");

  return {
    ...take,
    mimeType,
    id: details.id ?? crypto.randomUUID(),
    createdAt: details.createdAt ?? Date.now(),
    projectId: details.projectId,
    projectTitle: details.projectTitle.trim() || "Untitled Tone Match",
    presetName: details.presetName.trim() || "Custom preset",
    mode,
    camera,
    backing: details.backing,
  };
}

export function addPerformanceRecording(
  recordings: PerformanceRecording[],
  recording: PerformanceRecording,
): PerformanceRecording[] {
  return [recording, ...recordings.filter((candidate) => candidate.id !== recording.id)]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_PERFORMANCE_RECORDINGS);
}

export function recordingFileExtension(mimeType: string): string {
  const normalized = mimeType.split(";", 1)[0].trim().toLowerCase();
  if (normalized === "audio/wav" || normalized === "audio/wave" || normalized === "audio/x-wav") return "wav";
  if (normalized === "audio/ogg") return "ogg";
  if (normalized === "audio/mp4" || normalized === "audio/aac") return "m4a";
  if (normalized === "audio/mpeg") return "mp3";
  if (normalized === "video/mp4") return "mp4";
  return "webm";
}

export function formatRecordingDuration(durationSeconds: number): string {
  const totalSeconds = Math.max(0, Math.round(durationSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

