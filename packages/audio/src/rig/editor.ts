import { allRigModules, parseRigPreset, type RigPreset } from "./preset.ts";
import type { ModuleType } from "./catalog.ts";
import { createGearModule } from "./models.ts";

export type RigEdit =
  | { action: "add"; type: ModuleType; model: string; id: string; target: string; before?: string; irId?: string }
  | { action: "move"; id: string; target: string; before?: string }
  | { action: "remove"; id: string };

export function recommendedModels(rig: RigPreset | null, type: ModuleType): string[] {
  return rig ? [...new Set(allRigModules(rig).filter(module => module.type === type).map(module => module.model))] : [];
}

/** Pure validated edit: never mutate the audible/current preset on an invalid drop. */
export function editRig(value: RigPreset, edit: RigEdit): RigPreset {
  const next = parseRigPreset(value), chains = new Map([["main", next.chain], ...(next.parallel?.paths.map(path => [`path:${path.id}`, path.chain] as const) ?? [])]);
  const source = [...chains.values()].find(chain => chain.some(module => module.id === edit.id));
  let module = source?.find(module => module.id === edit.id);
  if (edit.action === "add") {
    if (["input", "output"].includes(edit.type)) throw new Error("Input and Output stay fixed. Add pedals, amps or cabinets between them.");
    if (module) throw new Error("Gear ID already exists.");
    module = createGearModule(`${edit.type}.${edit.model}`, edit.id);
    if (module.type === "cabinet" && module.model === "custom") module.parameters.ir_id = edit.irId ?? "none";
  } else {
    if (!module || !source) throw new Error("This gear is no longer in the rig.");
    if (["input", "output"].includes(module.type)) throw new Error("Input and Output stay fixed.");
    if (edit.action === "move" && edit.before === edit.id) return next;
    if (edit.action === "move" && next.parallel?.after === edit.id && edit.target !== "main") throw new Error("Keep the parallel split point in the main chain.");
    if (edit.action === "remove" && next.parallel?.after === edit.id) next.parallel.after = source[source.indexOf(module) - 1].id;
    source.splice(source.indexOf(module), 1);
  }
  if (edit.action === "remove") {
    for (const snapshot of next.snapshots) snapshot.values = snapshot.values.filter(item => item.id !== edit.id);
    next.midi.bindings = next.midi.bindings.filter(item => item.module !== edit.id);
  } else {
    const target = chains.get(edit.target);
    if (!target) throw new Error("Choose an existing signal path.");
    let position = edit.before ? target.findIndex(item => item.id === edit.before) : target.length;
    if (position < 0) throw new Error("Drop position is no longer available.");
    if (edit.target === "main") position = Math.max(1, Math.min(target.length - 1, position));
    target.splice(position, 0, module!);
  }
  return parseRigPreset(next);
}
