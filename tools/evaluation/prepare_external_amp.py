"""Align licensed DI03/amp03 using training audio only; preserve a held-out passage."""
from array import array
import audioop  # Python 3.12 evaluation environment; not part of the product runtime.
import hashlib
import json
import math
from pathlib import Path
import sys
import wave
from preset_eval import ROOT, prepare, write


def read(path):
    with wave.open(str(path)) as f:
        if f.getsampwidth() != 2 or f.getnchannels() not in (1, 2): raise ValueError("Use PCM16 mono/stereo")
        channels, rate, raw = f.getnchannels(), f.getframerate(), f.readframes(f.getnframes())
    values = array("h"); values.frombytes(raw)
    if sys.byteorder != "little": values.byteswap()
    choices = [values[i::channels] for i in range(channels)]; channel = max(range(channels), key=lambda i: math.sumprod(choices[i], choices[i]))
    selected = array("h", choices[channel]);
    if sys.byteorder != "little": selected.byteswap()
    data = audioop.ratecv(selected.tobytes(), 2, 1, rate, 44100, None)[0] if rate != 44100 else selected.tobytes()
    values = array("h"); values.frombytes(data)
    if sys.byteorder != "little": values.byteswap()
    return list(values), channel


def wav(path, samples):
    data = array("h", [max(-32768, min(32767, round(value))) for value in samples])
    if sys.byteorder != "little": data.byteswap()
    with wave.open(str(path), "wb") as f: f.setparams((1, 2, 44100, len(data), "NONE", "not compressed")); f.writeframes(data.tobytes())


if __name__ == "__main__":
    source_root = ROOT / "data/verification/online-di"; output = ROOT / "data/verification/external-rig-20261030"
    if output.exists(): raise ValueError("Preserve the existing independent experiment")
    dry, dry_channel = read(source_root / "guitar-techs-dry-di.wav"); amp, amp_channel = read(source_root / "original-micamp-03.wav")
    block = 44; train = 44100 * 15
    envelope = lambda values: [math.sqrt(math.sumprod(values[i:i+block], values[i:i+block]) / block) for i in range(0, min(train, len(values))-block+1, block)]
    a, b = envelope(dry), envelope(amp)
    def correlation(lag):
        start, end = max(0, -lag), min(len(a), len(b)-lag)
        x, y = a[start:end], b[start+lag:end+lag]; mx, my = sum(x)/len(x), sum(y)/len(y)
        x, y = [v-mx for v in x], [v-my for v in y]
        return math.sumprod(x, y) / max(1e-12, math.sqrt(math.sumprod(x,x)*math.sumprod(y,y)))
    lag = max(range(-100, 101), key=correlation); confidence = correlation(lag)
    if confidence < .2: raise ValueError("Alignment uncertain; do not label this paired")
    offset = lag * block; start, end = max(0, -offset), min(len(dry), len(amp)-offset)
    dry, amp = dry[start:end], amp[start+offset:end+offset]
    rms = math.sqrt(math.sumprod(amp[:train], amp[:train]) / len(amp[:train])) / 32768
    scale = 10 ** (-36/20) / rms; amp = [value * scale for value in amp]
    prepared = source_root / "external-aligned-dry.wav"; wav(prepared, dry)
    prepare(prepared, output)
    wav(output / "external-target.wav", amp[:train]); wav(output / "external-held-target.wav", amp[train:])
    config = json.loads((output / "config.json").read_text()); config["cases"] = [{"id": "external", "target_file": "external-target.wav", "held_target_file": "external-held-target.wav"}]
    config["render_targets_only"] = True; write(output / "config.json", config)
    metadata = {"source": "https://zenodo.org/records/14963133", "license": "CC BY 4.0", "dry_channel": dry_channel, "amp_channel": amp_channel,
                "amp_shift_samples": offset, "amp_shift_ms": offset/44.1, "training_envelope_correlation": confidence,
                "alignment_uses_training_only": True, "reference_gain_linear": scale, "reference_train_rms_dbfs": -36,
                "changes": "Stronger channels selected; amp resampled 48k to 44.1k; common aligned crop; amp gain from training applied unchanged to held-out; PCM16 mono."}
    write(output / "external-source.json", metadata)
    (output / "ATTRIBUTION.txt").write_text((source_root / "ATTRIBUTION.txt").read_text(encoding="utf-8") + "\nExternal paired target additionally uses P3_music/audio/micamp/micamp_03.wav. See external-source.json for alignment and gain changes.\n", encoding="utf-8")
    print(json.dumps(metadata), flush=True)
