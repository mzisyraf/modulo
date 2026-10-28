import type { Preset } from "@modulo/contracts";

// Bypass skips drive/EQ; neutral input gain also removes the preset's input boost.
export function auditionPreset(preset: Preset, original: boolean): Preset {
  return original ? { ...preset, parameters: { ...preset.parameters, input_gain_db: 0 } } : preset;
}
