import test from "node:test";
import assert from "node:assert/strict";
import { getGearModels, getGearModel, GEAR_CATEGORIES, modelFor, modelValues, parameterToDSP, parseModelState, createGearModule, changeGearModel, resetGearModel, legacyModelOverrides, normalizeModelValue, denormalizeModelValue } from "../src/rig/models.ts";
import { createRigPreset, createRigModule, parseRigPreset, exportRigPreset, importRigPreset, snapshotRig } from "../src/rig/preset.ts";
import { RIG_MODULE_TYPES, moduleDefinition } from "../src/rig/catalog.ts";

test("every catalog model owns explicit descriptors and all requested categories are populated", () => {
  const models = getGearModels();
  assert.equal(models.length, RIG_MODULE_TYPES.reduce((count, type) => count + moduleDefinition(type).models.length, 0));
  for (const category of Object.keys(GEAR_CATEGORIES)) assert.ok(models.some(model => model.category === category));
  for (const model of models) {
    assert.equal(model.version, 1); assert.ok(model.dsp.factory && model.parameters.length);
    assert.equal(new Set(model.parameters.map(parameter => parameter.id)).size, model.parameters.length);
    for (const parameter of model.parameters) {
      assert.ok(parameter.label && parameter.widget && parameter.scaling.type); assert.equal(typeof parameter.unit, "string");
      parameterToDSP(model, parameter.id, parameter.defaultValue);
      if (parameter.type === "number") { parameterToDSP(model, parameter.id, parameter.min!); parameterToDSP(model, parameter.id, parameter.max!); }
    }
  }
  models[0].parameters.length = 0; assert.ok(getGearModels()[0].parameters.length);
});
test("models in the same family have different controls and processor factories", () => {
  const ids = (model: string) => getGearModel(model).parameters.map(parameter => parameter.id);
  assert.deepEqual(ids("distortion.gold"), ["distortion", "level_db"]);
  assert.deepEqual(ids("distortion.rodent"), ["distortion", "filter", "level_db"]);
  assert.ok(!ids("amp.studio_clean").includes("gain")); assert.ok(ids("amp.modern_high_gain").includes("resonance_db"));
  assert.deepEqual(ids("delay.single_tap"), ["time_ms", "mix"]); assert.ok(ids("delay.digital").includes("feedback"));
  assert.notEqual(getGearModel("amp.studio_clean").dsp.factory, getGearModel("amp.modern_high_gain").dsp.factory);
  assert.notEqual(getGearModel("delay.single_tap").dsp.factory, getGearModel("delay.digital").dsp.factory);
});
test("own IDs map to working wire parameters, including inverted Filter and compressor Sustain", () => {
  assert.deepEqual(parameterToDSP(getGearModel("distortion.rodent"), "filter", 0.8), { target: "tone", value: 1 - 0.8, realtime: true });
  assert.equal(parameterToDSP(getGearModel("compressor.sustain"), "sustain", 0.5).value, -30);
  assert.equal(modelValues(createGearModule("delay.single_tap")).time_ms, 120);
  assert.equal(modelValues(createGearModule("eq.tilt")).pivot_hz, 800);
  assert.throws(() => parameterToDSP(getGearModel("amp.studio_clean"), "gain", 0.5), /Unsupported/);
  assert.throws(() => parameterToDSP(getGearModel("distortion.gold"), "tone", 0.5), /Unsupported/);
});
test("model state rejects extra/missing keys and wrong types without mutating the caller", () => {
  const model = getGearModel("distortion.gold"), state = { distortion: 0.5, level_db: 0 };
  assert.deepEqual(parseModelState(model.id, state), state);
  assert.throws(() => parseModelState(model.id, { ...state, tone: 0.5 }));
  assert.throws(() => parseModelState(model.id, { distortion: 0.5 }));
  for (const invalid of [NaN, Infinity, "0.5", true, -1, 2]) assert.throws(() => parseModelState(model.id, { ...state, distortion: invalid }));
  assert.deepEqual(state, { distortion: 0.5, level_db: 0 });
});
test("linear/log/power controls round-trip physical units with exact supported endpoints", () => {
  for (const model of getGearModels()) for (const parameter of model.parameters) if (parameter.type === "number") {
    for (const position of [0, 0.1, 0.5, 0.9, 1]) {
      const value = denormalizeModelValue(parameter, position); assert.ok(Number.isFinite(value));
      assert.ok(Math.abs(normalizeModelValue(parameter, value) - position) < 1e-8);
    }
    assert.throws(() => denormalizeModelValue(parameter, NaN));
  }
  const parameter = getGearModel("amp.modern_high_gain").parameters.find(item => item.id === "gain")!;
  assert.equal(denormalizeModelValue(parameter, 0.5), 0.25);
});
test("model selection resets its own values and removes stale snapshot/CC mappings", () => {
  const rig = createRigPreset(); rig.chain.find(item => item.id === "amp")!.parameters.gain = 0.9;
  rig.snapshots = [snapshotRig(rig, "saved", "Saved")]; rig.midi.bindings = [{ channel: 0, cc: 11, module: "amp", parameter: "gain", min: 0, max: 1, curve: "linear", toggle: false }];
  const changed = changeGearModel(rig, "amp", "amp.studio_clean");
  assert.equal(modelFor(changed.chain.find(item => item.id === "amp")!).id, "amp.studio_clean");
  assert.ok(changed.snapshots[0].values.every(item => item.id !== "amp")); assert.equal(changed.midi.bindings.length, 0);
  assert.equal(rig.chain.find(item => item.id === "amp")!.parameters.gain, 0.9);
  assert.throws(() => changeGearModel(rig, "amp", "delay.single_tap"));
});
test("legacy rigs retain every stored DSP value until an explicit model reset", () => {
  const rig = createRigPreset(); rig.chain.find(item => item.type === "distortion");
  const module = createRigModule("distortion", "gold", "dist"); module.parameters.tone = 0.8; module.parameters.mix = 0.4; rig.chain.splice(1, 0, module);
  const before = exportRigPreset(rig); modelValues(module); assert.deepEqual(legacyModelOverrides(module).sort(), ["mix", "tone"]);
  assert.equal(exportRigPreset(importRigPreset(before)), before);
  const reset = resetGearModel(rig, "dist"); assert.equal(legacyModelOverrides(reset.chain.find(item => item.id === "dist")!).length, 0);
  assert.equal(module.parameters.tone, 0.8); parseRigPreset(reset);
});
