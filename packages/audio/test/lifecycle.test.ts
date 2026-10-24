import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { AudioEngine } from "../src/index.ts";
import example from "../../../fixtures/preset.example.json" with { type: "json" };
import { parsePreset } from "../../../contracts/src/index.ts";

class FakeNode {
  gain = { value: 1, setTargetAtTime() {} };
  frequency = { value: 0 };
  Q = { value: 0 };
  started = false;
  stopped = false;
  disconnected = false;
  onended: (() => void) | null = null;
  connect(node: FakeNode) { return node; }
  disconnect() { this.disconnected = true; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
}

class FakeContext {
  static current: FakeContext;
  state = "running";
  sampleRate = 48000;
  currentTime = 0;
  destination = new FakeNode();
  sources: FakeNode[] = [];
  finishDecode?: (buffer: unknown) => void;
  constructor() { FakeContext.current = this; }
  createGain() { return new FakeNode(); }
  createWaveShaper() { return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); }
  createBuffer() { return { copyToChannel() {} }; }
  createBufferSource() { const source = new FakeNode(); this.sources.push(source); return source; }
  decodeAudioData() { return new Promise((resolve) => { this.finishDecode = resolve; }); }
  async close() { this.state = "closed"; }
}

test("stop during decoding prevents late playback; dispose prevents reopening", async () => {
  const original = globalThis.AudioContext;
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
  const engine = new AudioEngine(parsePreset(example));
  try {
    const pending = engine.playFile({ size: 1, arrayBuffer: async () => new ArrayBuffer(1) } as File);
    await setImmediate();
    engine.stop();
    FakeContext.current.finishDecode!({});
    assert.equal(await pending, false);
    assert.equal(FakeContext.current.sources.length, 0);
    await engine.dispose();
    await assert.rejects(engine.playTestSignal(), /closed/);
  } finally { globalThis.AudioContext = original; }
});

test("starting another audition stops and disconnects the previous source", async () => {
  const original = globalThis.AudioContext;
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
  const engine = new AudioEngine(parsePreset(example));
  try {
    assert.equal(await engine.playTestSignal(), true);
    const first = FakeContext.current.sources[0];
    assert.equal(await engine.playTestSignal(), true);
    assert.ok(first.stopped && first.disconnected);
    assert.equal(first.onended, null);
    assert.equal(FakeContext.current.sources.filter((source) => source.started && !source.stopped).length, 1);
    await engine.dispose();
  } finally { globalThis.AudioContext = original; }
});
