"""Offline transport checks; no credentials, network or GPU calls."""

import json
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4
import wave

from common import ARTIFACTS, job_path, reserve_attempt, validate_outputs, validate_source


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def make_outputs(self):
        for name in ARTIFACTS[:3]:
            with wave.open(str(self.root / name), "wb") as output:
                output.setparams((2, 2, 44100, 0, "NONE", "not compressed"))
                output.writeframes(bytes(44100 * 10 * 4))
        (self.root / "result.json").write_text(json.dumps({
            "model": "htdemucs_6s", "provider": "modal", "common_gain_linear": 0.9,
        }))

    def test_job_cannot_escape_volume_root(self):
        key = str(uuid4())
        self.assertEqual(job_path(self.root, key), self.root / key)
        for value in ("../outside", "a/b", key.upper(), ""):
            with self.assertRaises(ValueError):
                job_path(self.root, value)

    def test_attempts_are_durable_bounded_and_fail_closed(self):
        ledger = self.root / "attempts.json"
        for attempt in range(10):
            reserve_attempt(ledger)
            self.assertEqual(json.loads(ledger.read_text()), attempt + 1)
        with self.assertRaises(RuntimeError):
            reserve_attempt(ledger)
        for invalid in ("true", "-1", "1.5", "{}", "corrupt"):
            ledger.write_text(invalid)
            with self.assertRaises((ValueError, RuntimeError)):
                reserve_attempt(ledger)
            self.assertEqual(ledger.read_text(), invalid)

    def test_empty_missing_and_oversize_upload_rejected(self):
        path = self.root / "source.bin"
        with self.assertRaises(ValueError):
            validate_source(path)
        path.touch()
        with self.assertRaises(ValueError):
            validate_source(path)
        with path.open("wb") as output:
            output.truncate(50 * 1024 * 1024 + 1)
        with self.assertRaises(ValueError):
            validate_source(path)
        path.write_bytes(b"audio-decoder-validates-this-later")
        validate_source(path)

    def test_aligned_outputs_pass_but_truncation_fails(self):
        self.make_outputs()
        validate_outputs(self.root)
        path = self.root / "guitar.wav"
        path.write_bytes(path.read_bytes()[:-4])
        with self.assertRaises(ValueError):
            validate_outputs(self.root)

    def test_missing_provider_and_nonfinite_gain_fail(self):
        self.make_outputs()
        for report in ({"model": "htdemucs_6s", "common_gain_linear": 0.9},
                       {"model": "htdemucs_6s", "provider": "modal", "common_gain_linear": float("nan")}):
            (self.root / "result.json").write_text(json.dumps(report))
            with self.assertRaises(ValueError):
                validate_outputs(self.root)


if __name__ == "__main__":
    unittest.main()
