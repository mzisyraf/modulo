"""Strict model-owned proposal boundary generated from the browser DSP registry."""
import json
import hashlib
from .contracts import ROOT, PresetValidator

RIG_SCHEMA = json.loads((ROOT / "contracts/rig-proposal.schema.json").read_text(encoding="utf-8"))
RIG_CATALOG = json.loads((ROOT / "contracts/rig-catalog.json").read_text(encoding="utf-8"))
rig_validator = PresetValidator(RIG_SCHEMA)


def audio_source_hash():
    sources = sorted((ROOT / "packages/audio/src").rglob("*"))
    return hashlib.sha256(b"".join(path.relative_to(ROOT).as_posix().encode() + b"\0" + path.read_text(encoding="utf-8").encode()
                                  for path in sources if path.is_file() and path.suffix in {".ts", ".js"})).hexdigest()


def validate_rig_proposal(value):
    rig_validator.validate(value)
    if not value["name"].strip():
        raise ValueError("Empty rig name")
    types = [module["model_id"].split(".")[0] for module in value["modules"]]
    if types.count("reverb") > 2 or types.count("cabinet") > 4:
        raise ValueError("Convolution budget exceeded")
    for module in value["modules"]:
        parameters = module["parameters"]
        if "low_cut_hz" in parameters and "high_cut_hz" in parameters and parameters["low_cut_hz"] >= parameters["high_cut_hz"]:
            raise ValueError("Overlapping cut frequencies")
    return value
