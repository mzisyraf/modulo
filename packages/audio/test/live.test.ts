import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { AudioEngine } from "../src/index.ts";
import example from "../../../fixtures/preset.example.json" with { type: "json" };
import { parsePreset } from "../../../contracts/src/index.ts";

class Track extends EventTarget {
  label = "Synthetic interface";
  readyState = "live";
  stops = 0;
  settings: MediaTrackSettings = { channelCount: 2, sampleRate: 48000, echoCancellation: false };
  stop() { this.readyState = "ended"; this.stops++; }
  getSettings() { return this.settings; }
  end() { this.readyState = "ended"; this.dispatchEvent(new Event("ended")); }
}

class Stream {
  tracks: Track[];
  constructor(tracks: Track[] = [new Track()]) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks; }
}

class Node {
  gain = { value: 1, setTargetAtTime() {} };
  frequency = { value: 0 };
  Q = { value: 0 };
  connections: { node: Node; output: number; input: number }[] = [];
  disconnected = false;
  stopped = false;
  onended: (() => void) | null = null;
  connect(node: Node, output = 0, input = 0) { this.connections.push({ node, output, input }); return node; }
  disconnect() { this.disconnected = true; this.connections = []; }
  start() {}
  stop() { this.stopped = true; }
}

class Context {
  static current: Context;
  state = "running";
  sampleRate = 48000;
  currentTime = 0;
  baseLatency = 0.01;
  outputLatency = 0.02;
  destination = new Node();
  media: Node[] = [];
  samples: Node[] = [];
  splitters: Node[] = [];
  audioWorklet = { addModule: async (_url: string) => {} };
  createAnalyser() {
    return Object.assign(new Node(), { fftSize: 2048, getFloatTimeDomainData: (data: Float32Array) => { data.fill(0.25); } });
  }
  constructor() { Context.current = this; }
  createGain() { return new Node(); }
  createWaveShaper() { return new Node(); }
  createBiquadFilter() { return new Node(); }
  createBuffer() { return { copyToChannel() {} }; }
  createBufferSource() { const node = new Node(); this.samples.push(node); return node; }
  createMediaStreamSource() { const node = new Node(); this.media.push(node); return node; }
  createChannelSplitter(count: number) {
    assert.equal(count, 2);
    const node = new Node(); this.splitters.push(node); return node;
  }
  async close() { this.state = "closed"; }
}

class Worklet extends Node {
  static current: Worklet;
  onprocessorerror: (() => void) | null = null;
  messages: unknown[] = [];
  closed = false;
  port = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage: (message: unknown) => { this.messages.push(message); },
    close: () => { this.closed = true; },
  };
  constructor(_context: unknown, name: string, publicOptions: unknown) {
    super(); assert.equal(name, "modulo-calibration"); Worklet.current = this;
  }
  send(data: unknown) { this.port.onmessage?.({ data }); }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function withEngine(run: (engine: AudioEngine, setCapture: (capture: (constraints: MediaStreamConstraints) => Promise<Stream>) => void) => Promise<void>) {
  const originals = Object.fromEntries(["AudioContext", "MediaStream", "navigator", "AudioWorkletNode"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let capture = async (_constraints: MediaStreamConstraints) => new Stream();
  Object.defineProperties(globalThis, {
    AudioContext: { configurable: true, value: Context },
    MediaStream: { configurable: true, value: Stream },
    AudioWorkletNode: { configurable: true, value: Worklet },
    navigator: { configurable: true, value: { mediaDevices: { getUserMedia: (constraints: MediaStreamConstraints) => capture(constraints) } } },
  });
  const engine = new AudioEngine(parsePreset(example));
  try { await run(engine, (next) => { capture = next; }); }
  finally {
    await engine.dispose();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test("live capture requests exact device/unprocessed audio and routes only the selected channel", () => withEngine(async (engine, setCapture) => {
  const stream = new Stream();
  setCapture(async (constraints) => {
    assert.deepEqual(constraints, { video: false, audio: {
      deviceId: { exact: "interface-id" }, channelCount: { ideal: 2 },
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
    } });
    return stream;
  });
  const info = await engine.startLive("interface-id", 1);
  assert.ok(info);
  assert.equal(info.channel, 1);
  assert.deepEqual(info.settings, stream.tracks[0].settings);
  assert.equal(info.contextSampleRate, 48000);
  assert.equal(info.baseLatencySeconds, 0.01);
  assert.equal(info.outputLatencySeconds, 0.02);
  assert.equal(Context.current.media[0].connections.length, 1);
  const route = Context.current.splitters[0].connections;
  assert.equal(route.length, 1);
  assert.equal(route[0].output, 1);
  assert.equal(route[0].input, 0);
  engine.stop();
  assert.equal(stream.tracks[0].stops, 1);
  assert.ok(Context.current.media[0].disconnected);
  assert.ok(Context.current.splitters[0].disconnected);
}));

test("calibration requires live input, meters the dry channel, captures PCM and leaves monitoring active", () => withEngine(async (engine) => {
  await assert.rejects(engine.startCalibration(), /Start live input/);
  assert.equal(engine.getInputLevel(), null);
  await engine.startLive(undefined, 1);
  const level = engine.getInputLevel();
  assert.equal(level?.peak, 0.25);
  const pending = engine.startCalibration(2);
  await setImmediate();
  const capture = Worklet.current;
  const routes = Context.current.splitters[0].connections;
  assert.equal(routes.at(-1)?.node, capture);
  assert.equal(routes.at(-1)?.output, 1);
  capture.send({ samples: new Float32Array(96000).fill(0.125) });
  engine.finishCalibration();
  assert.deepEqual(capture.messages, ["finish"]);
  capture.send({ done: true });
  const take = await pending;
  assert.equal(take.usable, true);
  assert.equal(take.input.channel, 1);
  assert.equal(take.sampleRate, 48000);
  assert.equal(take.level.peak, 0.125);
  assert.ok(capture.closed && capture.disconnected);
  assert.equal(Context.current.media[0].disconnected, false);
}));

test("stop, cancel and disconnect discard active calibration; retry is possible", async () => {
  for (const action of ["stop", "cancel", "disconnect", "dispose"]) await withEngine(async (engine, setCapture) => {
    const stream = new Stream(); setCapture(async () => stream);
    await engine.startLive();
    const pending = engine.startCalibration();
    const rejection = assert.rejects(pending, { name: "AbortError" });
    await setImmediate();
    const capture = Worklet.current;
    if (action === "stop") engine.stop();
    if (action === "cancel") engine.cancelCalibration();
    if (action === "disconnect") stream.tracks[0].end();
    if (action === "dispose") await engine.dispose();
    await rejection;
    assert.ok(capture.closed && capture.disconnected);
    if (action === "cancel") {
      const retry = engine.startCalibration();
      const rejected = assert.rejects(retry, { name: "AbortError" });
      engine.cancelCalibration(); await rejected;
    } else assert.equal(engine.getInputLevel(), null);
  });
});

test("stop during module load cannot create a late recorder; duplicate capture is rejected", () => withEngine(async (engine) => {
  await engine.startLive();
  const loading = deferred<void>();
  Context.current.audioWorklet.addModule = () => loading.promise;
  const original = Worklet.current;
  const pending = engine.startCalibration();
  const rejection = assert.rejects(pending, { name: "AbortError" });
  await assert.rejects(engine.startCalibration(), /already running/);
  engine.stop(); loading.resolve(); await rejection; await setImmediate();
  assert.equal(Worklet.current, original);
}));

test("module/processor errors and unsupported durations are actionable and allow retry", () => withEngine(async (engine) => {
  await engine.startLive();
  for (const seconds of [1, 16, NaN]) await assert.rejects(engine.startCalibration(seconds), /duration/);
  Context.current.audioWorklet.addModule = async () => { throw new Error("Load failed"); };
  await assert.rejects(engine.startCalibration(), /Load failed/);
  Context.current.audioWorklet.addModule = async () => {};
  const pending = engine.startCalibration();
  const failure = assert.rejects(pending, /processor failed/);
  await setImmediate(); Worklet.current.onprocessorerror!(); await failure;
  assert.ok(Worklet.current.closed);
}));

test("stalled calibration times out and releases its processor", (t) => withEngine(async (engine) => {
  await engine.startLive();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = engine.startCalibration(2);
  const failure = assert.rejects(pending, /stalled/);
  await setImmediate();
  t.mock.timers.tick(7000);
  await failure;
  assert.ok(Worklet.current.closed && Worklet.current.disconnected);
  t.mock.timers.reset();
}));

test("finish before setup cancels and live-info mutation cannot change the selected capture channel", () => withEngine(async (engine) => {
  const info = await engine.startLive(undefined, 1);
  assert.ok(info); info.channel = 0; info.settings.sampleRate = 1;
  const pending = engine.startCalibration();
  const failure = assert.rejects(pending, { name: "AbortError" });
  engine.finishCalibration(); await failure;
  const next = engine.startCalibration(2); await setImmediate();
  Worklet.current.send({ samples: new Float32Array(96000).fill(0.1) });
  Worklet.current.send({ done: true });
  const take = await next;
  assert.equal(take.input.channel, 1);
  assert.equal(take.input.settings.sampleRate, 48000);
}));

test("stop/dispose while permission is pending releases late capture without connecting it", async () => {
  for (const dispose of [false, true]) await withEngine(async (engine, setCapture) => {
    const pending = deferred<Stream>();
    setCapture(() => pending.promise);
    const start = engine.startLive();
    await setImmediate();
    if (dispose) await engine.dispose(); else engine.stop();
    const stream = new Stream(); pending.resolve(stream);
    assert.equal(await start, false);
    assert.equal(stream.tracks[0].stops, 1);
    assert.equal(Context.current.media.length, 0);
  });
});

test("a late failed request cannot stop a newer successful capture", () => withEngine(async (engine, setCapture) => {
  const first = deferred<Stream>();
  setCapture(() => first.promise);
  const stale = engine.startLive();
  await setImmediate();
  const stream = new Stream();
  setCapture(async () => stream);
  assert.ok(await engine.startLive());
  first.reject(new DOMException("Denied", "NotAllowedError"));
  assert.equal(await stale, false);
  assert.equal(stream.tracks[0].stops, 0);
  assert.equal(Context.current.media[0].disconnected, false);
}));

test("latest start wins even when an older permission request resolves last", () => withEngine(async (engine, setCapture) => {
  const pending = deferred<Stream>();
  setCapture(() => pending.promise);
  const first = engine.startLive();
  await setImmediate();
  const current = new Stream();
  setCapture(async () => current);
  assert.ok(await engine.startLive());
  const stale = new Stream(); pending.resolve(stale);
  assert.equal(await first, false);
  assert.equal(stale.tracks[0].stops, 1);
  assert.equal(current.tracks[0].stops, 0);
  assert.equal(Context.current.media.length, 1);
}));

test("permission denial surfaces unchanged and permits retry", () => withEngine(async (engine, setCapture) => {
  const denied = new DOMException("Denied", "NotAllowedError");
  setCapture(async () => { throw denied; });
  await assert.rejects(engine.startLive(), (error) => error === denied);
  assert.equal(Context.current.media.length, 0);
  setCapture(async () => new Stream());
  assert.ok(await engine.startLive());
}));

test("invalid/unavailable channels reject and release acquired tracks", () => withEngine(async (engine, setCapture) => {
  for (const channel of [-1, 2, 0.5, NaN]) await assert.rejects(engine.startLive(undefined, channel), /channel/);
  for (const channelCount of [1, undefined]) {
    const stream = new Stream(); stream.tracks[0].settings = { channelCount };
    setCapture(async () => stream);
    await assert.rejects(engine.startLive(undefined, 1), /second input channel/);
    assert.equal(stream.tracks[0].stops, 1);
  }
  const mono = new Stream(); mono.tracks[0].settings.channelCount = 1;
  setCapture(async () => mono);
  assert.ok(await engine.startLive(undefined, 0));
}));

test("disconnect releases capture, notifies once, and allows restart", () => withEngine(async (engine, setCapture) => {
  const stream = new Stream();
  setCapture(async () => stream);
  let ended = 0; engine.onEnded = () => { ended++; };
  assert.ok(await engine.startLive());
  stream.tracks[0].end(); stream.tracks[0].end();
  assert.equal(ended, 1);
  assert.equal(stream.tracks[0].stops, 1);
  assert.ok(Context.current.media[0].disconnected);
  setCapture(async () => new Stream());
  assert.ok(await engine.startLive());
}));

test("repeated live replacement releases every previous track without duplicate routes", () => withEngine(async (engine, setCapture) => {
  let previous: Stream | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    const stream = new Stream([new Track(), new Track()]);
    setCapture(async () => stream);
    assert.ok(await engine.startLive());
    if (previous) assert.ok(previous.tracks.every((track) => track.stops === 1));
    assert.equal(Context.current.media.filter((node) => !node.disconnected).length, 1);
    previous = stream;
  }
  engine.stop(); engine.stop();
  assert.ok(previous!.tracks.every((track) => track.stops === 1));
}));

test("stop before initialization completes does not request capture", () => withEngine(async (engine, setCapture) => {
  let requested = false;
  setCapture(async () => { requested = true; return new Stream(); });
  const start = engine.startLive(); engine.stop();
  assert.equal(await start, false);
  assert.equal(requested, false);
}));

test("unavailable capture API produces an actionable error", () => withEngine(async (engine) => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  await assert.rejects(engine.startLive(), /HTTPS or localhost/);
}));

test("switching live/sample sources cleans the prior source; manual stop does not notify", () => withEngine(async (engine, setCapture) => {
  let ended = 0; engine.onEnded = () => { ended++; };
  assert.equal(await engine.playTestSignal(), true);
  const sample = Context.current.samples[0];
  const stream = new Stream(); setCapture(async () => stream);
  assert.ok(await engine.startLive());
  assert.ok(sample.stopped && sample.disconnected);
  assert.equal(await engine.playTestSignal(), true);
  assert.equal(stream.tracks[0].stops, 1);
  assert.ok(Context.current.media[0].disconnected);
  engine.stop(); stream.tracks[0].end();
  assert.equal(ended, 0);
}));

test("empty/ended streams and graph failures release capture; dispose prevents reopening", () => withEngine(async (engine, setCapture) => {
  setCapture(async () => new Stream([]));
  await assert.rejects(engine.startLive(), /No active audio/);
  const ended = new Stream(); ended.tracks[0].readyState = "ended";
  setCapture(async () => ended);
  await assert.rejects(engine.startLive(), /No active audio/);
  assert.equal(ended.tracks[0].stops, 1);
  const stream = new Stream(); setCapture(async () => stream);
  Context.current.createChannelSplitter = () => { throw new Error("Graph failure"); };
  await assert.rejects(engine.startLive(), /Graph failure/);
  assert.equal(stream.tracks[0].stops, 1);
  assert.ok(Context.current.media[0].disconnected);
  await engine.dispose();
  await assert.rejects(engine.startLive(), /closed/);
}));

test("silent live calibration captures dry input without routing it into the amp", () => withEngine(async (engine) => {
  assert.ok(await engine.startLive("interface-id", 1, false));
  const splitter = Context.current.splitters[0];
  assert.equal(splitter.connections.length, 0);
  assert.ok(engine.getInputLevel());
  const captured = engine.startCalibration(10);
  await setImmediate();
  assert.equal(splitter.connections.length, 2); // meter and silent worklet only
  Worklet.current.send({ samples: new Float32Array(48000 * 3).fill(0.1), done: true });
  const take = await captured;
  assert.equal(take.usable, true);
  assert.equal(take.input.channel, 1);
  engine.stop();
  assert.ok(await engine.startLive("interface-id", 1));
  assert.equal(Context.current.splitters[1].connections.length, 1);
}));
