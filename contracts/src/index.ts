import Ajv from "ajv";
import schema from "../preset.schema.json" with { type: "json" };

export interface Preset {
  schema_version: "1";
  name: string;
  description: string;
  quality_flags: string[];
  provenance: { kind: "fixture" | "generated"; provider: string | null; model: string | null };
  parameters: {
    input_gain_db: number;
    drive: number;
    bass_db: number;
    mid_db: number;
    treble_db: number;
    master_gain_db: number;
  };
}

const validate = new Ajv({ allErrors: true, strictNumbers: true }).compile<Preset>(schema);

export function parsePreset(value: unknown): Preset {
  if (!validate(value)) throw new Error("Preset does not match the supported ToneForge controls.");
  return structuredClone(value);
}
