import assert from "node:assert/strict";
import { test } from "node:test";
import example from "../../../fixtures/preset.example.json" with { type: "json" };
import { parsePreset } from "../../../contracts/src/index.ts";
import { auditionPreset } from "../src/auditionPreset.ts";

test("original comparison removes input boost without mutating the rig or output level", () => {
  const rig = parsePreset({ ...example, parameters: { ...example.parameters, input_gain_db: 6 } });
  const original = auditionPreset(rig, true);
  assert.equal(original.parameters.input_gain_db, 0);
  assert.equal(original.parameters.master_gain_db, rig.parameters.master_gain_db);
  assert.equal(rig.parameters.input_gain_db, 6);
  assert.equal(auditionPreset(rig, false), rig);
  assert.doesNotThrow(() => parsePreset(original));
});
