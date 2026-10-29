import test from "node:test";
import assert from "node:assert/strict";
import { createRigPreset, factoryRigPresets, snapshotRig } from "../src/index.ts";
import { editRig, recommendedModels } from "../demo/rigEditor.ts";

test("adding and moving gear respects order and fixed input/output without mutating the source", () => {
  const original = createRigPreset();
  const added = editRig(original, { action: "add", id: "new_distortion", type: "distortion", model: "rodent", target: "main", before: "amp" });
  assert.equal(added.chain[added.chain.findIndex(item => item.id === "amp") - 1].id, "new_distortion");
  assert.ok(!original.chain.some(item => item.id === "new_distortion"));
  const moved = editRig(added, { action: "move", id: "new_distortion", target: "main", before: "input" });
  assert.equal(moved.chain[0].id, "input"); assert.equal(moved.chain[1].id, "new_distortion");
  assert.equal(editRig(moved, { action: "move", id: "new_distortion", target: "main" }).chain.at(-2)!.id, "new_distortion");
  for (const id of ["input", "output"]) {
    assert.throws(() => editRig(original, { action: "remove", id }));
    assert.throws(() => editRig(original, { action: "move", id, target: "main" }));
  }
});
test("removing gear cleans snapshot/CC references and retains valid snapshot programs", () => {
  const rig = factoryRigPresets()[0]; rig.snapshots.push(snapshotRig(rig, "saved", "Saved"));
  const next = editRig(rig, { action: "remove", id: "amp" });
  assert.ok(next.snapshots.every(snapshot => snapshot.values.every(item => item.id !== "amp")));
  assert.equal(next.midi.bindings.length, 0); assert.equal(next.midi.programs.length, 2);
  assert.ok(rig.midi.bindings.length > 0);
});
test("parallel edits preserve two paths and reroute a removed split point to its predecessor", () => {
  const rig = factoryRigPresets().find(item => item.parallel)!;
  const moved = editRig(rig, { action: "move", id: "amp_a", target: "path:crunch_path", before: "amp_b" });
  assert.equal(moved.parallel!.paths[1].chain[0].id, "amp_a");
  assert.throws(() => editRig(rig, { action: "move", id: rig.parallel!.after, target: "path:clean_path" }));
  const previous = rig.chain[rig.chain.findIndex(item => item.id === rig.parallel!.after) - 1].id;
  assert.equal(editRig(rig, { action: "remove", id: rig.parallel!.after }).parallel!.after, previous);
});
test("bad destinations and unknown models fail atomically", () => {
  const rig = createRigPreset(), before = JSON.stringify(rig);
  assert.throws(() => editRig(rig, { action: "move", id: "amp", target: "missing" }));
  assert.throws(() => editRig(rig, { action: "add", id: "extra", type: "amp", model: "invented", target: "main" }));
  assert.equal(JSON.stringify(rig), before);
});
test("recommendations follow factory amp/cab choices without restricting the catalog", () => {
  const rigs = factoryRigPresets();
  assert.deepEqual(recommendedModels(rigs[0], "amp"), ["modern_high_gain"]);
  assert.deepEqual(recommendedModels(rigs[1], "amp"), ["american_clean"]);
  assert.deepEqual(recommendedModels(rigs.find(item => item.parallel)!, "amp"), ["american_clean", "british_crunch"]);
  assert.deepEqual(recommendedModels(null, "amp"), []);
});
