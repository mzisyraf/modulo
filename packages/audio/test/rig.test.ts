import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { getRigCatalog, moduleDefinition, RIG_MODULE_TYPES } from "../src/rig/catalog.ts";
import { createRigPreset, createRigModule, parseRigPreset, importRigPreset, exportRigPreset, snapshotRig, applyRigSnapshot } from "../src/rig/preset.ts";
import { factoryRigPresets } from "../src/rig/factory.ts";
import { RigMidiController, estimatePitch } from "../src/rig/control.ts";

test("catalog exposes bounded serializable controls, three pedal characters and independent factory presets", () => {
  const catalog = getRigCatalog();
  assert.equal(RIG_MODULE_TYPES.length, 19);
  for (const type of RIG_MODULE_TYPES) {
    assert.ok(catalog[type].models.length >= (["input", "output"].includes(type) ? 1 : 3));
    for (const model of catalog[type].models) if (!(type === "cabinet" && model.id === "custom")) {
      const preset = createRigPreset(); const module = createRigModule(type, model.id, "tested");
      if (type === "input") preset.chain[0] = module;
      else if (type === "output") preset.chain[preset.chain.length - 1] = module;
      else preset.chain.splice(1, 0, module);
      assert.deepEqual(importRigPreset(exportRigPreset(preset)), preset);
    }
  }
  assert.equal(catalog.distortion.models.filter(item => item.reference && item.source).length, 3);
  catalog.amp.controls.gain.max = 999; assert.equal(moduleDefinition("amp").controls.gain.max, 1);
  const factories = factoryRigPresets(); assert.equal(factories.length, 5);
  factories[0].chain[0].parameters.trim_db = -20; assert.equal(factoryRigPresets()[0].chain[0].parameters.trim_db, 0);
});

test("rig parser rejects unsafe structure, parameters, routing, snapshots and MIDI", () => {
  const bad = (change: (rig: any) => void) => { const rig = createRigPreset(); change(rig); assert.throws(() => parseRigPreset(rig)); };
  bad(rig => rig.extra = true); bad(rig => rig.chain[0].parameters.trim_db = Infinity);
  bad(rig => rig.chain[0].parameters.trim_db = "1"); bad(rig => delete rig.chain[0].parameters.mute);
  bad(rig => rig.chain[1].id = rig.chain[0].id); bad(rig => rig.chain[1].model = "unimplemented");
  bad(rig => rig.chain.pop()); bad(rig => rig.chain.at(-1).on = false);
  bad(rig => rig.parallel = { after: "missing", paths: [] });
  bad(rig => rig.chain.push(...Array.from({ length: 25 }, (_, i) => createRigModule("delay", "digital", `delay${i}`))));
  bad(rig => rig.snapshots = [{ id: "invalid", name: "invalid", values: [{ id: "output", on: false, parameters: rig.chain.at(-1).parameters }] }]);
  bad(rig => rig.midi.bindings = [{ channel: 0, cc: 11, module: "reverb", parameter: "decay_s", min: 1, max: 2, curve: "linear", toggle: false }]);
  bad(rig => rig.midi.programs = [{ channel: 0, program: 0, snapshot: "missing" }]);
  assert.throws(() => importRigPreset(" ".repeat(256 * 1024 + 1)));
});

test("snapshots restore controls and bypass without mutating their source preset", () => {
  const rig = createRigPreset(); rig.snapshots.push(snapshotRig(rig, "initial", "Initial"));
  rig.chain[1].on = false; rig.chain[1].parameters.threshold_db = -30;
  const restored = applyRigSnapshot(rig, "initial");
  assert.equal(restored.chain[1].on, true); assert.equal(restored.chain[1].parameters.threshold_db, -55);
  assert.equal(rig.chain[1].on, false); assert.throws(() => applyRigSnapshot(rig, "missing"));
});

test("MIDI handles channel-specific CC, learning, expression curves and program snapshots", async () => {
  let rig = factoryRigPresets()[0]; const values: any[] = [], snapshots: string[] = [];
  const midi = new RigMidiController({ get: () => rig, parameter: (...value) => values.push(value), snapshot: async id => { snapshots.push(id); }, binding: item => { rig = parseRigPreset({ ...rig, midi: { ...rig.midi, bindings: [...rig.midi.bindings, item] } }); } });
  await midi.handle([0xb1, 11, 127]); assert.equal(values.length, 0);
  await midi.handle([0xb0, 11, 127]); assert.deepEqual(values.pop(), ["amp", "gain", 0.7]);
  await midi.handle([0xc0, 1]); assert.deepEqual(snapshots, ["lead"]);
  midi.learn("amp", "master_db", -24, 0, "linear"); await midi.handle([0xb2, 7, 0]); assert.deepEqual(values.pop(), ["amp", "master_db", -24]);
  await midi.handle([0xb2, 7, 128]); assert.equal(values.length, 0);
  assert.throws(() => midi.learn("reverb", "decay_s", 1, 2));
});

test("tuner identifies single guitar notes with DC offset and rejects silence/nonfinite samples", () => {
  for (const frequency of [82.4069, 110, 146.832, 196, 246.942, 329.628, 440]) {
    const samples = Float32Array.from({ length: 4096 }, (_, index) => 0.2 * Math.sin(2 * Math.PI * frequency * index / 48000) + 0.07);
    const reading = estimatePitch(samples, 48000); assert.ok(reading); assert.ok(Math.abs(1200 * Math.log2(reading.frequencyHz / frequency)) < 1);
  }
  assert.equal(estimatePitch(new Float32Array(4096), 48000), null);
  assert.equal(estimatePitch(new Float32Array(4096).fill(NaN), 48000), null);
});

function processor(type: "gate" | "pitch", parameters = {}) {
  let Processor: any; const sandbox = { sampleRate: 48000, Float32Array, Math, Number, AudioWorkletProcessor: class { port = { postMessage() {}, onmessage: null }; }, registerProcessor: (_: string, value: any) => { Processor = value; } };
  vm.runInNewContext(readFileSync(new URL("../src/rig/processor.js", import.meta.url), "utf8"), sandbox);
  const module = createRigModule(type), model = moduleDefinition(type).models[0];
  const node = new Processor({ processorOptions: { ...module.parameters, ...model.coefficients, ...parameters, mode: type } });
  return { node, process: (input: Float32Array) => {
    const output = new Float32Array(input.length);
    for (let i = 0; i < input.length; i += 128) { const block = [new Float32Array(128), new Float32Array(128)]; node.process([[input.subarray(i, i + 128)]], [block]); output.set(block[0].subarray(0, Math.min(128, input.length - i)), i); }
    return output;
  } };
}
test("gate opens on a note and smoothly attenuates subthreshold noise after release", () => {
  const { process } = processor("gate", { threshold_db: -35, release_ms: 50, hold_ms: 10 });
  const input = Float32Array.from({ length: 48000 }, (_, i) => (i < 12000 ? 0.2 : 0.001) * Math.sin(i * 0.1));
  const result = process(input);
  assert.ok(Math.abs(result[6000]) > 0.005); assert.ok(Math.abs(result[47999]) < Math.abs(input[47999]) * 0.01);
  assert.ok(Array.from(result).every(Number.isFinite));
});
test("granular pitch shifts an A note by one octave and zero shift preserves samples", () => {
  const signal = Float32Array.from({ length: 48000 }, (_, i) => Math.sin(2 * Math.PI * 220 * i / 48000) * 0.2);
  assert.deepEqual(processor("pitch").process(signal), signal);
  for (const semitones of [-12, 12]) {
    const result = processor("pitch", { semitones }).process(signal);
    const frequency = 220 * 2 ** (semitones / 12);
    // Correlation at expected frequency dominates the unshifted input after grain warmup.
    const magnitude = (hz: number) => { let re = 0, im = 0; for (let i = 10000; i < result.length; i++) { re += result[i] * Math.cos(2 * Math.PI * hz * i / 48000); im += result[i] * Math.sin(2 * Math.PI * hz * i / 48000); } return Math.hypot(re, im); };
    assert.ok(magnitude(frequency) > magnitude(220) * 3);
  }
});
