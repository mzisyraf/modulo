from array import array
import json
import math
import struct
import subprocess
import sys
import wave

import pytest

from app.reference import select_reference


def write_wav(path, amplitudes, *, channels=1, rate=8000, width=2, tail_frames=0):
    """Synthetic tones only: no recorded music or separation-quality evidence."""
    with wave.open(str(path), "wb") as audio:
        audio.setparams((channels, width, rate, 0, "NONE", "not compressed"))
        for amplitude in amplitudes:
            samples = array("h")
            for index in range(rate):
                value = int(amplitude * 32767 * math.sin(2 * math.pi * 200 * index / rate))
                samples.extend([value, -value] if channels == 2 else [value] * channels)
            if sys.byteorder != "little":
                samples.byteswap()
            audio.writeframes(samples.tobytes())
        audio.writeframes(bytes(tail_frames * channels * width))
    return path


def test_selects_active_guitar_after_silence_without_stereo_cancellation(tmp_path):
    guitar = write_wav(tmp_path / "guitar.wav", [0] * 15 + [0.2] * 15, channels=2)
    mix = write_wav(tmp_path / "mix.wav", [0.6] * 30)
    result = select_reference(guitar, mix)
    assert (result["start_seconds"], result["end_seconds"]) == (15, 30)
    assert result["metrics"]["guitar_rms_dbfs"] == pytest.approx(-17, abs=0.1)
    assert "separation_quality_unverified" in result["quality_flags"]
    json.dumps(result, allow_nan=False)


def test_prefers_dominant_guitar_over_louder_low_ratio_passage(tmp_path):
    guitar = write_wav(tmp_path / "guitar.wav", [0.3] * 15 + [0.2] * 15)
    mix = write_wav(tmp_path / "mix.wav", [0.9] * 15 + [0.25] * 15)
    assert select_reference(guitar, mix)["start_seconds"] == 15


@pytest.mark.parametrize("start,end", [(0, 10), (5, 20), (10, 30)])
def test_manual_interval_preserves_requested_bounds_and_provenance(tmp_path, start, end):
    audio = write_wav(tmp_path / "guitar.wav", [0.2] * 15 + [0.4] * 15)
    assert select_reference(audio, audio)["start_seconds"] == 15
    result = select_reference(audio, audio, start_seconds=start, end_seconds=end)
    assert (result["start_seconds"], result["end_seconds"]) == (start, end)
    assert result["method"] == "manual_interval_v1"
    assert result["quality_flags"] == ["manual_selection", "separation_quality_unverified"]
    assert "requested interval" in result["explanation"]
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize("start,end", [
    (None, 10), (0, None), (True, 10), (0, False), (0.5, 11), (0, 10.5), ("0", 10),
    (-1, 10), (5, 5), (10, 0), (0, 9), (0, 21), (21, 31),
])
def test_rejects_invalid_manual_intervals(tmp_path, start, end):
    audio = write_wav(tmp_path / "guitar.wav", [0.2] * 30)
    with pytest.raises(ValueError, match="whole seconds|Manual passage"):
        select_reference(audio, audio, start_seconds=start, end_seconds=end)


@pytest.mark.parametrize("problem,amplitudes", [
    ("quiet", [0] * 15), ("sparse", [0] * 6 + [0.2] * 9),
    ("clipped", [0.2] * 15), ("silent_mix", [0.2] * 15),
])
def test_unusable_manual_interval_does_not_fall_back_to_automatic(tmp_path, problem, amplitudes):
    guitar = write_wav(tmp_path / "guitar.wav", amplitudes + [0.2] * 15)
    mix = write_wav(tmp_path / "mix.wav", ([0] * 15 if problem == "silent_mix" else [0.4] * 15) + [0.4] * 15)
    if problem == "clipped":
        data = bytearray(guitar.read_bytes())
        data[44:44 + 15 * 8000 * 2] = b"\xff\x7f" * 15 * 8000
        guitar.write_bytes(data)
    assert select_reference(guitar, mix)["start_seconds"] > 0
    with pytest.raises(ValueError, match="No usable passage"):
        select_reference(guitar, mix, start_seconds=0, end_seconds=15)


@pytest.mark.parametrize("duration,tail", [(10, 0), (14, 4000), (15, 0)])
def test_short_valid_clips_stay_in_range_and_ties_choose_earliest(tmp_path, duration, tail):
    guitar = write_wav(tmp_path / "guitar.wav", [0.2] * duration, tail_frames=tail)
    result = select_reference(guitar, guitar)
    assert result["start_seconds"] == 0
    assert result["end_seconds"] == duration


@pytest.mark.parametrize("amplitude", [0, 0.001])
def test_rejects_silence_and_near_silence(tmp_path, amplitude):
    audio = write_wav(tmp_path / "quiet.wav", [amplitude] * 15)
    with pytest.raises(ValueError, match="No usable passage"):
        select_reference(audio, audio)


def test_rejects_sparse_passage_and_silent_mix(tmp_path):
    sparse = write_wav(tmp_path / "sparse.wav", [0] * 6 + [0.2] * 9)
    active = write_wav(tmp_path / "active.wav", [0.2] * 15)
    silent = write_wav(tmp_path / "silent.wav", [0] * 15)
    for guitar, mix in [(sparse, active), (active, silent)]:
        with pytest.raises(ValueError, match="No usable passage"):
            select_reference(guitar, mix)


def test_rejects_heavy_clipping(tmp_path):
    clipped = tmp_path / "clipped.wav"
    with wave.open(str(clipped), "wb") as audio:
        audio.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
        audio.writeframes(b"\xff\x7f" * 8000 * 15)
    with pytest.raises(ValueError, match="No usable passage"):
        select_reference(clipped, clipped)


def test_quality_flags_do_not_claim_confidence(tmp_path):
    weak = write_wav(tmp_path / "weak.wav", [0.02] * 15)
    loud = write_wav(tmp_path / "loud.wav", [0.8] * 15)
    assert "weak_guitar_energy" in select_reference(weak, loud)["quality_flags"]
    result = select_reference(loud, weak)
    assert "stem_energy_exceeds_mix" in result["quality_flags"]
    assert "confidence" not in result


@pytest.mark.parametrize("rate,duration", [(16000, 15), (8000, 16)])
def test_rejects_misaligned_audio(tmp_path, rate, duration):
    guitar = write_wav(tmp_path / "guitar.wav", [0.2] * 15)
    mix = write_wav(tmp_path / "mix.wav", [0.2] * duration, rate=rate)
    with pytest.raises(ValueError, match="same sample rate and frame count"):
        select_reference(guitar, mix)


@pytest.mark.parametrize("channels,width,rate,frames,message", [
    (3, 2, 8000, 80000, "16-bit PCM"),
    (1, 1, 8000, 80000, "16-bit PCM"),
    (1, 2, 4000, 40000, "10–300 seconds"),
    (1, 2, 8000, 79999, "10–300 seconds"),
    (1, 2, 8000, 2400001, "10–300 seconds"),
    (1, 2, 8000, 80000, "truncated"),
])
def test_validates_headers_before_processing(tmp_path, channels, width, rate, frames, message):
    path = tmp_path / "bad.wav"
    with wave.open(str(path), "wb") as audio:
        audio.setparams((channels, width, rate, frames, "NONE", "not compressed"))
        audio.writeframesraw(b"")
    header = bytearray(path.read_bytes())
    struct.pack_into("<I", header, 4, 36 + frames * channels * width)
    struct.pack_into("<I", header, 40, frames * channels * width)
    path.write_bytes(header)
    with pytest.raises(ValueError, match=message):
        select_reference(path, path)


def test_rejects_large_file_before_decode(tmp_path):
    path = tmp_path / "large.wav"
    with path.open("wb") as audio:
        audio.truncate(50 * 1024 * 1024 + 1)
    with pytest.raises(ValueError, match="50 MB"):
        select_reference(path, path)


def test_cli_outputs_json_and_invalid_input_has_no_traceback(tmp_path):
    audio = write_wav(tmp_path / "synthetic.wav", [0.2] * 10)
    valid = subprocess.run(
        [sys.executable, "-m", "app.reference", str(audio), str(audio)],
        capture_output=True, text=True, check=True,
    )
    assert json.loads(valid.stdout)["end_seconds"] == 10
    invalid = tmp_path / "invalid.wav"
    invalid.write_bytes(b"not audio")
    failure = subprocess.run(
        [sys.executable, "-m", "app.reference", str(invalid), str(audio)],
        capture_output=True, text=True,
    )
    assert failure.returncode == 2
    assert "Reference selection failed" in failure.stderr
    assert "Traceback" not in failure.stderr
    assert not failure.stdout


def test_cli_manual_interval_and_missing_bound(tmp_path):
    audio = write_wav(tmp_path / "synthetic.wav", [0.2] * 30)
    command = [sys.executable, "-m", "app.reference", str(audio), str(audio), "--start-seconds", "10"]
    valid = subprocess.run(command + ["--end-seconds", "30"], capture_output=True, text=True, check=True)
    result = json.loads(valid.stdout)
    assert (result["start_seconds"], result["end_seconds"], result["method"]) == (10, 30, "manual_interval_v1")
    failure = subprocess.run(command, capture_output=True, text=True)
    assert failure.returncode == 2
    assert "Supply both" in failure.stderr
    assert "Traceback" not in failure.stderr
    assert not failure.stdout
