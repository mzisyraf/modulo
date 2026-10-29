"""Target-energy starting rigs with optional browser input-level calibration; no spectral matching."""

from decimal import Decimal, InvalidOperation
import json
import math
import os
from pathlib import Path
import urllib.error
import urllib.request

from app.contracts import ROOT, SCHEMA, validate_preset
from app.job_lock import exclusive_lock
from app.source_calibration import SourceCalibration, baseline_gain
from app.tone_features import ToneFeatures

MODEL = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"
BASE_URL = "https://api.tokenfactory.nebius.com/v1"
# shortcut: Nano-only reservation uses published rates/context; recheck before changing the model or rates.
RESERVATION_USD = Decimal("0.01608864")  # Full 262144-token input plus 1500 output at $0.06/$0.24 per million.
FLAGS = ["source_calibration_missing", "target_energy_only", "tone_matching_unverified"]


class PresetError(Exception):
    def __init__(self, code, message, status=503):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def strict_json(text):
    def pairs(items):
        value = {}
        for key, item in items:
            if key in value:
                raise ValueError("Duplicate JSON key.")
            value[key] = item
        return value

    def invalid(_value):
        raise ValueError("Nonfinite JSON number.")

    return json.loads(text, object_pairs_hook=pairs, parse_constant=invalid)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def post_completion(key, payload, *, timeout=30):
    request = urllib.request.Request(BASE_URL + "/chat/completions", method="POST",
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        data=json.dumps(payload, allow_nan=False).encode("utf-8"))
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout) as response:
            content = response.read(65537)
        if len(content) > 65536:
            raise ValueError("Oversized provider response.")
        return strict_json(content.decode("utf-8"))
    except urllib.error.HTTPError as failure:
        messages = {401: "The backend Nebius key was rejected.", 402: "Nebius credits are unavailable.",
                    403: "This Nebius account cannot use the configured model.", 429: "Nebius is rate limited. Try later."}
        raise PresetError("provider_unavailable", messages.get(failure.code, "Nebius could not generate a preset.")) from None
    except (OSError, ValueError, UnicodeError):
        raise PresetError("provider_unavailable", "Nebius timed out or returned an unreadable response. The attempt may still be billed.") from None


class PresetGenerator:
    def __init__(self, directory, *, key="", budget_usd="0", max_requests=0, transport=post_completion):
        self.directory = Path(directory)
        self.key = key
        self.transport = transport
        try:
            self.budget = None if str(budget_usd).strip().lower() == "unlimited" else Decimal(str(budget_usd))
            if (self.budget is not None and (not self.budget.is_finite() or not 0 <= self.budget <= Decimal("10"))
                    or type(max_requests) is not int or not 0 <= max_requests <= 100):
                raise ValueError()
        except (ValueError, InvalidOperation):
            raise PresetError("provider_configuration", "Use a local budget of US$0–10 or explicit 'unlimited', and 0–100 requests.") from None
        self.max_requests = max_requests

    @classmethod
    def from_env(cls, directory=ROOT / "data" / "preset-inference"):
        settings = {}
        names = {"NEBIUS_API_KEY", "NEBIUS_MODEL", "NEBIUS_BASE_URL", "NEBIUS_BUDGET_USD", "NEBIUS_MAX_REQUESTS"}
        path = ROOT / "services" / "api" / ".env"
        if path.is_file():
            for line in path.read_text(encoding="utf-8-sig").splitlines():
                name, separator, value = line.strip().partition("=")
                if separator and name in names:
                    settings[name] = value.strip().strip('"').strip("'")
        settings.update({name: os.environ[name] for name in names if name in os.environ})
        if settings.get("NEBIUS_BASE_URL", BASE_URL).rstrip("/") != BASE_URL or settings.get("NEBIUS_MODEL", MODEL) != MODEL:
            raise PresetError("provider_configuration", "This local starter supports only the official Nebius Nano endpoint.")
        try:
            count = int(settings.get("NEBIUS_MAX_REQUESTS", "0"))
        except ValueError:
            raise PresetError("provider_configuration", "NEBIUS_MAX_REQUESTS must be a whole number.") from None
        return cls(directory, key=settings.get("NEBIUS_API_KEY", ""),
                   budget_usd=settings.get("NEBIUS_BUDGET_USD", "0"), max_requests=count)

    @property
    def available(self):
        return bool(self.key and self.max_requests and (self.budget is None or self.budget >= RESERVATION_USD))

    def reserve(self):
        if not self.available:
            raise PresetError("generation_disabled", "Set a backend Nebius key and an approved request/budget allowance before generating.")
        self.directory.mkdir(parents=True, exist_ok=True)
        try:
            with exclusive_lock(self.directory / ".budget.lock"):
                path = self.directory / "budget.json"
                ledger = strict_json(path.read_text(encoding="utf-8")) if path.is_file() else {"attempts": 0, "reserved_usd": "0"}
                attempts, spent = ledger["attempts"], Decimal(ledger["reserved_usd"])
                if type(attempts) is not int or attempts < 0 or not spent.is_finite() or spent < 0:
                    raise ValueError()
                reservation = getattr(self, "reservation_usd", RESERVATION_USD)
                model = getattr(self, "reservation_model", None)
                counts = ledger.get("model_attempts", {})
                if not isinstance(counts, dict) or any(type(count) is not int or count < 0 for count in counts.values()):
                    raise ValueError()
                if model and counts.get(model, 0) >= self.max_model_requests:
                    raise PresetError("budget_exhausted", "The approved request allowance for this model is used.", 429)
                if attempts >= self.max_requests or (self.budget is not None and spent + reservation > self.budget):
                    raise PresetError("budget_exhausted", "The local preset-generation allowance is used. Ask the operator to review the budget.", 429)
                temporary = self.directory / "budget.tmp"
                updated = {**ledger, "attempts": attempts + 1, "reserved_usd": str(spent + reservation)}
                if model:
                    updated["model_attempts"] = {**counts, model: counts.get(model, 0) + 1}
                temporary.write_text(json.dumps(updated), encoding="utf-8")
                temporary.replace(path)
        except PresetError:
            raise
        except (OSError, ValueError, KeyError, TypeError, InvalidOperation):
            raise PresetError("budget_unavailable", "The generation budget is busy or unreadable. No provider request was sent.") from None

    def generate(self, reference, source_calibration=None):
        """Caller must pass the confirmed server-side selection, never request-body metrics."""
        try:
            start, end = reference["start_seconds"], reference["end_seconds"]
            if type(start) is not int or type(end) is not int or start < 0 or not 10 <= end - start <= 20:
                raise ValueError()
            metrics = {name: reference["metrics"][name] for name in (
                "guitar_rms_dbfs", "stem_to_mix_energy_ratio", "quiet_second_fraction", "clipped_sample_fraction")}
            if any(type(value) not in (int, float) or not math.isfinite(value) for value in metrics.values()):
                raise ValueError()
            if metrics["guitar_rms_dbfs"] > 0 or metrics["stem_to_mix_energy_ratio"] < 0 or any(not 0 <= metrics[name] <= 1 for name in ("quiet_second_fraction", "clipped_sample_fraction")):
                raise ValueError()
            flags = reference["quality_flags"]
            if not isinstance(flags, list) or len(flags) > 15 or any(not isinstance(flag, str) or len(flag) > 100 for flag in flags):
                raise ValueError()
        except (KeyError, TypeError, ValueError, OverflowError):
            raise PresetError("invalid_reference", "Confirm a valid passage before generating a preset.", 422) from None
        if source_calibration is not None:
            try:
                source_calibration = SourceCalibration.model_validate(source_calibration).model_dump(exclude_none=True)
            except ValueError:
                raise PresetError("invalid_source_calibration", "Calibrate a usable recording before generating.", 422) from None
        spectral_pair = bool(source_calibration and source_calibration.get("tone_features"))
        if spectral_pair:
            try:
                target_tone = ToneFeatures.model_validate(reference["tone_features"]).model_dump()
            except (KeyError, ValueError):
                raise PresetError("missing_target_spectrum", "Measure the confirmed target spectrum before generating.", 422) from None
        payload = {"model": MODEL, "n": 1, "store": False, "stream": False, "max_completion_tokens": 1500,
            "messages": [{"role": "system", "content": (
                "Return one JSON object with exactly name, description and parameters. No Markdown. "
                "Propose a conservative starting preset using only the supplied six-control schema. "
                "Only target-energy measurements are available; no dry source calibration, spectral measurements "
                "or audible matching is available. Do not identify equipment, add effects or claim tone similarity.")},
                {"role": "user", "content": json.dumps({"input_kind": "measured_target_energy_only",
                    "target_metrics": metrics, "supported_parameters_schema": SCHEMA["properties"]["parameters"]}, allow_nan=False)}]}
        payload["response_format"] = {"type":"json_schema","json_schema":{"name":"guitar_preset","strict":True,"schema":{
            "type":"object","additionalProperties":False,"required":["name","description","parameters"],
            "properties":{key:SCHEMA["properties"][key] for key in ["name","description","parameters"]}}}}
        if source_calibration is not None:
            baseline = {"input_gain_db": baseline_gain(source_calibration), "drive": 0, "bass_db": 0, "mid_db": 0, "treble_db": 0, "master_gain_db": -12}
            payload["messages"][0]["content"] = (
                "Return exactly name, description and parameters as one JSON object. Use the supplied six-control schema. "
                "Start from the neutral preset calibrated to the user's browser-measured input level, then propose conservative drive, EQ and output settings from target energy. "
                "Keep the baseline input_gain_db unchanged. Only level calibration exists; no source/target spectral analysis or audible matching. "
                "Do not identify equipment or claim tone similarity. Do not add effects.")
            payload["messages"][1]["content"] = json.dumps({"input_kind": "browser_level_calibration_and_target_energy",
                "source_features": {key: value for key, value in source_calibration.items() if key != "id"},
                "baseline_parameters": baseline, "target_metrics": metrics,
                "supported_parameters_schema": SCHEMA["properties"]["parameters"]}, allow_nan=False)
        if spectral_pair:
            source_tone = source_calibration["tone_features"]
            delta = [round(10*math.log10((target+1e-6)/(source+1e-6)),3) for source,target in zip(source_tone["bands"],target_tone["bands"])]
            payload["messages"][0]["content"] = (
                "Return exactly name, description and parameters as one JSON object. Use only the six-control schema. "
                "Infer a conservative rig to transform the dry source toward the target's measured tone. "
                "Keep calibrated input_gain_db unchanged. Start with drive 0 when crest/flatness suggest clean guitar; "
                "use drive only for evidence of added saturation. Band deltas describe normalized energy changes, not literal EQ knob values. "
                "Different notes, technique and separation bleed can affect spectra; do not identify equipment or claim an exact match. "
                "The actual engine has NO cabinet, compressor, delay or reverb. Output one bounded proposal, no unsupported effects.")
            payload["messages"][1]["content"] = json.dumps({"input_kind":"measured_source_and_target_spectra",
                "source_features":{key:value for key,value in source_calibration.items() if key!="id"},
                "target_metrics":metrics,"target_tone_features":target_tone,"band_delta_db":delta,
                "band_edges_hz":[40,120,350,1000,3000,8000,16000],"baseline_parameters":baseline,
                "engine_semantics":{"input_gain_db":"linear gain before drive", "drive":"0 is identity; otherwise tanh((1+40*drive)*x)/tanh(1+40*drive), 2x oversampling",
                    "bass_db":"250Hz low shelf", "mid_db":"1000Hz peaking, Q=0.8", "treble_db":"3000Hz high shelf", "master_gain_db":"gain after EQ, followed by +/-0.95 output guard"},
                "supported_parameters_schema":SCHEMA["properties"]["parameters"]},allow_nan=False)
        self.reserve()
        response = self.transport(self.key, payload)
        rejection_stage = "response_metadata"
        try:
            if response["model"] != MODEL or len(response["choices"]) != 1 or response["choices"][0]["finish_reason"] != "stop":
                raise ValueError()
            rejection_stage = "json_parse"
            value = strict_json(response["choices"][0]["message"]["content"])
            rejection_stage = "proposal_fields"
            if not isinstance(value, dict) or set(value) != {"name", "description", "parameters"}:
                raise ValueError()
            disclosure_flags = FLAGS if source_calibration is None else ["source_level_calibrated", "spectral_calibration_missing", "target_energy_only", "tone_matching_unverified"]
            if spectral_pair:
                disclosure_flags = ["source_level_calibrated", "spectral_features_measured", "tone_matching_unverified"]
            preset = {**value, "schema_version": "1", "quality_flags": list(dict.fromkeys([*disclosure_flags, *flags])),
                      "provenance": {"kind": "generated", "provider": "nebius", "model": MODEL}}
            rejection_stage = "schema_validation"
            validate_preset(preset)
            # Disclosures belong to trusted code, not an unreliable model description.
            preset["description"] = "Uncalibrated AI starting preset from target energy only. Tone similarity is unverified."
            if source_calibration is not None:
                preset["parameters"]["input_gain_db"] = baseline_gain(source_calibration)
                preset["description"] = "AI starting rig over your input-level calibration. Spectral tone and audible similarity remain unverified."
            if spectral_pair:
                preset["description"] = "AI starting rig from measured source and target spectra. Rendered tone similarity remains unverified until checked."
            return validate_preset(preset)
        except Exception:
            raise PresetError("invalid_provider_preset", f"The model did not return a valid supported preset ({rejection_stage}). No preset was applied.", 502) from None
