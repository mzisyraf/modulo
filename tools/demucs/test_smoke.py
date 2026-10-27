"""Failure regressions use generated WAVs and mock the model/GPU; no downloads."""

from contextlib import ExitStack, redirect_stderr, redirect_stdout
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import soundfile as sf

import smoke


STEMS = ("drums", "bass", "other", "vocals", "guitar", "piano")
ARTIFACTS = Path(__file__).resolve().parents[2] / "artifacts"


def write_stems(directory, frames=32):
    directory.mkdir(parents=True, exist_ok=True)
    for stem in STEMS:
        sf.write(directory / f"{stem}.wav", np.zeros((frames, 2)), 44100, subtype="PCM_16")


class StemValidationTests(unittest.TestCase):
    def setUp(self):
        ARTIFACTS.mkdir(exist_ok=True)
        temporary = tempfile.TemporaryDirectory(prefix="demucs-unit-", dir=ARTIFACTS)
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        write_stems(self.directory)

    def test_accepts_complete_aligned_pcm16_stems(self):
        result = smoke.validate_stems(self.directory, 32, 44100)
        self.assertEqual(set(result), set(STEMS))
        self.assertEqual(result["guitar"]["peak"], 0)

    def test_rejects_missing_guitar(self):
        (self.directory / "guitar.wav").unlink()
        with self.assertRaises(RuntimeError):
            smoke.validate_stems(self.directory, 32, 44100)

    def test_rejects_corrupt_wav(self):
        (self.directory / "guitar.wav").write_text("not a WAV")
        with self.assertRaises(RuntimeError):
            smoke.validate_stems(self.directory, 32, 44100)

    def test_rejects_wrong_rate_length_channels_and_encoding(self):
        cases = [(32, 2, 8000, "PCM_16", "sample rate"),
                 (31, 2, 44100, "PCM_16", "length/channels"),
                 (0, 2, 44100, "PCM_16", "length/channels"),
                 (32, 1, 44100, "PCM_16", "length/channels"),
                 (32, 2, 44100, "FLOAT", "PCM format")]
        for frames, channels, rate, subtype, message in cases:
            with self.subTest(frames=frames, channels=channels, rate=rate, subtype=subtype):
                sf.write(self.directory / "guitar.wav", np.zeros((frames, channels)), rate, subtype=subtype)
                with self.assertRaisesRegex(ValueError, message):
                    smoke.validate_stems(self.directory, 32, 44100)

    def test_rejects_nonfinite_decoded_samples(self):
        for bad in (np.nan, np.inf):
            with self.subTest(value=bad), patch.object(smoke.sf, "read", return_value=(np.full((32, 2), bad), 44100)):
                with self.assertRaisesRegex(ValueError, "Non-finite"):
                    smoke.validate_stems(self.directory, 32, 44100)


class SmokeLifecycleTests(unittest.TestCase):
    def setUp(self):
        ARTIFACTS.mkdir(exist_ok=True)
        temporary = tempfile.TemporaryDirectory(prefix="demucs-unit-", dir=ARTIFACTS)
        self.addCleanup(temporary.cleanup)
        self.run = Path(temporary.name)
        stack = ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(redirect_stdout(io.StringIO()))
        stack.enter_context(redirect_stderr(io.StringIO()))
        stack.enter_context(patch.object(smoke.shutil, "which", return_value="ffmpeg"))
        stack.enter_context(patch.object(smoke.tempfile, "mkdtemp", return_value=str(self.run)))
        stack.enter_context(patch("torch.cuda.is_available", return_value=True))
        stack.enter_context(patch("torch.cuda.get_device_name", return_value="Synthetic unit-test GPU"))
        stack.enter_context(patch.object(smoke.subprocess, "check_output", return_value="ffmpeg unit-test\n"))
        self.process = stack.enter_context(patch.object(smoke.subprocess, "run", side_effect=AssertionError("Unexpected model invocation")))

    def test_missing_ffmpeg_fails_before_model_execution(self):
        with patch.object(smoke.shutil, "which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "FFmpeg"):
                smoke.main()
        self.process.assert_not_called()
        self.assertFalse((self.run / "result.json").exists())

    def test_missing_cuda_fails_without_cpu_fallback(self):
        with patch("torch.cuda.is_available", return_value=False):
            with self.assertRaisesRegex(RuntimeError, "CUDA"):
                smoke.main()
        self.process.assert_not_called()
        self.assertFalse((self.run / "result.json").exists())

    def test_failed_and_timed_out_model_runs_never_report_success(self):
        for error in (subprocess.CalledProcessError(1, "demucs"), subprocess.TimeoutExpired("demucs", 600)):
            with self.subTest(error=type(error).__name__):
                self.process.side_effect = error
                with self.assertRaises(type(error)):
                    smoke.main()
                self.assertTrue((self.run / "demucs.log").exists())
                self.assertFalse((self.run / "result.json").exists())

    def test_zero_exit_with_missing_outputs_never_reports_success(self):
        self.process.side_effect = None
        self.process.return_value = subprocess.CompletedProcess(["demucs"], 0)
        with self.assertRaises(RuntimeError):
            smoke.main()
        self.assertFalse((self.run / "result.json").exists())

    def test_success_report_is_labelled_synthetic(self):
        def separate(*args, **kwargs):
            write_stems(self.run / "separated" / "htdemucs_6s" / "synthetic", 44100 * 12)
        self.process.side_effect = separate
        smoke.main()
        result = json.loads((self.run / "result.json").read_text())
        self.assertEqual(result["status"], "passed")
        self.assertIn("not_a_guitar_quality_benchmark", result["input_kind"])
        self.assertEqual(result["device"], "Synthetic unit-test GPU")
        self.assertEqual(set(result["stems"]), set(STEMS))


if __name__ == "__main__":
    unittest.main()
