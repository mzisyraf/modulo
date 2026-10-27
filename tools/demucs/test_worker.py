"""CPU decoder/locking regressions; no weights, CUDA inference or music required."""

from contextlib import redirect_stderr
from io import StringIO
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import soundfile as sf

import worker

os.environ["PATH"] = str(Path(sys.prefix) / "Library" / "bin") + os.pathsep + os.environ.get("PATH", "")


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.source = self.directory / "source.bin"

    def tearDown(self):
        self.temp.cleanup()

    def make_wav(self, seconds=10, channels=1, silent=False):
        t = np.arange(44100 * seconds) / 44100
        signal = np.zeros(len(t)) if silent else 0.1 * np.sin(2 * np.pi * 110 * t)
        sf.write(self.source, np.tile(signal[:, None], (1, channels)), 44100, format="WAV", subtype="PCM_16")

    def test_decodes_mono_to_finite_stereo_without_normalizing(self):
        self.make_wav()
        audio = worker.decode(self.source)
        self.assertEqual(audio.shape, (441000, 2))
        self.assertTrue(np.isfinite(audio).all())
        self.assertLess(float(np.max(np.abs(audio))), 0.101)
        np.testing.assert_array_equal(audio[:, 0], audio[:, 1])

    def test_rejects_short_silent_multichannel_and_corrupt(self):
        for settings in ({"seconds": 9}, {"silent": True}, {"channels": 3}):
            with self.subTest(settings=settings):
                self.make_wav(**settings)
                with self.assertRaises(ValueError):
                    worker.decode(self.source)
        self.source.write_bytes(b"not an audio recording")
        with self.assertRaises(worker.subprocess.CalledProcessError):
            worker.decode(self.source)

    def test_decode_timeout_is_finite(self):
        with patch.object(worker.subprocess, "run", side_effect=worker.subprocess.TimeoutExpired("ffprobe", 20)):
            with self.assertRaises(worker.subprocess.TimeoutExpired):
                worker.decode(self.source)

    def test_no_cpu_fallback(self):
        import torch
        with patch.object(torch.cuda, "is_available", return_value=False):
            with self.assertRaises(worker.SeparatorUnavailable):
                worker.separate(self.directory, np.zeros((441000, 2), dtype=np.float32))

    def test_gpu_lock_and_environment_failures_have_distinct_exit_codes(self):
        with patch.object(sys, "argv", ["worker.py", str(self.directory)]), patch.object(worker, "decode", return_value=None), redirect_stderr(StringIO()):
            with worker.exclusive_lock(self.directory.parent / ".gpu.lock"):
                self.assertEqual(worker.main(), 4)
            with patch.object(worker, "separate", side_effect=worker.SeparatorUnavailable("CUDA missing")):
                self.assertEqual(worker.main(), 3)
            with patch.object(worker.shutil, "which", return_value=None):
                self.assertEqual(worker.main(), 3)


if __name__ == "__main__":
    unittest.main()
