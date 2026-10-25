# Offline reference-selection prototype

The first issue #2 implementation selects a passage from an **already-isolated guitar stem** and its time-aligned original mix. It does not separate a mixed song, identify guitar presence or generate a preset. The browser/API analysis path still returns HTTP 501. There is no worker, upload endpoint, provider call, new dependency or cloud cost.

From `services/api`, using the existing virtual environment:

```powershell
.\.venv\Scripts\python.exe -m app.reference 'C:\path\guitar.wav' 'C:\path\mix.wav'
.\.venv\Scripts\python.exe -m app.reference 'C:\path\guitar.wav' 'C:\path\mix.wav' --start-seconds 20 --end-seconds 35
.\.venv\Scripts\python.exe -m pytest
```

Supply rights-cleared files exported as uncompressed 16-bit PCM WAV, mono or stereo, 8–192 kHz, 10–300 seconds and at most 50 MiB each. Files must have identical sample rates/frame counts and be time-aligned, without independent normalization. Mono/stereo channel counts may differ. A matching header cannot establish alignment; the separator/export pipeline must preserve it. The CLI reads locally and prints JSON; it never writes audio or uploads it. Bad/unsupported/truncated files and unusable passages exit with status 2 and an explanation.

## Method and limits

`app.reference.select_reference(Path(guitar), Path(mix))` scans whole-second windows with a one-second step. Window length is 15 seconds, or the whole number of available seconds for 10–14.999 second files. Any fractional trailing second is validated but excluded from scoring. Equal scores choose the earliest window.

To check another passage, supply both `--start-seconds` and `--end-seconds`, or the Python keyword arguments `start_seconds` and `end_seconds`. Bounds must be whole seconds within the audio, with a length of 10–20 seconds. Manual selection checks only that interval using the same input and quality rules; an unusable interval fails rather than silently selecting another passage. Results use `method: "manual_interval_v1"` and `manual_selection` instead of the automatic method/flag, retaining `separation_quality_unverified`. This override is local CLI/Python functionality; browser audition and passage controls remain unimplemented.

Per-channel squared samples are averaged to preserve stereo energy without polarity cancellation. Candidates must have mean guitar and mix energy at least −50 dBFS, at most 20% quiet one-second bins (below −50 dBFS), and less than 1% clipped guitar samples (absolute PCM value at least 32760). Eligible windows are ranked by:

```text
guitar_rms * sqrt(min(guitar_energy / mix_energy, 1))
    * (1 - quiet_second_fraction) * (1 - 100 * clipped_sample_fraction)
```

The result supplies time bounds, RMS, stem/mix energy ratio, quiet/clipped fractions, a method version and an explanation. Every automatic result includes `heuristic_selection` and `separation_quality_unverified`. Other flags expose weak stem energy (ratio below 0.1), stem energy exceeding the mix, quiet seconds and any clipping. There is no calibrated confidence score. Silence/sparsity/heavy clipping fails explicitly rather than yielding a default interval.

Energy ratio is a rough dominance proxy, **not a bleed detector**: drums/vocals in a bad stem can score highly. Destructive interference and independently normalized exports can also produce misleading ratios. Tone stability, spectral features and perceptual similarity are not measured yet. The thresholds and ranking need calibration on real separator outputs before this becomes user-facing.

## Evidence and next experiment

Synthetic unit/CLI tests establish automatic/manual interval bounds, activity/dominance ranking, stereo handling, rejection of malformed/oversized/short/misaligned inputs, manual quality rejection without fallback and honest error output. They do not establish separation quality or musical usefulness.

No rights-cleared benchmark audio or approved Nebius spending cap was available for this pass; the user requested offline work. No authenticated model inventory/inference or separation benchmark has run. Do not mark issues #2 or #3 complete.

[Demucs upstream](https://github.com/facebookresearch/demucs/blob/main/README.md) was checked on 24 October 2026: the repository is archived, and the six-source model is experimental with a guitar source. That is documentation evidence only, not evidence it works for modulo's audio. Do not substitute the ordinary four-source `other` stem for guitar.

Next: obtain three rights-cleared clean/distorted/dense mixed clips and an approved cloud cap; run the guitar-capable separator in a separately pinned environment. Record exact model/version, hardware, elapsed time, exports, listening notes and failures; run this selector against aligned PCM16 exports and audition its intervals. Separately verify the account's exact NVIDIA model ID with an authenticated Nebius call, preserving sanitized evidence and server-side credentials. Only then connect a bounded asynchronous job path and agree its fixtures with Shazlin.
