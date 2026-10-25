import math
from pathlib import Path

from jsonschema import Draft7Validator, validators
import json

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = json.loads((ROOT / "contracts" / "preset.schema.json").read_text(encoding="utf-8"))


def finite_number(_checker, value):
    if isinstance(value, bool):
        return False
    return isinstance(value, int) or (isinstance(value, float) and math.isfinite(value))


PresetValidator = validators.extend(
    Draft7Validator,
    type_checker=Draft7Validator.TYPE_CHECKER.redefine("number", finite_number),
)
validator = PresetValidator(SCHEMA)


def validate_preset(value):
    validator.validate(value)
    return value


def example_preset():
    value = json.loads((ROOT / "fixtures" / "preset.example.json").read_text(encoding="utf-8"))
    return validate_preset(value)
