import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PERFORMANCE_RECORDINGS,
  addPerformanceRecording,
  createPerformanceRecording,
  formatRecordingDuration,
  recordingFileExtension,
} from "../src/performanceRecordings.ts";

const details = { id: "take-one", createdAt: 20, projectId: "project-one", projectTitle: "My Song", presetName: "Starter Crunch" };

test("creates a bounded browser-memory performance recording", () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm;codecs=opus" });
  const recording = createPerformanceRecording({ blob, durationSeconds: 12.4, mimeType: blob.type, sampleRate: 48_000 }, details);

  assert.equal(recording.id, "take-one");
  assert.equal(recording.mimeType, "audio/webm");
  assert.equal(recording.durationSeconds, 12.4);
  assert.equal(recording.sampleRate, 48_000);
});

test("rejects empty, non-audio and overlong takes", () => {
  assert.throws(() => createPerformanceRecording({ blob: new Blob(), durationSeconds: 1, mimeType: "audio/webm" }, details), /empty/);
  assert.throws(() => createPerformanceRecording({ blob: new Blob(["data"]), durationSeconds: 1, mimeType: "video/webm" }, details), /audio format/);
  assert.throws(() => createPerformanceRecording({ blob: new Blob(["data"]), durationSeconds: 181, mimeType: "audio/webm" }, details), /3 minutes/);
});

test("keeps the newest unique recordings within the tab limit", () => {
  const blob = new Blob(["audio"], { type: "audio/webm" });
  let recordings = Array.from({ length: MAX_PERFORMANCE_RECORDINGS }, (_, index) => createPerformanceRecording(
    { blob, durationSeconds: 1, mimeType: blob.type },
    { ...details, id: `take-${index}`, createdAt: index },
  ));
  const newest = createPerformanceRecording({ blob, durationSeconds: 2, mimeType: blob.type }, { ...details, id: "newest", createdAt: 100 });
  recordings = addPerformanceRecording(recordings, newest);

  assert.equal(recordings.length, MAX_PERFORMANCE_RECORDINGS);
  assert.equal(recordings[0].id, "newest");
  assert.equal(recordings.some((recording) => recording.id === "take-0"), false);
});

test("formats duration and actual supported download extensions", () => {
  assert.equal(formatRecordingDuration(65.4), "1:05");
  assert.equal(recordingFileExtension("audio/ogg; codecs=opus"), "ogg");
  assert.equal(recordingFileExtension("audio/mp4"), "m4a");
  assert.equal(recordingFileExtension("audio/unknown"), "webm");
});

