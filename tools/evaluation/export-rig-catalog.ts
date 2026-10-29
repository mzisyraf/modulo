import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { inferenceModels, rigProposalSchema } from "../../packages/audio/src/rig/proposal.ts";

const catalog = inferenceModels();
const outputs = { "rig-proposal.schema.json": rigProposalSchema(), "rig-catalog.json": catalog,
  "rig-catalog-hash.json": { sha256: createHash("sha256").update(JSON.stringify(catalog, null, 2) + "\n").digest("hex") } };
for (const [name, value] of Object.entries(outputs)) {
  const path = new URL(`../../contracts/${name}`, import.meta.url), content = JSON.stringify(value, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8").replaceAll("\r\n", "\n") !== content) throw Error(`Regenerate ${name} from the audio registry.`);
  } else writeFileSync(path, content);
}
