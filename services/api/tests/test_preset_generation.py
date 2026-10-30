from copy import deepcopy
import json
from unittest.mock import patch

import pytest

from app import preset_generation as provider


REFERENCE = {"start_seconds": 30, "end_seconds": 45, "quality_flags": ["manual_selection", "separation_quality_unverified"],
             "metrics": {"guitar_rms_dbfs": -29.5, "stem_to_mix_energy_ratio": 0.03,
                         "quiet_second_fraction": 0.0, "clipped_sample_fraction": 0.0}}
VALUE = {"name": "Proposed starting preset", "description": "Model prose is not trusted disclosure.",
         "parameters": {"input_gain_db": -3, "drive": 0.2, "bass_db": 1, "mid_db": 0, "treble_db": 2, "master_gain_db": -18}}


def response(value=VALUE, finish="stop"):
    return {"model": provider.MODEL, "choices": [{"finish_reason": finish, "message": {"content": json.dumps(value)}}]}


def generator(path, transport, **kwargs):
    return provider.PresetGenerator(path, key="unit-test-not-a-real-key", transport=transport, **kwargs)


def test_uses_measured_reference_and_trusted_disclosure(tmp_path):
    captured = []
    engine = generator(tmp_path, lambda key, payload: captured.append(payload) or response())
    preset = engine.generate(REFERENCE)
    assert preset["parameters"] == VALUE["parameters"]
    assert preset["provenance"] == {"kind": "generated", "provider": "nebius", "model": provider.MODEL}
    assert "source_calibration_missing" in preset["quality_flags"]
    assert "separation_quality_unverified" in preset["quality_flags"]
    assert preset["description"].startswith("Uncalibrated AI starting preset")
    assert "Model prose" not in preset["description"]
    packet = json.loads(captured[0]["messages"][1]["content"])
    assert packet["target_metrics"] == REFERENCE["metrics"]
    assert "source_features" not in packet
    assert captured[0]["max_completion_tokens"] == 1500
    assert captured[0]["n"] == 1 and captured[0]["store"] is False
    contract=captured[0]["response_format"]
    assert contract["type"]=="json_schema" and contract["json_schema"]["strict"] is True
    assert contract["json_schema"]["schema"]["properties"]["name"]["maxLength"]==80


@pytest.mark.parametrize("bad", [True, "0.2", -0.1, 1.1, float("nan"), float("inf")])
def test_rejects_bad_provider_values_without_fallback(tmp_path, bad):
    value = deepcopy(VALUE)
    value["parameters"]["drive"] = bad
    with pytest.raises(provider.PresetError, match="did not return a valid"):
        generator(tmp_path, lambda *_: response(value)).generate(REFERENCE)
    assert json.loads((tmp_path / "budget.json").read_text())["attempts"] == 1


@pytest.mark.parametrize("kind", ["effect", "provenance", "missing", "markdown", "duplicate", "truncated", "wrong_model"])
def test_rejects_bad_structure(tmp_path, kind):
    value = deepcopy(VALUE)
    if kind == "effect":
        value["parameters"]["reverb"] = 0.2
    elif kind == "provenance":
        value["provenance"] = {"kind": "fixture"}
    elif kind == "missing":
        del value["parameters"]["bass_db"]
    result = response(value)
    if kind == "markdown":
        result["choices"][0]["message"]["content"] = "```json\n{}\n```"
    elif kind == "duplicate":
        result["choices"][0]["message"]["content"] = '{"name":"a","name":"b"}'
    elif kind == "truncated":
        result["choices"][0]["finish_reason"] = "length"
    elif kind == "wrong_model":
        result["model"] = "other/model"
    with pytest.raises(provider.PresetError) as error:
        generator(tmp_path, lambda *_: result).generate(REFERENCE)
    assert error.value.code == "invalid_provider_preset"


def test_timeout_keeps_reservation_and_restart_continues_tracking(tmp_path):
    calls = []
    def failure(*_):
        calls.append(1)
        raise provider.PresetError("provider_unavailable", "Timeout")
    first = provider.PresetGenerator(tmp_path, key="test", transport=failure)
    with pytest.raises(provider.PresetError, match="Timeout"):
        first.generate(REFERENCE)
    second = provider.PresetGenerator(tmp_path, key="test", transport=failure)
    with pytest.raises(provider.PresetError, match="Timeout"):
        second.generate(REFERENCE)
    assert len(calls) == 2
    assert json.loads((tmp_path / "budget.json").read_text())["attempts"] == 2


def test_missing_key_never_calls_provider(tmp_path):
    def unexpected(*_):
        pytest.fail("No provider request should run")
    engine = provider.PresetGenerator(tmp_path, transport=unexpected)
    with pytest.raises(provider.PresetError) as error:
        engine.generate(REFERENCE)
    assert error.value.code == "generation_disabled"
    assert not (tmp_path / "budget.json").exists()


def test_corrupt_budget_fails_closed(tmp_path):
    (tmp_path / "budget.json").write_text('{"attempts":0,"reserved_usd":"NaN"}')
    with pytest.raises(provider.PresetError) as error:
        generator(tmp_path, lambda *_: pytest.fail("No request")).generate(REFERENCE)
    assert error.value.code == "budget_unavailable"


def test_uncapped_usage_preserves_exhausted_ledger_and_extra_fields(tmp_path):
    ledger = {"attempts": 100, "reserved_usd": "50", "audit": "keep"}
    (tmp_path / "budget.json").write_text(json.dumps(ledger))
    calls = []
    engine = provider.PresetGenerator(tmp_path, key="unit-test", transport=lambda *_: calls.append(1) or response())
    assert engine.available
    engine.generate(REFERENCE)
    engine.generate(REFERENCE)
    after = json.loads((tmp_path / "budget.json").read_text())
    assert after["attempts"] == 102 and after["audit"] == "keep"
    assert provider.Decimal(after["reserved_usd"]) == provider.Decimal("50") + 2 * provider.RESERVATION_USD
    assert calls == [1, 1]


def test_uncapped_still_requires_readable_ledger(tmp_path):
    (tmp_path / "budget.json").write_text('{"attempts":0,"reserved_usd":"NaN"}')
    engine = provider.PresetGenerator(tmp_path, key="unit-test",
                                      transport=lambda *_: pytest.fail("Corrupt ledger must not send a request"))
    with pytest.raises(provider.PresetError) as failure:
        engine.generate(REFERENCE)
    assert failure.value.code == "budget_unavailable"


@pytest.mark.parametrize("legacy_limit", ["0", "6", "100", "unlimited", "invalid"])
def test_retired_environment_limits_do_not_disable_provider_or_rig(tmp_path, monkeypatch, legacy_limit):
    from fastapi.testclient import TestClient
    from app.main import create_app
    from app.jobs import JobStore
    monkeypatch.setenv("NEBIUS_API_KEY", "unit-test")
    from app.rig_generation import RigGenerator
    monkeypatch.setenv("NEBIUS_BUDGET_USD", legacy_limit)
    monkeypatch.setenv("NEBIUS_MAX_REQUESTS", legacy_limit)
    engine = provider.PresetGenerator.from_env(tmp_path / "budget")
    rig = RigGenerator.from_env(tmp_path / "budget")
    assert engine.available and rig.available
    with TestClient(create_app(JobStore(tmp_path / "jobs"), engine, rig), base_url="http://127.0.0.1") as client:
        health = client.get("/api/health").json()
    assert health["preset_budget_unlimited"] and health["preset_generation_available"] and health["rig_generation_available"]


def test_env_defaults_disabled_and_rejects_external_key_destination(tmp_path, monkeypatch):
    monkeypatch.setattr(provider, "ROOT", tmp_path)
    for key in ("NEBIUS_API_KEY", "NEBIUS_MODEL", "NEBIUS_BASE_URL", "NEBIUS_BUDGET_USD", "NEBIUS_MAX_REQUESTS"):
        monkeypatch.delenv(key, raising=False)
    assert provider.PresetGenerator.from_env(tmp_path / "budget").available is False
    monkeypatch.setenv("NEBIUS_BASE_URL", "https://example.org/v1")
    with pytest.raises(provider.PresetError) as error:
        provider.PresetGenerator.from_env(tmp_path / "budget")
    assert error.value.code == "provider_configuration"


@pytest.mark.parametrize("bad", [{}, {**REFERENCE, "start_seconds": True}, {**REFERENCE, "metrics": {**REFERENCE["metrics"], "guitar_rms_dbfs": float("nan")}}])
def test_invalid_reference_does_not_consume_allowance(tmp_path, bad):
    with pytest.raises(provider.PresetError) as error:
        generator(tmp_path, lambda *_: pytest.fail("No request")).generate(bad)
    assert error.value.code == "invalid_reference"
    assert not (tmp_path / "budget.json").exists()


def test_credentials_are_not_forwarded_on_redirect_or_logged():
    request = provider.urllib.request.Request(provider.BASE_URL + "/chat/completions")
    assert provider.NoRedirect().redirect_request(request, None, 307, "", {}, "https://example.org") is None
    failure = provider.urllib.error.HTTPError(request.full_url, 401, "contains-private-key", {}, None)
    with patch.object(provider.urllib.request.OpenerDirector, "open", side_effect=failure):
        with pytest.raises(provider.PresetError) as error:
            provider.post_completion("contains-private-key", {})
    assert "contains-private-key" not in str(error.value)
    assert error.value.code == "provider_unavailable"
