import { allRigModules, parseRigPreset, type RigPreset } from "@modulo/audio";

export function isRemovableGear(type: string): boolean {
  return !["input", "output"].includes(type);
}

export function clearRemovableGear(value: RigPreset): RigPreset {
  const next = parseRigPreset(value);
  const input = next.chain.find(module => module.type === "input");
  const output = next.chain.find(module => module.type === "output");
  if (!input || !output) throw new Error("Rig input and output routing are unavailable.");
  const routingIds = new Set([input.id, output.id]);
  next.chain = [input, output];
  next.parallel = null;
  next.snapshots = next.snapshots.map(snapshot => ({
    ...snapshot,
    values: snapshot.values.filter(item => routingIds.has(item.id)),
  }));
  next.midi.bindings = next.midi.bindings.filter(binding => routingIds.has(binding.module));
  return parseRigPreset(next);
}

export function selectionAfterRemoval(before: RigPreset, after: RigPreset, removedId: string): string {
  const previous = allRigModules(before);
  const remaining = allRigModules(after);
  const removedIndex = Math.max(0, previous.findIndex(module => module.id === removedId));
  return remaining[Math.min(removedIndex, remaining.length - 1)]?.id ?? "";
}
