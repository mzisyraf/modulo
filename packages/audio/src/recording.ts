export const MAX_RECORDING_SECONDS = 180;
export const MAX_RECORDING_BYTES = 50 * 1024 * 1024;

export interface PerformanceRecordingOptions {
  maxSeconds?: number;
  maxBytes?: number;
  /** Optional camera track, cloned so the recorder never owns the live preview. */
  videoTrack?: MediaStreamTrack;
}

export interface PerformanceTake {
  blob: Blob;
  durationSeconds: number;
  mimeType: string;
  sampleRate: number;
  stopReason: "manual" | "duration_limit" | "source_stopped";
}

export interface ProcessedRecording {
  result: Promise<PerformanceTake>;
  stop: (reason?: PerformanceTake["stopReason"]) => void;
  cancel: () => void;
  state: () => "recording" | "stopping";
}

/** Only the supplied processed output enters this stream, never a microphone stream. */
export function recordProcessedOutput(context: AudioContext, output: AudioNode, options: PerformanceRecordingOptions = {}): ProcessedRecording {
  const maxSeconds = options.maxSeconds ?? MAX_RECORDING_SECONDS;
  const maxBytes = options.maxBytes ?? MAX_RECORDING_BYTES;
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > MAX_RECORDING_SECONDS) {
    throw new Error("Recording duration must be greater than 0 and at most 180 seconds.");
  }
  if (!Number.isInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_RECORDING_BYTES) {
    throw new Error("Recording size must be a positive integer at most 50 MiB.");
  }
  if (typeof MediaRecorder === "undefined") throw new Error("This browser does not support performance recording.");
  const destination = context.createMediaStreamDestination();
  let recorder: MediaRecorder;
  try {
    if (options.videoTrack) {
      if (options.videoTrack.kind !== "video" || options.videoTrack.readyState === "ended") throw new Error("Choose an active camera before recording video.");
      if (typeof destination.stream.addTrack !== "function") throw new Error("This browser cannot combine camera and processed audio.");
      destination.stream.addTrack(options.videoTrack.clone());
    }
    const candidates = options.videoTrack
      ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]
      : ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
    const mimeType = candidates
      .find((type) => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(destination.stream, mimeType ? { mimeType } : undefined);
  } catch (error) {
    destination.stream.getTracks().forEach((track) => track.stop());
    destination.disconnect();
    throw error;
  }
  const chunks: Blob[] = [];
  let bytes = 0;
  let connected = false;
  let settled = false;
  let stopping = false;
  let reason: PerformanceTake["stopReason"] = "manual";
  let durationSeconds = 0;
  let durationTimer: ReturnType<typeof setTimeout> | undefined;
  let finalizationTimer: ReturnType<typeof setTimeout> | undefined;
  let resolve!: (take: PerformanceTake) => void;
  let reject!: (error: unknown) => void;
  const result = new Promise<PerformanceTake>((yes, no) => { resolve = yes; reject = no; });
  const startTime = context.currentTime;
  const cleanup = () => {
    clearTimeout(durationTimer);
    clearTimeout(finalizationTimer);
    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;
    if (connected) output.disconnect(destination);
    destination.disconnect();
    destination.stream.getTracks().forEach((track) => track.stop());
    chunks.length = 0;
  };
  const fail = (error: unknown) => {
    if (settled) return;
    settled = true;
    if (recorder.state !== "inactive") {
      try { recorder.stop(); } catch { /* Release the destination even if encoding failed. */ }
    }
    cleanup();
    reject(error);
  };
  const stop = (stopReason: PerformanceTake["stopReason"] = "manual") => {
    if (settled || stopping) return;
    stopping = true;
    reason = stopReason;
    durationSeconds = Math.max(0, context.currentTime - startTime);
    clearTimeout(durationTimer);
    finalizationTimer = setTimeout(() => fail(new Error("Recording could not finalize. Please retry.")), 5000);
    try { if (recorder.state !== "inactive") recorder.stop(); }
    catch (error) { fail(error); }
  };
  recorder.ondataavailable = ({ data }) => {
    if (settled || !data.size) return;
    // Never return a truncated container as a successful playable take.
    if (bytes + data.size > maxBytes) {
      fail(new Error("Recording exceeded its size limit and was discarded. Try a shorter take."));
      return;
    }
    bytes += data.size;
    chunks.push(data);
  };
  recorder.onerror = () => fail(new Error("The browser could not encode the performance recording."));
  recorder.onstop = () => {
    if (settled) return;
    if (!stopping) {
      reason = "source_stopped";
      durationSeconds = Math.max(0, context.currentTime - startTime);
    }
    if (durationSeconds > maxSeconds) {
      fail(new Error("Recording exceeded its duration limit and was discarded. Keep the tab active and retry."));
      return;
    }
    const mimeType = recorder.mimeType || chunks.find((chunk) => chunk.type)?.type || "";
    const expectedPrefix = options.videoTrack ? "video/" : "audio/";
    if (!bytes || durationSeconds <= 0 || !mimeType.toLowerCase().startsWith(expectedPrefix)) {
      fail(new Error(options.videoTrack ? "No playable camera performance was recorded. Check camera permission and try again." : "No playable audio was recorded. Start input and try again."));
      return;
    }
    const blob = new Blob(chunks, { type: mimeType });
    settled = true;
    cleanup();
    resolve({ blob, durationSeconds, mimeType: blob.type, sampleRate: context.sampleRate, stopReason: reason });
  };
  try {
    output.connect(destination);
    connected = true;
    recorder.start(250);
    // Leave a small scheduling margin. If a backgrounded tab misses the limit,
    // reject the take rather than mislabeling an overlong file as <= maxSeconds.
    durationTimer = setTimeout(() => stop("duration_limit"), Math.max(0, maxSeconds * 1000 - 100));
  } catch (error) { fail(error); }
  return {
    result, stop,
    cancel: () => fail(new DOMException("Performance recording discarded.", "AbortError")),
    state: () => stopping ? "stopping" : "recording",
  };
}
