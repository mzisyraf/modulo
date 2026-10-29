import { createRigPreset, createRigModule, parseRigPreset, snapshotRig, type RigPreset } from "./preset.ts";

/** Fresh independent objects on every call; no factory mutates the user's current rig. */
export function factoryRigPresets(): RigPreset[] {
  const modern = createRigPreset();
  const clean = createRigPreset("American Clean");
  clean.chain.find(item => item.type === "amp")!.model = "american_clean";
  clean.chain.find(item => item.type === "amp")!.parameters.gain = 0.1;
  clean.chain.find(item => item.type === "overdrive")!.on = false;
  clean.chain.find(item => item.type === "cabinet")!.model = "open_112";
  const ambient = structuredClone(clean); ambient.name = "Ambient Stereo";
  ambient.chain.splice(ambient.chain.length - 3, 0, createRigModule("chorus", "wide"));
  ambient.chain.find(item => item.type === "delay")!.on = true;
  ambient.chain.find(item => item.type === "delay")!.model = "ping_pong";
  ambient.chain.find(item => item.type === "reverb")!.on = true;
  ambient.chain.find(item => item.type === "reverb")!.model = "plate";
  const dual = createRigPreset("Dual Clean / Crunch");
  dual.chain = dual.chain.filter(item => !["amp", "cabinet"].includes(item.type));
  dual.parallel = { after: "overdrive", paths: [
    { id: "clean_path", level_db: -6, pan: -0.5, chain: [createRigModule("amp", "american_clean", "amp_a"), createRigModule("cabinet", "open_112", "cab_a")] },
    { id: "crunch_path", level_db: -6, pan: 0.5, chain: [createRigModule("amp", "british_crunch", "amp_b"), createRigModule("cabinet", "british_212", "cab_b")] },
  ] };
  const expanded = createRigPreset("Expanded Pedalboard");
  expanded.chain.splice(2, 0, createRigModule("pitch"), createRigModule("wah"), createRigModule("boost"));
  expanded.chain.splice(7, 0, createRigModule("distortion", "rodent"), createRigModule("fuzz"));
  expanded.chain.splice(expanded.chain.length - 3, 0, ...(["chorus", "flanger", "phaser", "tremolo"] as const).map(type => createRigModule(type)));
  for (const module of expanded.chain) if (["pitch", "wah", "boost", "distortion", "fuzz", "chorus", "flanger", "phaser", "tremolo"].includes(module.type)) module.on = false;
  modern.snapshots = [snapshotRig(modern, "rhythm", "Rhythm")];
  const lead = structuredClone(modern); lead.chain.find(item => item.type === "delay")!.on = true;
  lead.chain.find(item => item.type === "amp")!.parameters.gain = 0.55;
  modern.snapshots.push(snapshotRig(lead, "lead", "Lead"));
  // Mappings are explicit preset data. MIDI permission is still requested only by midi.connect().
  modern.midi = { bindings: [{ channel: 0, cc: 11, module: "amp", parameter: "gain", min: 0.1, max: 0.7, curve: "squared", toggle: false }], programs: [{ channel: 0, program: 0, snapshot: "rhythm" }, { channel: 0, program: 1, snapshot: "lead" }] };
  return [modern, clean, ambient, expanded, dual].map(parseRigPreset);
}
