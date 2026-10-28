import json
from copy import deepcopy
import pytest
from app.source_calibration import SourceCalibration, baseline_gain
from app.preset_generation import PresetError
from test_preset_generation import generator, response, REFERENCE

SOURCE = {"id": "a" * 64, "method": "browser_level_v1", "duration_seconds": 20.0,
          "rms_dbfs": -27.0, "peak_dbfs": -4.0, "clipped_fraction": 0.0}


def test_calibrated_prompt_and_authoritative_baseline(tmp_path):
    calls = []
    engine = generator(tmp_path, lambda key, payload: calls.append(payload) or response())
    result = engine.generate(REFERENCE, SOURCE)
    packet = json.loads(calls[0]["messages"][1]["content"])
    assert packet["source_features"] == {k: v for k, v in SOURCE.items() if k != "id"}
    assert packet["baseline_parameters"]["input_gain_db"] == -2
    assert result["parameters"]["input_gain_db"] == -2
    assert packet["baseline_parameters"]["drive"] == 0
    assert "source_level_calibrated" in result["quality_flags"]
    assert "spectral_calibration_missing" in result["quality_flags"]
    assert "source_calibration_missing" not in result["quality_flags"]
    assert "similarity" in result["description"]
    assert calls[0]["max_completion_tokens"] == 1500 and calls[0]["n"] == 1


@pytest.mark.parametrize("patch", [{"id": "invalid"}, {"rms_dbfs": -70.0}, {"peak_dbfs": -40.0},
    {"rms_dbfs": float("nan")}, {"clipped_fraction": 0.01}, {"duration_seconds": 91.0}, {"path": "private.wav"}])
def test_invalid_source_cannot_reserve_or_call(tmp_path, patch):
    source = {**SOURCE, **patch}
    engine = generator(tmp_path, lambda *_: pytest.fail("Invalid source reached provider"))
    with pytest.raises(PresetError) as failure:
        engine.generate(REFERENCE, source)
    assert failure.value.code == "invalid_source_calibration"
    assert not (tmp_path / "budget.json").exists()


def test_baseline_is_safe_for_quiet_and_loud_sources():
    for rms, peak in [(-45, -40), (-24, -6), (-10, -1)]:
        source = SourceCalibration.model_validate({**SOURCE, "rms_dbfs": float(rms), "peak_dbfs": float(peak)}).model_dump()
        gain = baseline_gain(source)
        assert -24 <= gain <= 12
        assert peak + gain <= -6.0
