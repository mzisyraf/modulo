import assert from "node:assert/strict";
import test from "node:test";
import { allRigModules, createRigPreset, editRig, parseRigPreset } from "@modulo/audio";
import { clearRemovableGear, isRemovableGear, selectionAfterRemoval } from "../src/modelRigActions.ts";

test("clearing a rig keeps only valid mandatory routing", () => {
  const original = createRigPreset();
  const cleared = clearRemovableGear(original);
  assert.deepEqual(cleared.chain.map(module => module.type), ["input", "output"]);
  assert.equal(cleared.parallel, null);
  assert.equal(allRigModules(cleared).length, 2);
  assert.doesNotThrow(() => parseRigPreset(cleared));
});

test("gear can be added to a cleared rig without restoring a preset", () => {
  const cleared = clearRemovableGear(createRigPreset());
  const rebuilt = editRig(cleared, { action: "add", id: "new_amp", type: "amp", model: "american_clean", target: "main" });
  assert.deepEqual(rebuilt.chain.map(module => module.type), ["input", "amp", "output"]);
});

test("selection moves to the next nearby module after removal", () => {
  const before = createRigPreset();
  const after = editRig(before, { action: "remove", id: "amp" });
  assert.equal(selectionAfterRemoval(before, after, "amp"), "cabinet");
});

test("input and output routing cannot be marked removable", () => {
  assert.equal(isRemovableGear("input"), false);
  assert.equal(isRemovableGear("output"), false);
  assert.equal(isRemovableGear("amp"), true);
});
