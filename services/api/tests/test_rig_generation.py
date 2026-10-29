from copy import deepcopy
import json
import math
import pytest
from app.rig_generation import RigGenerator, validate_generated_rig, CATALOG_SHA
from app.rig_proposal import validate_rig_proposal
from app.preset_generation import PresetError, MODEL
from app.tone_features import tone_features
from test_source_calibration import SOURCE
from test_preset_generation import REFERENCE

PROPOSAL = {"proposal_version": "1", "name": "Custom echo", "description": "Individual controls", "tempo_bpm": 120,
            "modules": [{"model_id": "delay.single_tap", "enabled": True, "parameters": {"time_ms": 237, "mix": .173}}]}
FEATURES = tone_features([.1 * math.sin(i * 2 * math.pi * 440 / 44100) for i in range(44100 * 3)], 44100)


def response(value=PROPOSAL):
    return {"model": MODEL, "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(value)}}]}


def test_custom_values_validated_before_return_and_durable_reservation(tmp_path):
    calls = []
    engine = RigGenerator(tmp_path, key="test-only", budget_usd="1", max_requests=2,
                          transport=lambda key, payload: calls.append(payload) or response())
    source = {**SOURCE, "tone_features": FEATURES, "origin": "file"}
    result = engine.generate({**REFERENCE, "tone_features": FEATURES}, source)
    assert result["proposal"] == PROPOSAL and result["catalog_sha256"] == CATALOG_SHA
    assert result["provenance"]["model"] == MODEL
    packet = json.loads(calls[0]["messages"][1]["content"])
    assert packet["source"]["origin"] == "file" and packet["target"] == FEATURES
    assert "factory" not in packet and calls[0]["response_format"]["json_schema"]["strict"]
    assert json.loads((tmp_path / "budget.json").read_text())["reserved_usd"] == "0.20"
    engine.generate({**REFERENCE, "tone_features": FEATURES}, source)
    with pytest.raises(PresetError, match="allowance"):
        engine.generate({**REFERENCE, "tone_features": FEATURES}, source)
    assert len(calls) == 2


@pytest.mark.parametrize("patch", [{"parameters": {"time_ms": 237}}, {"parameters": {"time_ms": 237, "mix": .2, "invented": 1}},
    {"model_id": "cabinet.custom"}, {"model_id": "input.interface"}, {"parameters": {"time_ms": 237, "mix": True}}])
def test_missing_and_unsupported_controls_rejected(patch):
    value = deepcopy(PROPOSAL); value["modules"][0].update(patch)
    with pytest.raises(Exception):
        validate_rig_proposal(value)


def test_missing_calibration_never_reserves_and_bad_model_output_keeps_reservation(tmp_path):
    calls = []
    engine = RigGenerator(tmp_path, key="test", budget_usd="1", max_requests=2, transport=lambda *args: calls.append(1) or response({}))
    with pytest.raises(PresetError): engine.generate(REFERENCE)
    assert not calls and not (tmp_path / "budget.json").exists()
    with pytest.raises(PresetError) as error: engine.generate({**REFERENCE, "tone_features": FEATURES}, {**SOURCE, "tone_features": FEATURES})
    assert error.value.code == "invalid_provider_rig" and len(calls) == 1
    assert json.loads((tmp_path / "budget.json").read_text())["attempts"] == 1


def test_rig_requires_bounded_budget_and_rejects_forged_result(tmp_path):
    assert not RigGenerator(tmp_path, key="test", budget_usd="unlimited", max_requests=2).available
    with pytest.raises(ValueError): validate_generated_rig({"proposal": PROPOSAL})


def test_rig_api_measures_target_caches_own_kind_and_invalidates_reference(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import create_app
    from app.jobs import JobStore
    from app.preset_generation import PresetGenerator
    from test_jobs import success
    from test_job_presets import confirmed_job, wait_generation
    calls = []
    rig = RigGenerator(tmp_path / "budget", key="test", budget_usd="1", max_requests=3,
                       transport=lambda _key, payload: calls.append(payload) or response())
    store = JobStore(tmp_path / "jobs"); monkeypatch.setattr(store, "run_worker", success)
    with TestClient(create_app(store, PresetGenerator(tmp_path / "legacy"), rig), base_url="http://127.0.0.1") as client:
        job_id, revision = confirmed_job(client); route = f"/api/jobs/{job_id}/rig"
        assert client.post(route, json={"reference_revision": revision}).status_code == 422
        payload = {"reference_revision": revision, "source_calibration": {**SOURCE, "tone_features": FEATURES, "origin": "file"}}
        assert client.post(route, json=payload).status_code == 202
        result = wait_generation(client, job_id)["generation"]
        assert result["status"] == "ready" and result["kind"] == "rig_proposal"
        assert result["rig_proposal"]["proposal"] == PROPOSAL and "preset" not in result
        assert "target_temporal_features" in result
        assert client.post(route, json=payload).json()["request_id"] == result["request_id"] and len(calls) == 1
        assert client.post(f"/api/jobs/{job_id}/reference", json={"start_seconds": 1, "end_seconds": 11}).status_code == 200
        assert client.post(route, json=payload).status_code == 409
        assert "generation" not in client.get(f"/api/jobs/{job_id}").json()
