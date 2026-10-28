from array import array
import json
import math
import wave

import pytest

from app.reference import reference_options


def tones(path, sections, channels=1):
    with wave.open(str(path), "wb") as audio:
        audio.setparams((channels, 2, 8000, 0, "NONE", "not compressed"))
        for seconds, frequency, amplitude in sections:
            second = array("h")
            for i in range(8000):
                value = int(amplitude * 32767 * math.sin(i * 2 * math.pi * frequency / 8000))
                second.extend([value, -value] if channels == 2 else [value])
            for _ in range(seconds):
                audio.writeframes(second.tobytes())
    return path


def test_contrasting_sections_yield_bounded_nonoverlapping_options(tmp_path):
    guitar = tones(tmp_path / "guitar.wav", [(20, 120, .2), (20, 600, .2), (20, 2400, .2)], channels=2)
    result = reference_options(guitar, guitar)
    assert len(result["options"]) == 3
    windows = sorted((item["start_seconds"], item["end_seconds"]) for item in result["options"])
    assert all(10 <= end - start <= 20 and 0 <= start < end <= 60 for start, end in windows)
    assert all(a[1] <= b[0] for a, b in zip(windows, windows[1:]))
    assert all("tone_difference_unverified" in item["quality_flags"] for item in result["options"])
    assert all("identity is unverified" in item["explanation"] for item in result["options"])
    assert len(result["waveforms"]["guitar"]) <= 400
    assert max(result["waveforms"]["guitar"]) > .19  # Opposite-polarity stereo does not cancel.
    assert all(0 <= peak <= 1 for peaks in result["waveforms"].values() for peak in peaks)
    json.dumps(result, allow_nan=False)


def test_loudness_alone_does_not_manufacture_different_tones(tmp_path):
    guitar = tones(tmp_path / "same.wav", [(20, 220, .1), (20, 220, .2), (20, 220, .4)])
    assert len(reference_options(guitar, guitar)["options"]) == 1


def test_silence_yields_waveform_without_fabricated_suggestions(tmp_path):
    guitar = tones(tmp_path / "quiet.wav", [(15, 220, 0)])
    result = reference_options(guitar, guitar)
    assert result["options"] == []
    assert not any(result["waveforms"]["guitar"])


def test_short_clip_and_mismatched_alignment(tmp_path):
    guitar = tones(tmp_path / "short.wav", [(10, 220, .2)])
    result = reference_options(guitar, guitar)
    assert [(item["start_seconds"], item["end_seconds"]) for item in result["options"]] == [(0, 10)]
    mixture = tones(tmp_path / "other.wav", [(11, 220, .2)])
    with pytest.raises(ValueError, match="same sample rate and frame count"):
        reference_options(guitar, mixture)
