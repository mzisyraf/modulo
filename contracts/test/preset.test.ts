import assert from "node:assert/strict";
import { test } from "node:test";
import example from "../../fixtures/preset.example.json" with { type: "json" };
import cases from "../../fixtures/preset.parameter-cases.json" with { type: "json" };
import { parsePreset } from "../src/index.ts";

for (const item of cases) {
  test(`shared parameter case: ${item.name}`, () => {
    const preset = { ...example, parameters: { ...example.parameters, ...item.parameters } };
    if (item.valid) assert.doesNotThrow(() => parsePreset(preset));
    else assert.throws(() => parsePreset(preset));
  });
}

test("the shared example is valid and parsing does not share mutable data", () => {
  const parsed = parsePreset(example);
  parsed.parameters.drive = 1;
  assert.equal(example.parameters.drive, 0.25);
});

for (const value of [-0.01, 1.01, NaN, Infinity, "0.5", null]) {
  test(`reject unsafe drive: ${String(value)}`, () => {
    assert.throws(() => parsePreset({ ...example, parameters: { ...example.parameters, drive: value } }));
  });
}

test("reject unknown controls, missing controls and unsupported versions", () => {
  assert.throws(() => parsePreset({ ...example, schema_version: "2" }));
  assert.throws(() => parsePreset({ ...example, parameters: { ...example.parameters, delay_ms: 500 } }));
  const missing = structuredClone(example);
  Reflect.deleteProperty(missing.parameters, "master_gain_db");
  assert.throws(() => parsePreset(missing));
});

test("generated provenance needs a real provider and model identifier", () => {
  assert.throws(() => parsePreset({ ...example, provenance: { kind: "generated", provider: null, model: null } }));
});
