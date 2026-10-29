import test from "node:test";
import assert from "node:assert/strict";
import { createGearModule, getGearModel, modelValues } from "../src/rig/models.ts";
import { compileRigProposal, parseRigProposal, rigProposalSchema } from "../src/rig/proposal.ts";
const proposal = () => ({ proposal_version: "1", name: "Custom delay", description: "Explicit individual controls", tempo_bpm: 120,
  modules: [{ model_id: "delay.single_tap", enabled: true, parameters: { time_ms: 237, mix: 0.173 } }] });
test("proposal compiles individual physical values through the real adapter", () => {
  const rig = compileRigProposal(proposal(), 2.3);
  assert.equal(rig.chain[0].parameters.trim_db, 2.3);
  assert.deepEqual(modelValues(rig.chain[1]), { time_ms: 237, mix: 0.173 });
  assert.equal(rig.chain.at(-1)!.parameters.level_db, -18);
  assert.equal(rig.parallel, null);
});
test("proposal rejects missing/unknown/nonfinite/unsupported controls and assets", () => {
  for (const patch of [ { time_ms: 237 }, { time_ms: 237, mix: .2, invented: 1 }, { time_ms: Infinity, mix: .2 }, { time_ms: 237, mix: true } ]) {
    const value = proposal(); Object.assign(value.modules[0], { parameters: patch }); assert.throws(() => parseRigProposal(value));
  }
  for (const model_id of ["cabinet.custom", "input.interface", "output.protected", "invented.amp"]) {
    const value = proposal(); value.modules[0].model_id = model_id; assert.throws(() => parseRigProposal(value));
  }
  const extra = { ...proposal(), factory_preset: "clean" }; assert.throws(() => parseRigProposal(extra));
  assert.throws(() => compileRigProposal(proposal(), 13));
  assert.throws(() => compileRigProposal(proposal(), 0, 0));
  assert.equal(compileRigProposal(proposal(), 0, -15).chain.at(-1)!.parameters.level_db, -15);
  assert.throws(() => parseRigProposal({ ...proposal(), modules: Array(9).fill(proposal().modules[0]) }));
});
test("coupled filters and convolution limits are checked at compilation boundary", () => {
  const model_id = "eq.neutral", parameters = modelValues(createGearModule(model_id));
  parameters.low_cut_hz = 500; parameters.high_cut_hz = 1000;
  const p = { ...proposal(), modules: [{ model_id, enabled: true, parameters }] }; parseRigProposal(p);
  const verb = { model_id: "reverb.room", enabled: true, parameters: modelValues(createGearModule("reverb.room")) };
  assert.throws(() => parseRigProposal({ ...proposal(), modules: [verb, verb, verb] }));
  assert.equal((rigProposalSchema().properties.modules.items.anyOf.find(item => item.properties.model_id.enum[0] === "delay.single_tap")!.properties.parameters.required).length, getGearModel("delay.single_tap").parameters.length);
});
