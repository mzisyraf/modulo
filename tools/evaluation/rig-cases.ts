import { createGearModule, modelValues } from "../../packages/audio/src/rig/models.ts";
import { parseRigProposal } from "../../packages/audio/src/rig/proposal.ts";
import { readFileSync, writeFileSync } from "node:fs";
const module = (id: string, patch: Record<string, number | boolean | string> = {}) => ({ model_id: id, enabled: true, parameters: { ...modelValues(createGearModule(id)), ...patch } });
const cases = [
  { id: "clean", modules: [module("eq.neutral", { bass_db: 4, mid_db: -6, treble_db: 5, low_cut_hz: 40, high_cut_hz: 10000 })] },
  { id: "crunch", modules: [module("amp.british_crunch", { gain: .43, bass_db: -4, mid_db: 3, treble_db: -2, presence_db: -1, master_db: -8 }), module("cabinet.open_112", { low_cut_hz: 85, high_cut_hz: 5200, position: .65, mic: "ribbon" })] },
  { id: "space", modules: [module("amp.studio_clean", { volume_db: -3, bass_db: -2, treble_db: 3 }), module("delay.digital", { time_ms: 280, feedback: .22, mix: .21, sync: false }), module("reverb.plate", { decay_s: 1.3, predelay_ms: 24, damping_hz: 5500, mix: .16 })] },
].map(row => ({ id: row.id, target: parseRigProposal({ proposal_version: "1", name: `Controlled ${row.id}`, description: "Known same-performance DSP target", tempo_bpm: 120, modules: row.modules }) }));
const path = process.argv[2]; if (!path) throw Error("Supply prepared config.json");
const config = JSON.parse(readFileSync(path, "utf8")); config.cases = cases;
writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
