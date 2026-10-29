import { recordProcessedOutput, MAX_RECORDING_BYTES, type PerformanceTake, type PerformanceRecordingOptions, type ProcessedRecording } from "../recording.ts";

export interface RigTake { dry?: PerformanceTake; wet?: PerformanceTake; startedAtContextSeconds: number; alignment: "independent-encoders" }
export interface RigRecordingOptions extends PerformanceRecordingOptions { mode?: "dry" | "wet" | "both" }
export interface RigRecording { result: Promise<RigTake>; stop: ProcessedRecording["stop"]; cancel: () => void; state: ProcessedRecording["state"] }

/** Dry is the selected channel BEFORE trim/effects. Wet is the protected audible output. */
export function recordRig(context: AudioContext, dry: AudioNode, wet: AudioNode, options: RigRecordingOptions = {}): RigRecording {
  const mode = options.mode ?? "both";
  if (!["dry", "wet", "both"].includes(mode)) throw new Error("Choose dry, wet or both recording mode.");
  const total = options.maxBytes ?? MAX_RECORDING_BYTES;
  if (!Number.isInteger(total) || total <= 0 || total > MAX_RECORDING_BYTES) throw new Error("Invalid recording byte budget.");
  const sessions: { key: "dry" | "wet"; session: ProcessedRecording }[] = [];
  const startedAtContextSeconds = context.currentTime;
  try {
    for (const key of (mode === "both" ? ["dry", "wet"] : [mode]) as ("dry" | "wet")[]) {
      sessions.push({ key, session: recordProcessedOutput(context, key === "dry" ? dry : wet, { ...options, maxBytes: mode === "both" ? Math.floor(total / 2) : total }) });
    }
  } catch (error) {
    for (const { session } of sessions) { void session.result.catch(() => {}); session.cancel(); }
    throw error;
  }
  const result = Promise.all(sessions.map(async ({ key, session }) => [key, await session.result] as const))
    .then(entries => ({ ...Object.fromEntries(entries), startedAtContextSeconds, alignment: "independent-encoders" as const }))
    .catch(error => { sessions.forEach(({ session }) => session.cancel()); throw error; });
  return { result, stop: reason => sessions.forEach(({ session }) => session.stop(reason)), cancel: () => sessions.forEach(({ session }) => session.cancel()), state: () => sessions.some(({ session }) => session.state() === "stopping") ? "stopping" : "recording" };
}
