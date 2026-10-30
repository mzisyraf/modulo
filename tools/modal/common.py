"""Small trust boundary shared by the private Modal worker and its CLI client."""

from pathlib import Path
from uuid import UUID
import json
import math
import wave

APP_NAME = "modulo-demucs"
VOLUME_NAME = "modulo-demucs-jobs"
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_ARTIFACT_BYTES = 53 * 1024 * 1024
ARTIFACTS = ("mix.wav", "guitar.wav", "backing.wav", "result.json")


def reserve_attempt(ledger):
    attempts = json.loads(ledger.read_text()) if ledger.exists() else 0
    if type(attempts) is not int or attempts < 0:
        raise RuntimeError("Invalid separation usage ledger; preserve it and repair before retrying.")
    temporary = ledger.with_suffix(".tmp")
    temporary.write_text(json.dumps(attempts + 1))
    temporary.replace(ledger)


def job_path(root, job_id):
    if str(UUID(job_id)) != job_id:
        raise ValueError("Use a canonical job UUID.")
    path = Path(root) / job_id
    if path.is_symlink():
        raise ValueError("Job directories cannot be symbolic links.")
    return path


def validate_source(path):
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= MAX_UPLOAD_BYTES:
        raise ValueError("Upload a nonempty WAV/MP3 file no larger than 50 MiB.")


def validate_outputs(directory):
    formats = []
    for name in ARTIFACTS[:3]:
        with wave.open(str(directory / name), "rb") as audio:
            frames, rate, channels, width = (audio.getnframes(), audio.getframerate(),
                                              audio.getnchannels(), audio.getsampwidth())
            if (audio.getcomptype() != "NONE" or (rate, channels, width) != (44100, 2, 2)
                    or not 10 <= frames / rate <= 295
                    or len(audio.readframes(frames)) != frames * channels * width):
                raise ValueError("Invalid or truncated separated WAV.")
            formats.append((frames, rate, channels, width))
    if len(set(formats)) != 1:
        raise ValueError("Separated outputs are not aligned.")
    report = json.loads((directory / "result.json").read_text())
    gain = report.get("common_gain_linear")
    if (report.get("model") != "htdemucs_6s" or report.get("provider") != "modal"
            or type(gain) not in (int, float) or not math.isfinite(gain) or not 0 < gain <= 1):
        raise ValueError("Invalid separated-audio provenance.")
