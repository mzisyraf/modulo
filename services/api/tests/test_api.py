from copy import deepcopy
import json

from fastapi.testclient import TestClient
from jsonschema import ValidationError
import pytest

from app.contracts import ROOT, example_preset, validate_preset
from app.main import app

client = TestClient(app, base_url="http://127.0.0.1")


def test_health_and_example_are_explicitly_scaffolded():
    assert client.get("/api/health").json() == {
        "status": "ok", "mode": "scaffold", "analysis_available": False,
        "separation_available": True, "preset_generation_available": False,
        "preset_budget_unlimited": False,
        "rig_generation_available": False,
    }
    response = client.get("/api/presets/example")
    assert response.status_code == 200
    assert response.json()["provenance"] == {"kind": "fixture", "provider": None, "model": None}
    validate_preset(response.json())


def test_job_requires_an_audio_upload():
    response = client.post("/api/jobs")
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "invalid_upload"
    assert "job_id" not in response.json()


def test_local_built_preview_can_submit_but_unrelated_origins_cannot():
    for origin in ["http://127.0.0.1:4173", "http://localhost:4173"]:
        assert client.post("/api/jobs", headers={"Origin": origin}).status_code == 415
    assert client.post("/api/jobs", headers={"Origin": "https://unrelated.example"}).status_code == 403


@pytest.mark.parametrize("value", [-0.01, 1.01, float("nan"), float("inf"), "0.5", None, True, 10**400])
def test_shared_schema_rejects_unsafe_drive(value):
    preset = example_preset()
    preset["parameters"]["drive"] = value
    with pytest.raises(ValidationError):
        validate_preset(preset)


def test_schema_rejects_unsupported_controls_and_false_provenance():
    preset = example_preset()
    unknown_control = deepcopy(preset)
    unknown_control["parameters"]["delay_ms"] = 500
    with pytest.raises(ValidationError):
        validate_preset(unknown_control)
    preset["provenance"]["kind"] = "generated"
    with pytest.raises(ValidationError):
        validate_preset(preset)


@pytest.mark.parametrize(
    "case",
    json.loads((ROOT / "fixtures" / "preset.parameter-cases.json").read_text(encoding="utf-8")),
    ids=lambda case: case["name"],
)
def test_shared_parameter_cases(case):
    preset = example_preset()
    preset["parameters"].update(case["parameters"])
    if case["valid"]:
        validate_preset(preset)
    else:
        with pytest.raises(ValidationError):
            validate_preset(preset)
