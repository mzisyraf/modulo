"""Offline passage selection from an already-separated guitar stem and aligned mix."""

import argparse
from array import array
import json
import math
from pathlib import Path
import sys
import wave


def _read_levels(path: Path) -> tuple[int, int, list[tuple[float, float]]]:
    with path.open("rb") as source:
        if source.seek(0, 2) > 50 * 1024 * 1024:
            raise ValueError("Each WAV must be at most 50 MB.")
        source.seek(0)
        with wave.open(source, "rb") as audio:
            rate, frames, channels = audio.getframerate(), audio.getnframes(), audio.getnchannels()
            if audio.getsampwidth() != 2 or audio.getcomptype() != "NONE" or channels not in (1, 2):
                raise ValueError("Use uncompressed 16-bit PCM mono or stereo WAVs.")
            if not 8000 <= rate <= 192000 or not rate * 10 <= frames <= rate * 300:
                raise ValueError("Use WAVs lasting 10–300 seconds at 8–192 kHz.")
            levels = []
            for start in range(0, frames, rate):
                count = min(rate, frames - start)
                data = audio.readframes(count)
                if len(data) != count * channels * 2:
                    raise ValueError("WAV sample data is truncated.")
                samples = array("h")
                samples.frombytes(data)
                if sys.byteorder != "little":
                    samples.byteswap()
                # Channel energies avoid cancelling opposite-polarity stereo signals.
                energy = sum(value * value for value in samples) / len(samples) / 32768**2
                clipped = sum(abs(value) >= 32760 for value in samples) / len(samples)
                levels.append((energy, clipped))
    return rate, frames, levels


def select_reference(
    guitar_path: Path, mixture_path: Path, *,
    start_seconds: int | None = None, end_seconds: int | None = None,
) -> dict:
    """Select automatically or check a manual 10–20s interval in time-aligned WAVs."""
    manual = start_seconds is not None or end_seconds is not None
    if manual and (type(start_seconds) is not int or type(end_seconds) is not int):
        raise ValueError("Supply both start_seconds and end_seconds as whole seconds.")
    rate, frames, guitar = _read_levels(guitar_path)
    mix_rate, mix_frames, mixture = _read_levels(mixture_path)
    if (rate, frames) != (mix_rate, mix_frames):
        raise ValueError("Guitar and mix must have the same sample rate and frame count.")
    seconds = frames // rate
    length = min(15, seconds)
    starts = range(seconds - length + 1)
    if manual:
        if not 0 <= start_seconds < end_seconds <= seconds or not 10 <= end_seconds - start_seconds <= 20:
            raise ValueError("Manual passage must be 10–20 seconds long and within the audio's whole seconds.")
        length = end_seconds - start_seconds
        starts = [start_seconds]
    best = None
    # shortcut: energy dominance is not a bleed detector; calibrate on real separated clips before release.
    for start in starts:
        window = guitar[start:start + length]
        energy = sum(item[0] for item in window) / length
        silence = sum(item[0] < 1e-5 for item in window) / length
        clipped = sum(item[1] for item in window) / length
        if energy < 1e-5 or silence > 0.2 or clipped >= 0.01:
            continue
        mix_energy = sum(item[0] for item in mixture[start:start + length]) / length
        if mix_energy < 1e-5:
            continue
        ratio = energy / mix_energy
        score = math.sqrt(energy * min(ratio, 1)) * (1 - silence) * (1 - clipped * 100)
        if best is None or score > best[0]:
            best = (score, start, energy, ratio, silence, clipped)
    if best is None:
        raise ValueError("No usable passage: audio is too quiet, sparse or clipped; choose another passage or stem.")
    _, start, energy, ratio, silence, clipped = best
    flags = ["manual_selection" if manual else "heuristic_selection", "separation_quality_unverified"]
    if ratio < 0.1:
        flags.append("weak_guitar_energy")
    if ratio > 1:
        flags.append("stem_energy_exceeds_mix")
    if silence > 0:
        flags.append("contains_quiet_seconds")
    if clipped > 0:
        flags.append("contains_clipping")
    return {
        "method": "manual_interval_v1" if manual else "energy_dominance_v1",
        "start_seconds": start,
        "end_seconds": start + length,
        "quality_flags": flags,
        "metrics": {
            "guitar_rms_dbfs": 10 * math.log10(energy),
            "stem_to_mix_energy_ratio": ratio,
            "quiet_second_fraction": silence,
            "clipped_sample_fraction": clipped,
        },
        "explanation": (
            "Checked the requested interval for energy, quiet seconds and clipping. " if manual else
            "Ranked guitar energy and stem/mix energy ratio, penalizing quiet seconds and clipping. "
        ) + "These checks do not establish guitar presence, separation quality or tone similarity.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("guitar", type=Path, help="Already-isolated guitar, 16-bit PCM WAV")
    parser.add_argument("mixture", type=Path, help="Time-aligned original mix, 16-bit PCM WAV")
    parser.add_argument("--start-seconds", type=int, help="Manual interval start (whole seconds; requires --end-seconds)")
    parser.add_argument("--end-seconds", type=int, help="Manual interval end (whole seconds; requires --start-seconds)")
    args = parser.parse_args()
    try:
        result = select_reference(
            args.guitar, args.mixture, start_seconds=args.start_seconds, end_seconds=args.end_seconds,
        )
    except (OSError, ValueError, wave.Error, EOFError) as failure:
        parser.exit(2, f"Reference selection failed: {failure}\n")
    print(json.dumps(result, allow_nan=False, indent=2))


if __name__ == "__main__":
    main()
