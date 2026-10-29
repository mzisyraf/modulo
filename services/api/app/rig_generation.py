"""Feature-informed individual gear settings; audio remains in the browser."""
from decimal import Decimal
import hashlib
import json
import os

from .preset_generation import PresetGenerator, PresetError, MODEL, strict_json, post_completion
from .rig_proposal import RIG_SCHEMA, RIG_CATALOG, validate_rig_proposal
from .source_calibration import SourceCalibration, baseline_gain
from .tone_features import ToneFeatures
from .contracts import ROOT

SUPER_MODEL = "nvidia/nemotron-3-super-120b-a12b"
CATALOG_SHA = hashlib.sha256((ROOT / "contracts/rig-catalog.json").read_text(encoding="utf-8").encode()).hexdigest()


def post_rig_completion(key, payload):
    return post_completion(key, payload, timeout=120)


def validate_generated_rig(value):
    if set(value) != {"proposal", "provenance", "catalog_sha256", "quality_flags"}:
        raise ValueError("Invalid rig result")
    validate_rig_proposal(value["proposal"])
    if value["catalog_sha256"] != CATALOG_SHA or value["provenance"] not in [
        {"kind": "generated", "provider": "nebius", "model": model} for model in (MODEL, SUPER_MODEL)
    ] or value["quality_flags"] != ["measured_spectral_proxy", "tone_matching_unverified"]:
        raise ValueError("Invalid rig provenance")
    return value


class RigGenerator(PresetGenerator):
    output_field = "rig_proposal"
    validate_result = staticmethod(validate_generated_rig)
    # 30 Oct official models_info: <=262144 context, Super $0.30/$0.90 per M; $0.20 covers context and 6000 output.
    reservation_usd = Decimal("0.20")

    def __init__(self, *args, model=MODEL, **kwargs):
        kwargs.setdefault("transport", post_rig_completion)
        super().__init__(*args, **kwargs)
        if model not in (MODEL, SUPER_MODEL):
            raise PresetError("provider_configuration", "Unsupported rig model.")
        self.model = model
        self.reservation_model = model
        self.max_model_requests = 6 if model == SUPER_MODEL else 100

    @classmethod
    def from_env(cls, directory=None):
        base = PresetGenerator.from_env() if directory is None else PresetGenerator.from_env(directory)
        model = MODEL
        path = ROOT / "services/api/.env"
        if path.is_file():
            for line in path.read_text(encoding="utf-8-sig").splitlines():
                name, separator, value = line.strip().partition("=")
                if separator and name == "NEBIUS_RIG_MODEL": model = value.strip().strip('"').strip("'")
        return cls(base.directory, key=base.key, budget_usd=base.budget if base.budget is not None else "unlimited",
                   max_requests=base.max_requests, model=os.environ.get("NEBIUS_RIG_MODEL", model))

    @property
    def available(self):
        return bool(self.key and self.max_requests and self.budget is not None and self.budget >= self.reservation_usd)

    def generate(self, reference, source_calibration=None):
        try:
            source = SourceCalibration.model_validate(source_calibration).model_dump(exclude_none=True)
            if not source.get("tone_features"):
                raise ValueError()
            target = ToneFeatures.model_validate(reference["tone_features"]).model_dump()
            if type(reference["start_seconds"]) is not int or type(reference["end_seconds"]) is not int or not 10 <= reference["end_seconds"] - reference["start_seconds"] <= 20:
                raise ValueError()
        except (ValueError, TypeError, KeyError):
            raise PresetError("calibration_required", "Calibrate live guitar or a dry recording and confirm a measured passage first.", 422) from None
        catalog = [{"model_id": model["id"], "name": model["name"], "description": model["description"],
                    "parameters": [{key: parameter[key] for key in ("id", "type", "unit", "min", "max", "choices", "defaultValue") if key in parameter}
                                   for parameter in model["parameters"]]} for model in RIG_CATALOG]
        context = {"source": source, "target": target, "input_gain_db_fixed": baseline_gain(source),
                   "target_metrics": reference.get("metrics", {}), "models": catalog,
                   "source_temporal": source.get("temporal_features"), "target_temporal": reference.get("temporal_features"),
                   "output": "Fixed protected output at -18dB; do not include input/output modules."}
        payload = {"model": self.model, "n": 1, "store": False, "stream": False, "max_completion_tokens": 6000,
                   "messages": [{"role": "system", "content": (
                       "Return one JSON rig proposal conforming exactly to the schema. Configure individual physical parameter values for every selected model, not a factory-preset identifier. "
                       "Choose the smallest useful ordered chain to transform the dry guitar toward target measured tone. Use 1-8 installed modules. "
                       "Every model's parameters must be explicitly provided, including switches and inactive conditional controls. Avoid unnecessary effects and gain stacking. "
                       "Use EQ/cabinet for spectral balance, drive only for evidence of saturation, dynamics for crest changes, and delay/reverb only when evidence supports them. "
                       "Different notes/technique and separation bleed affect these measurements. You do not hear audio; do not claim exact equipment identification or guaranteed matching. "
                       "Output name, description, tempo_bpm, proposal_version=1 and modules; no Markdown or additional fields. Keep output levels conservative.")},
                       {"role": "user", "content": json.dumps(context, allow_nan=False)}],
                   "response_format": {"type": "json_schema", "json_schema": {"name": "guitar_rig", "strict": True, "schema": RIG_SCHEMA}}}
        if len(json.dumps(payload, ensure_ascii=False).encode()) > 300000:
            raise PresetError("provider_configuration", "Rig catalog exceeds the bounded request size.")
        self.reserve()
        response = self.transport(self.key, payload)
        try:
            if response["model"] != self.model or len(response["choices"]) != 1 or response["choices"][0]["finish_reason"] != "stop":
                raise ValueError()
            proposal = validate_rig_proposal(strict_json(response["choices"][0]["message"]["content"]))
            return validate_generated_rig({"proposal": proposal, "provenance": {"kind": "generated", "provider": "nebius", "model": self.model},
                                          "catalog_sha256": CATALOG_SHA, "quality_flags": ["measured_spectral_proxy", "tone_matching_unverified"]})
        except Exception:
            raise PresetError("invalid_provider_rig", "The model did not return a complete supported rig. Nothing was applied; the attempt may be billed.", 502) from None
