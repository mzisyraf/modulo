"""Feature-informed individual gear settings; audio remains in the browser."""
from decimal import Decimal
import hashlib
import json
import os
import math
import logging

from .preset_generation import PresetGenerator, PresetError, MODEL, strict_json, post_completion
from .rig_proposal import RIG_SCHEMA, RIG_CATALOG, validate_rig_proposal, audio_source_hash
from .source_calibration import SourceCalibration, baseline_gain
from .tone_features import ToneFeatures, EDGES
from .temporal_features import LAGS_MS
from .contracts import ROOT

SUPER_MODEL = "nvidia/nemotron-3-super-120b-a12b"
PROMPT_VERSION = "rig-features-v2"
CATALOG_SHA = hashlib.sha256((ROOT / "contracts/rig-catalog.json").read_text(encoding="utf-8").encode()).hexdigest()
DSP_SHA = audio_source_hash()
logger = logging.getLogger(__name__)


def post_rig_completion(key, payload):
    return post_completion(key, payload, timeout=180)


def validate_generated_rig(value):
    if set(value) != {"proposal", "provenance", "catalog_sha256", "dsp_sha256", "quality_flags", "prompt_version"} or value["prompt_version"] != PROMPT_VERSION or value["dsp_sha256"] != DSP_SHA:
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
    # 30 Oct official models_info: <=262144 context, Super $0.30/$0.90 per M; $0.20 covers context and 10000 output.
    reservation_usd = Decimal("0.20")

    def __init__(self, *args, model=MODEL, allow_super_fallback=False, **kwargs):
        kwargs.setdefault("transport", post_rig_completion)
        super().__init__(*args, **kwargs)
        if model not in (MODEL, SUPER_MODEL):
            raise PresetError("provider_configuration", "Unsupported rig model.")
        self.model = model
        self.reservation_model = model
        self.max_model_requests = 6 if model == SUPER_MODEL else 100
        if type(allow_super_fallback) is not bool:
            raise PresetError("provider_configuration", "Use an explicit bounded fallback policy.")
        self.allow_super_fallback = allow_super_fallback

    @classmethod
    def from_env(cls, directory=None):
        base = PresetGenerator.from_env() if directory is None else PresetGenerator.from_env(directory)
        model = MODEL
        fallback = "0"
        path = ROOT / "services/api/.env"
        if path.is_file():
            for line in path.read_text(encoding="utf-8-sig").splitlines():
                name, separator, value = line.strip().partition("=")
                if separator and name == "NEBIUS_RIG_MODEL": model = value.strip().strip('"').strip("'")
                if separator and name == "NEBIUS_RIG_FALLBACK": fallback = value.strip().strip('"').strip("'")
        fallback = os.environ.get("NEBIUS_RIG_FALLBACK", fallback)
        if fallback not in {"0", "1"}: raise PresetError("provider_configuration", "NEBIUS_RIG_FALLBACK must be 0 or 1.")
        return cls(base.directory, key=base.key, budget_usd=base.budget if base.budget is not None else "unlimited",
                   max_requests=base.max_requests, model=os.environ.get("NEBIUS_RIG_MODEL", model), allow_super_fallback=fallback == "1")

    @property
    def available(self):
        return bool(self.key and self.max_requests and self.budget is not None and self.budget >= self.reservation_usd)

    @property
    def cache_key(self):
        return f"{CATALOG_SHA}:{DSP_SHA}:{self.model}:{PROMPT_VERSION}:fine24-v1:fallback={self.allow_super_fallback}"

    def generate(self, reference, source_calibration=None):
        try:
            return self.generate_once(reference, source_calibration)
        except PresetError as error:
            if not (self.allow_super_fallback and self.model == MODEL and error.code == "invalid_provider_rig"):
                raise
            fallback = RigGenerator(self.directory, key=self.key, budget_usd=self.budget, max_requests=self.max_requests,
                                    transport=self.transport, model=SUPER_MODEL)
            return fallback.generate_once(reference, source_calibration)

    def generate_once(self, reference, source_calibration=None):
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
        # Keep v2 inference inputs stable; fine bands are reserved for the local rendered optimizer.
        source_for_model = {**source, "tone_features": {key: value for key, value in source["tone_features"].items() if key != "fine_bands"}}
        target_for_model = {key: value for key, value in target.items() if key != "fine_bands"}
        delta = [round(10 * math.log10((b + 1e-6) / (a + 1e-6)), 3) for a, b in zip(source["tone_features"]["bands"], target["bands"])]
        context = {"source": source_for_model, "target": target_for_model, "input_gain_db_fixed": baseline_gain(source),
                   "band_edges_hz": EDGES, "band_delta_db": delta, "envelope_lags_ms": LAGS_MS,
                   "neutral_output_rms_estimate_dbfs": source["rms_dbfs"] + baseline_gain(source) - 18,
                   "measurement_notes": "Six bands are normalized power in the listed frequency intervals. Deltas are desired energy ratios, not literal EQ knob values. Envelope correlations are RMS-envelope similarity at the listed lags; playing rhythm also affects them. Release ratio measures the envelope 100-500ms after its strongest peak.",
                   "target_metrics": reference.get("metrics", {}), "models": catalog,
                   "source_temporal": source.get("temporal_features"), "target_temporal": reference.get("temporal_features"),
                   "output": "Fixed protected output at -18dB; do not include input/output modules."}
        payload = {"model": self.model, "n": 1, "store": False, "stream": False, "max_completion_tokens": 10000 if self.model == SUPER_MODEL else 6000,
                   "messages": [{"role": "system", "content": (
                       "Return one JSON rig proposal conforming exactly to the schema. Configure individual physical parameter values for every selected model, not a factory-preset identifier. "
                       "Choose the smallest useful ordered chain to transform the dry guitar toward target measured tone. Use 1-8 installed modules. "
                       "Every model's parameters must be explicitly provided, including switches and inactive conditional controls. Avoid unnecessary effects and gain stacking. "
                       "Use the band edges/deltas to choose and individually adjust EQ frequency, Q and gain; do not mistake reduced upper-band energy for a need to add a cabinet. "
                       "The fixed input/output gains explain much of the level difference; absolute target RMS alone does not imply compression. Use drive only for evidence of saturation, dynamics for crest changes, and delay/reverb when timing changes support them. "
                       "Different notes/technique and separation bleed affect these measurements. You do not hear audio; do not claim exact equipment identification or guaranteed matching. "
                       "Output name, description, tempo_bpm, proposal_version=1 and modules; no Markdown or additional fields. Keep output levels conservative.")},
                       {"role": "user", "content": json.dumps(context, allow_nan=False)}],
                   "response_format": {"type": "json_schema", "json_schema": {"name": "guitar_rig", "strict": True, "schema": RIG_SCHEMA}}}
        if len(json.dumps(payload, ensure_ascii=False).encode()) > 300000:
            raise PresetError("provider_configuration", "Rig catalog exceeds the bounded request size.")
        self.reserve()
        response = self.transport(self.key, payload)
        stage = "response_metadata"
        try:
            if response["model"] != self.model or len(response["choices"]) != 1 or response["choices"][0]["finish_reason"] != "stop":
                raise ValueError()
            stage = "proposal_json"
            proposal = strict_json(response["choices"][0]["message"]["content"])
            stage = "supported_parameters"
            proposal = validate_rig_proposal(proposal)
            stage = "trusted_provenance"
            return validate_generated_rig({"proposal": proposal, "provenance": {"kind": "generated", "provider": "nebius", "model": self.model},
                                          "catalog_sha256": CATALOG_SHA, "dsp_sha256": DSP_SHA, "prompt_version": PROMPT_VERSION, "quality_flags": ["measured_spectral_proxy", "tone_matching_unverified"]})
        except Exception:
            logger.warning("Rig response rejected: stage=%s model=%s", stage, self.model)
            raise PresetError("invalid_provider_rig", f"The model did not return a complete supported rig ({stage}). Nothing was applied; the attempt may be billed.", 502) from None
