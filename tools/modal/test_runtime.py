"""Regressions for startup and cancellation; never contact Modal."""

import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import client


class RuntimeTests(unittest.TestCase):
    def test_remote_import_does_not_resolve_deployer_paths(self):
        spec = importlib.util.spec_from_file_location("modal_runtime_check", Path(__file__).with_name("app.py"))
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        try:
            with patch("modal.is_local", return_value=False), patch("pathlib.Path.resolve", side_effect=AssertionError("No deployer path on worker")):
                spec.loader.exec_module(module)
            self.assertIsNone(module.image)
            self.assertIsNone(module.cpu_image)
        finally:
            del sys.modules[spec.name]

    def test_remote_failure_cancels_call_without_deleting_remote_evidence(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.wav"
            source.write_bytes(b"decoder-validates-remotely")
            volume = MagicMock()
            call = MagicMock(object_id="fc-test")
            call.get.side_effect = RuntimeError("worker failed")
            with patch.object(client.modal.Volume, "from_name", return_value=volume), patch.object(client.modal.Function, "from_name") as function:
                function.return_value.spawn.return_value = call
                with self.assertRaisesRegex(RuntimeError, "worker failed"):
                    client.run(source, root / "result")
            call.cancel.assert_called_once_with(terminate_containers=True)
            volume.remove_file.assert_not_called()
            self.assertTrue((root / "result/modal-call.json").is_file())
