"""Offline passage selection from an already-separated guitar stem and aligned mix."""

import argparse
from array import array
import json
import math
from pathlib import Path
import sys
import wave


def _read_levels(path: Path, *, details=False, describe=True):
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
            levels, features, peaks = [], [], []
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
                squares = math.sumprod(samples, samples)
                energy = squares / len(samples) / 32768**2
                clipped = sum(abs(value) >= 32760 for value in samples) / len(samples)
                levels.append((energy, clipped))
                if details:
                    if describe:
                        difference = max(0, 2 * squares - math.sumprod(samples[:channels], samples[:channels])
                                         - math.sumprod(samples[-channels:], samples[-channels:])
                                         - 2 * math.sumprod(samples[channels:], samples[:-channels]))
                        brightness = math.sqrt(difference / max(1, squares)) * rate / (2 * math.pi)
                    block_size = max(channels, rate // 20 * channels)
                    envelopes = []
                    for offset in range(0, len(samples), block_size):
                        block = samples[offset:offset + block_size]
                        peak = max(abs(min(block)), abs(max(block))) / 32768
                        peaks.append(peak)
                        if describe:
                            envelopes.append(math.sqrt(math.sumprod(block, block) / len(block)) / 32768)
                    if describe:
                        mean = sum(envelopes) / len(envelopes)
                        variation = math.sqrt(sum((value - mean) ** 2 for value in envelopes) / len(envelopes)) / max(mean, 1e-8)
                        crest = max(peaks[-len(envelopes):]) / max(math.sqrt(energy), 1e-8)
                        features.append((brightness, variation, crest))
    if details:
        # Keep a fixed, small response; peaks preserve polarity-independent stereo activity.
        bar_count = min(400, len(peaks))
        bars = [round(max(peaks[i * len(peaks) // bar_count:(i + 1) * len(peaks) // bar_count]), 4) for i in range(bar_count)]
        return rate, frames, levels, features, bars
    return rate, frames, levels


def reference_options(guitar_path: Path, mixture_path: Path) -> dict:
    """Return bounded waveform peaks and up to three contrasting usable passages."""
    rate, frames, guitar, features, guitar_peaks = _read_levels(guitar_path, details=True)
    mix_rate, mix_frames, mixture, _, mix_peaks = _read_levels(mixture_path, details=True, describe=False)
    if (rate, frames) != (mix_rate, mix_frames):
        raise ValueError("Guitar and mix must have the same sample rate and frame count.")
    length = min(15, frames // rate)
    candidates = []
    for start in range(frames // rate - length + 1):
        window = guitar[start:start + length]
        energy = sum(item[0] for item in window) / length
        quiet = sum(item[0] < 1e-5 for item in window) / length
        clipped = sum(item[1] for item in window) / length
        mix_energy = sum(item[0] for item in mixture[start:start + length]) / length
        if energy < 1e-5 or quiet > 0.2 or clipped >= 0.01 or mix_energy < 1e-5:
            continue
        active = [features[i] for i in range(start, start + length) if guitar[i][0] >= 1e-5]
        logs = [math.log2(max(item[0], 1)) for item in active]
        # Avoid calling a transition between two textures a third stable texture.
        if max(logs) - min(logs) > 1:
            continue
        vector = (sum(logs) / len(logs), sum(item[1] for item in active) / len(active),
                  sum(math.log2(max(item[2], 1)) for item in active) / len(active))
        score = math.sqrt(energy * min(energy / mix_energy, 1)) * (1 - quiet) * (1 - clipped * 100)
        candidates.append((score, start, vector))
    selected = []
    if candidates:
        selected.append(max(candidates, key=lambda item: item[0]))
        while len(selected) < 3:
            remaining = [item for item in candidates if all(abs(item[1] - other[1]) >= length for other in selected)]
            if not remaining:
                break
            def contrast(item):
                return min(max(abs(item[2][0] - other[2][0]), abs(item[2][1] - other[2][1]) / 0.35,
                               abs(item[2][2] - other[2][2]) / 0.7) for other in selected)
            best = max(remaining, key=lambda item: (contrast(item), item[0]))
            # shortcut: contrast thresholds are signal heuristics; calibrate with listening evidence before quality claims.
            if contrast(best) < 1:
                break
            selected.append(best)
    options = []
    for index, (_, start, vector) in enumerate(selected):
        baseline = selected[0][2]
        label = "Suggested starting passage" if index == 0 else (
            "Brighter texture" if vector[0] > baseline[0] + 0.8 else
            "Darker texture" if vector[0] < baseline[0] - 0.8 else
            "More varied dynamics" if vector[1] > baseline[1] + 0.25 else
            "Steadier dynamics" if vector[1] < baseline[1] - 0.25 else "Contrasting attack pattern")
        options.append({"start_seconds": start, "end_seconds": start + length, "label": label,
                        "quality_flags": ["heuristic_selection", "separation_quality_unverified", "tone_difference_unverified"],
                        "explanation": "Compared signal brightness and dynamics. Pitch, technique and bleed can affect these; guitar/configuration identity is unverified."})
    return {"method": "signal_contrast_v1", "duration_seconds": frames / rate, "options": options,
            "waveforms": {"mix": mix_peaks, "guitar": guitar_peaks}}


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
