from copy import deepcopy

from fastapi.testclient import TestClient
from jsonschema import ValidationError
import pytest

from app.contracts import example_preset, validate_preset
from app.main import app

client = TestClient(app)


def test_health_and_example_are_explicitly_scaffolded():
    assert client.get("/api/health").json() == {
        "status": "ok", "mode": "scaffold", "analysis_available": False,
    }
    response = client.get("/api/presets/example")
    assert response.status_code == 200
    assert response.json()["provenance"] == {"kind": "fixture", "provider": None, "model": None}
    validate_preset(response.json())


def test_analysis_does_not_fake_a_successful_job():
    response = client.post("/api/jobs")
    assert response.status_code == 501
    assert response.json()["error"]["code"] == "analysis_not_implemented"
    assert "job_id" not in response.json()


@pytest.mark.parametrize("value", [-0.01, 1.01, float("nan"), float("inf"), "0.5", None, True])
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
