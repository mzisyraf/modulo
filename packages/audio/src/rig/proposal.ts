import { getGearModels, getGearModel, createGearModule, parseModelState } from "./models.ts";
import { parseRigPreset, type RigPreset } from "./preset.ts";
import type { Values } from "./catalog.ts";

export interface RigProposal {
  proposal_version: "1"; name: string; description: string; tempo_bpm: number;
  modules: { model_id: string; enabled: boolean; parameters: Values }[];
}
export const inferenceModels = () => getGearModels().filter(model => !["input", "output"].includes(model.type) && !model.parameters.some(parameter => parameter.type === "asset"));

/** Generated provider/backend schema; the installed model registry owns all controls. */
export function rigProposalSchema() {
  return { type: "object", additionalProperties: false, required: ["proposal_version", "name", "description", "tempo_bpm", "modules"], properties: {
    proposal_version: { type: "string", enum: ["1"] }, name: { type: "string", minLength: 1, maxLength: 80 },
    description: { type: "string", maxLength: 1200 }, tempo_bpm: { type: "number", minimum: 30, maximum: 300 },
    modules: { type: "array", minItems: 1, maxItems: 8, items: { anyOf: inferenceModels().map(model => ({
      type: "object", additionalProperties: false, required: ["model_id", "enabled", "parameters"], properties: {
        model_id: { type: "string", enum: [model.id] }, enabled: { type: "boolean" }, parameters: {
          type: "object", additionalProperties: false, required: model.parameters.map(parameter => parameter.id),
          properties: Object.fromEntries(model.parameters.map(parameter => [parameter.id, parameter.type === "number"
            ? { type: "number", minimum: parameter.min, maximum: parameter.max }
            : parameter.type === "boolean" ? { type: "boolean" } : { type: "string", enum: parameter.choices.map(choice => choice.value) }])) },
      },
    })) } },
  } };
}
function fields(value: unknown, keys: string[]): asserts value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw Error("Unexpected or missing rig proposal fields.");
}
export function parseRigProposal(value: unknown): RigProposal {
  fields(value, ["proposal_version", "name", "description", "tempo_bpm", "modules"]);
  if (value.proposal_version !== "1" || typeof value.name !== "string" || !value.name.trim() || value.name.length > 80 || typeof value.description !== "string" || value.description.length > 1200
    || typeof value.tempo_bpm !== "number" || !Number.isFinite(value.tempo_bpm) || value.tempo_bpm < 30 || value.tempo_bpm > 300
    || !Array.isArray(value.modules) || value.modules.length < 1 || value.modules.length > 8) throw Error("Invalid rig proposal.");
  const allowed = new Set(inferenceModels().map(model => model.id));
  for (const module of value.modules) {
    fields(module, ["model_id", "enabled", "parameters"]);
    if (!allowed.has(module.model_id) || typeof module.enabled !== "boolean") throw Error("Unsupported proposed gear.");
    parseModelState(module.model_id, module.parameters);
  }
  const proposal = structuredClone(value) as RigProposal;
  compile(proposal, 0, -18); // Also enforce graph limits and coupled cut-frequency bounds.
  return proposal;
}
function compile(proposal: RigProposal, inputGainDb: number, outputLevelDb: number): RigPreset {
  if (!Number.isFinite(inputGainDb) || inputGainDb < -24 || inputGainDb > 12) throw Error("Invalid calibrated input gain.");
  if (!Number.isFinite(outputLevelDb) || outputLevelDb < -36 || outputLevelDb > -6) throw Error("Invalid protected output level.");
  const output = createGearModule("output.protected", "ai_output"); output.parameters.level_db = outputLevelDb;
  return parseRigPreset({ rig_version: "1", name: proposal.name, description: proposal.description, tempo_bpm: proposal.tempo_bpm,
    chain: [createGearModule("input.interface", "ai_input", { trim_db: inputGainDb, mute: false, invert: false }),
      ...proposal.modules.map((module, index) => ({ ...createGearModule(module.model_id, `ai_${index}`, module.parameters), on: module.enabled })),
      output], parallel: null, snapshots: [], midi: { bindings: [], programs: [] } });
}
export function compileRigProposal(value: unknown, inputGainDb: number, outputLevelDb = -18): RigPreset { return compile(parseRigProposal(value), inputGainDb, outputLevelDb); }
