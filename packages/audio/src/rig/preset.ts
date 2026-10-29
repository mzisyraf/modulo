import { moduleDefinition, RIG_MODULE_TYPES, type ModuleType, type Values, type Value } from "./catalog.ts";

export interface RigModule { id: string; type: ModuleType; model: string; on: boolean; parameters: Values }
export interface RigPath { id: string; level_db: number; pan: number; chain: RigModule[] }
export interface RigSnapshot { id: string; name: string; values: { id: string; on: boolean; parameters: Values }[] }
export interface MidiBinding { channel: number; cc: number; module: string; parameter: string; min: number; max: number; curve: "linear" | "squared"; toggle: boolean }
export interface RigPreset {
  rig_version: "1"; name: string; description: string; tempo_bpm: number;
  chain: RigModule[];
  parallel: { after: string; paths: RigPath[] } | null;
  snapshots: RigSnapshot[];
  midi: { bindings: MidiBinding[]; programs: { channel: number; program: number; snapshot: string }[] };
}

function object(value: unknown, keys: string[]): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a rig object.");
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error("Unknown rig field.");
  return value as Record<string, any>;
}
function text(value: unknown, length = 80): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > length) throw new Error("Invalid rig text.");
}
function number(value: unknown, min: number, max: number, integer = false): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error("Unsafe rig number.");
}
function array(value: unknown, max: number): asserts value is any[] {
  if (!Array.isArray(value) || value.length > max) throw new Error("Invalid rig list.");
}
export function validateControl(type: ModuleType, key: string, value: Value, realtime = false): void {
  const control = moduleDefinition(type).controls[key];
  if (!control || (realtime && !control.realtime)) throw new Error(`Unsupported ${type} control: ${key}`);
  if (type === "cabinet" && key === "ir_id") {
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) throw new Error("Invalid IR identifier.");
    return;
  }
  if (control.kind === "number") number(value, control.min!, control.max!);
  if (control.kind === "boolean" && typeof value !== "boolean") throw new Error("Invalid boolean control.");
  if (control.kind === "choice" && !control.choices!.includes(value as string)) throw new Error("Unknown rig choice.");
}
function parameters(type: ModuleType, value: unknown): void {
  const controls = moduleDefinition(type).controls;
  const values = object(value, Object.keys(controls));
  if (Object.keys(values).length !== Object.keys(controls).length) throw new Error("Missing rig controls.");
  for (const [key, item] of Object.entries(values)) validateControl(type, key, item);
  if (type === "cabinet" && values.low_cut_hz >= values.high_cut_hz) throw new Error("Cabinet cut frequencies overlap.");
  if (type === "eq" && values.low_cut_hz >= values.high_cut_hz) throw new Error("EQ cut frequencies overlap.");
}
export function allRigModules(preset: RigPreset): RigModule[] { return [...preset.chain, ...(preset.parallel?.paths.flatMap(path => path.chain) ?? [])]; }

/** Experimental engine rig format. The existing inference Preset v1 is unchanged. */
export function parseRigPreset(value: unknown): RigPreset {
  const rig = object(value, ["rig_version", "name", "description", "tempo_bpm", "chain", "parallel", "snapshots", "midi"]);
  if (rig.rig_version !== "1") throw new Error("Unsupported engine rig version.");
  text(rig.name); if (typeof rig.description !== "string" || rig.description.length > 2000) throw new Error("Invalid rig description.");
  number(rig.tempo_bpm, 30, 300);
  array(rig.chain, 24);
  const ids = new Set<string>();
  const validateModule = (value: unknown, path = false): RigModule => {
    const item = object(value, ["id", "type", "model", "on", "parameters"]);
    text(item.id, 64);
    if (!/^[a-zA-Z0-9_-]+$/.test(item.id) || ids.has(item.id)) throw new Error("Module IDs must be unique safe identifiers.");
    ids.add(item.id);
    if (!RIG_MODULE_TYPES.includes(item.type) || typeof item.on !== "boolean") throw new Error("Unknown module type or bypass.");
    const definition = moduleDefinition(item.type);
    if (!definition.models.some(model => model.id === item.model)) throw new Error("Unknown rig model.");
    if (path && ["input", "output"].includes(item.type)) throw new Error("Paths cannot redefine rig input/output.");
    parameters(item.type, item.parameters);
    if (item.type === "cabinet" && item.model === "custom" && item.parameters.ir_id === "none") throw new Error("Custom cabinet requires an imported IR identifier.");
    return item as RigModule;
  };
  rig.chain.forEach((item: unknown) => validateModule(item));
  if (rig.chain[0]?.type !== "input" || rig.chain.at(-1)?.type !== "output" || rig.chain.filter((item: RigModule) => ["input", "output"].includes(item.type)).length !== 2) throw new Error("Rig requires input first and output last.");
  if (!rig.chain[0].on || !rig.chain.at(-1).on) throw new Error("Use input/output mute rather than bypassing protection.");
  if (rig.parallel !== null) {
    const routing = object(rig.parallel, ["after", "paths"]);
    if (!rig.chain.slice(0, -1).some((item: RigModule) => item.id === routing.after)) throw new Error("Invalid parallel split point.");
    array(routing.paths, 2);
    if (routing.paths.length !== 2) throw new Error("Parallel routing requires exactly two paths.");
    const pathIds = new Set<string>();
    for (const pathValue of routing.paths) {
      const path = object(pathValue, ["id", "level_db", "pan", "chain"]);
      text(path.id, 64); if (pathIds.has(path.id)) throw new Error("Duplicate path ID."); pathIds.add(path.id);
      number(path.level_db, -36, 0); number(path.pan, -1, 1); array(path.chain, 12);
      path.chain.forEach((item: unknown) => validateModule(item, true));
    }
  }
  if (ids.size > 32) throw new Error("A rig supports at most 32 modules.");
  const modules = allRigModules(rig as RigPreset);
  if (modules.filter(item => item.type === "reverb").length > 2 || modules.filter(item => item.type === "cabinet").length > 4) throw new Error("Convolution budget exceeded.");
  array(rig.snapshots, 16);
  const snapshotIds = new Set<string>();
  for (const entry of rig.snapshots) {
    const snapshot = object(entry, ["id", "name", "values"]); text(snapshot.id, 64); text(snapshot.name);
    if (snapshotIds.has(snapshot.id)) throw new Error("Duplicate snapshot."); snapshotIds.add(snapshot.id);
    array(snapshot.values, 32); const seen = new Set<string>();
    for (const patch of snapshot.values) {
      object(patch, ["id", "on", "parameters"]);
      const target = modules.find(item => item.id === patch.id);
      if (!target || seen.has(patch.id) || typeof patch.on !== "boolean") throw new Error("Invalid snapshot module.");
      if (["input", "output"].includes(target.type) && !patch.on) throw new Error("Snapshot cannot bypass input/output.");
      seen.add(patch.id); parameters(target.type, patch.parameters);
    }
  }
  const midi = object(rig.midi, ["bindings", "programs"]); array(midi.bindings, 64); array(midi.programs, 128);
  for (const item of midi.bindings) {
    object(item, ["channel", "cc", "module", "parameter", "min", "max", "curve", "toggle"]);
    number(item.channel, 0, 15, true); number(item.cc, 0, 127, true);
    const target = modules.find(module => module.id === item.module);
    if (!target || !["linear", "squared"].includes(item.curve) || typeof item.toggle !== "boolean") throw new Error("Invalid MIDI binding.");
    const control = moduleDefinition(target.type).controls[item.parameter];
    if (!control?.realtime || control.kind !== "number" || item.toggle) throw new Error("MIDI targets must be realtime numeric controls; use snapshots for bypass changes.");
    validateControl(target.type, item.parameter, item.min, true); validateControl(target.type, item.parameter, item.max, true);
  }
  for (const item of midi.programs) {
    object(item, ["channel", "program", "snapshot"]); number(item.channel, 0, 15, true); number(item.program, 0, 127, true);
    if (!snapshotIds.has(item.snapshot)) throw new Error("MIDI program references a missing snapshot.");
  }
  return structuredClone(rig as RigPreset);
}

export function createRigModule(type: ModuleType, modelId = moduleDefinition(type).models[0].id, id: string = type): RigModule {
  const definition = moduleDefinition(type);
  return { id, type, model: modelId, on: true, parameters: { ...Object.fromEntries(Object.entries(definition.controls).map(([key, control]) => [key, control.defaultValue])), ...definition.models.find(model => model.id === modelId)?.defaults } };
}
export function createRigPreset(name = "Modern High Gain"): RigPreset {
  const types: ModuleType[] = ["input", "gate", "compressor", "overdrive", "amp", "cabinet", "eq", "delay", "reverb", "output"];
  const chain = types.map(type => createRigModule(type));
  chain.find(item => item.type === "amp")!.model = "modern_high_gain";
  chain.find(item => item.type === "cabinet")!.model = "closed_412";
  for (const item of chain) if (["compressor", "delay", "reverb"].includes(item.type)) item.on = false;
  return parseRigPreset({ rig_version: "1", name, description: "Algorithmic rig; branded inspirations and synthetic IRs are not verified hardware captures.", tempo_bpm: 120, chain, parallel: null, snapshots: [], midi: { bindings: [], programs: [] } });
}
export function exportRigPreset(value: RigPreset): string { return JSON.stringify(parseRigPreset(value), null, 2); }
export function importRigPreset(json: string): RigPreset {
  if (typeof json !== "string" || new TextEncoder().encode(json).length > 256 * 1024) throw new Error("Rig JSON must be at most 256 KiB.");
  return parseRigPreset(JSON.parse(json));
}
export function snapshotRig(preset: RigPreset, id: string, name: string): RigSnapshot {
  return { id, name, values: allRigModules(preset).map(module => ({ id: module.id, on: module.on, parameters: structuredClone(module.parameters) })) };
}
export function applyRigSnapshot(preset: RigPreset, id: string): RigPreset {
  const next = parseRigPreset(preset); const snapshot = next.snapshots.find(item => item.id === id);
  if (!snapshot) throw new Error("Unknown rig snapshot.");
  for (const patch of snapshot.values) Object.assign(allRigModules(next).find(item => item.id === patch.id)!, { on: patch.on, parameters: patch.parameters });
  return parseRigPreset(next);
}
