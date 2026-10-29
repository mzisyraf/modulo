import assert from "node:assert/strict";
import { test } from "node:test";
import { recordProcessedOutput } from "../src/recording.ts";

class Recorder {
  static current: Recorder;
  static supported = "audio/webm;codecs=opus";
  static failStart = false;
  static isTypeSupported(value: string) { return value === this.supported; }
  state = "inactive";
  mimeType: string;
  stopped = false;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_stream: unknown, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? "audio/mp4"; Recorder.current = this;
  }
  start(timeslice: number) {
    assert.equal(timeslice, 250);
    if (Recorder.failStart) throw new Error("Encoder start failed");
    this.state = "recording";
  }
  stop() { this.stopped = true; this.state = "inactive"; }
  data(value = "audio") { this.ondataavailable?.({ data: new Blob([value], { type: this.mimeType }) }); }
  finalized() { this.onstop?.(); }
}

function setup(run: (context: any, output: any, destination: any) => Promise<void> | void) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "MediaRecorder");
  Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: Recorder });
  Recorder.supported = "audio/webm;codecs=opus"; Recorder.failStart = false;
  const track = { stopped: false, stop() { this.stopped = true; } };
  const destination = { disconnected: false, disconnect() { this.disconnected = true; }, stream: { getTracks: () => [track] }, track };
  const output = { routes: ["headphones"] as unknown[], connect(node: unknown) { this.routes.push(node); }, disconnect(node: unknown) { this.routes = this.routes.filter(route => route !== node); } };
  const context = { currentTime: 0, sampleRate: 48000, createMediaStreamDestination: () => destination };
  return Promise.resolve().then(() => run(context, output, destination)).finally(() => {
    if (original) Object.defineProperty(globalThis, "MediaRecorder", original); else Reflect.deleteProperty(globalThis, "MediaRecorder");
  });
}

test("processed recording waits for final chunks, reports actual format, and preserves headphone route", () => setup(async (context, output, destination) => {
  const session = recordProcessedOutput(context, output);
  assert.deepEqual(output.routes, ["headphones", destination]);
  Recorder.current.data("first"); context.currentTime = 1.5; session.stop();
  let complete = false; void session.result.then(() => { complete = true; });
  await Promise.resolve(); assert.equal(complete, false);
  Recorder.current.data("last"); Recorder.current.finalized();
  const take = await session.result;
  assert.equal(await take.blob.text(), "firstlast");
  assert.equal(take.mimeType, "audio/webm;codecs=opus");
  assert.equal(take.durationSeconds, 1.5);
  assert.equal(take.stopReason, "manual");
  assert.equal(take.sampleRate, 48000);
  assert.ok(destination.track.stopped && destination.disconnected);
  assert.deepEqual(output.routes, ["headphones"]);
}));

test("cancel discards buffered audio and rejects AbortError without removing monitoring", () => setup(async (context, output, destination) => {
  const session = recordProcessedOutput(context, output);
  Recorder.current.data(); session.cancel(); session.cancel();
  await assert.rejects(session.result, { name: "AbortError" });
  assert.ok(Recorder.current.stopped && destination.track.stopped);
  assert.deepEqual(output.routes, ["headphones"]);
}));

test("oversized final chunk discards the entire take instead of returning a broken container", () => setup(async (context, output, destination) => {
  const session = recordProcessedOutput(context, output, { maxBytes: 5 });
  Recorder.current.data("1234"); context.currentTime = 1; session.stop();
  Recorder.current.data("56"); Recorder.current.finalized();
  await assert.rejects(session.result, /size limit/);
  assert.ok(destination.track.stopped);
}));

test("duration timer automatically finishes with a bounded duration", (t) => setup(async (context, output) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const session = recordProcessedOutput(context, output, { maxSeconds: 2 });
  context.currentTime = 1.95; t.mock.timers.tick(1900);
  assert.equal(session.state(), "stopping");
  Recorder.current.data(); Recorder.current.finalized();
  const take = await session.result;
  assert.equal(take.durationSeconds, 1.95);
  assert.equal(take.stopReason, "duration_limit");
  t.mock.timers.reset();
}));

test("late duration timer cannot hide an overlong take behind capped metadata", () => setup(async (context, output) => {
  const session = recordProcessedOutput(context, output, { maxSeconds: 2 });
  context.currentTime = 3; Recorder.current.data(); session.stop("duration_limit"); Recorder.current.finalized();
  await assert.rejects(session.result, /duration limit/);
}));

test("finalization timeout rejects and releases recording resources", (t) => setup(async (context, output, destination) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const session = recordProcessedOutput(context, output);
  context.currentTime = 1; session.stop(); t.mock.timers.tick(5000);
  await assert.rejects(session.result, /finalize/);
  assert.ok(destination.track.stopped);
  t.mock.timers.reset();
}));

test("empty, zero-duration and non-audio recordings fail with cleanup", async () => {
  for (const mode of ["empty", "zero-duration", "non-audio"]) await setup(async (context, output, destination) => {
    const session = recordProcessedOutput(context, output);
    if (mode !== "zero-duration") context.currentTime = 1;
    if (mode === "non-audio") Recorder.current.mimeType = "video/webm";
    if (mode !== "empty") Recorder.current.data();
    session.stop(); Recorder.current.finalized();
    await assert.rejects(session.result, /No playable audio/);
    assert.ok(destination.track.stopped);
  });
});

test("codec negotiation permits supported alternatives or the browser default", async () => {
  for (const supported of ["audio/ogg;codecs=opus", "audio/mp4", ""]) await setup(async (context, output) => {
    Recorder.supported = supported;
    const session = recordProcessedOutput(context, output);
    context.currentTime = 1; Recorder.current.data(); session.stop(); Recorder.current.finalized();
    assert.equal((await session.result).mimeType, supported || "audio/mp4");
  });
});

test("source stop is idempotent, errors and failed starts release the destination", async () => {
  await setup(async (context, output) => {
    const session = recordProcessedOutput(context, output);
    context.currentTime = 1; Recorder.current.data(); session.stop("source_stopped"); session.stop(); Recorder.current.finalized();
    assert.equal((await session.result).stopReason, "source_stopped");
  });
  await setup(async (context, output, destination) => {
    const session = recordProcessedOutput(context, output); Recorder.current.onerror!();
    await assert.rejects(session.result, /encode/); assert.ok(destination.track.stopped);
  });
  await setup(async (context, output, destination) => {
    Recorder.failStart = true;
    const session = recordProcessedOutput(context, output);
    await assert.rejects(session.result, /Encoder start failed/); assert.ok(destination.track.stopped);
  });
});

test("invalid limits reject before allocating any recording stream", () => setup((context, output) => {
  for (const maxSeconds of [0, -1, 181, NaN, Infinity]) assert.throws(() => recordProcessedOutput(context, output, { maxSeconds }), /duration/);
  for (const maxBytes of [0, -1, 1.5, Infinity, 50 * 1024 * 1024 + 1]) assert.throws(() => recordProcessedOutput(context, output, { maxBytes }), /size/);
  Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: undefined });
  assert.throws(() => recordProcessedOutput(context, output), /does not support/);
}));
