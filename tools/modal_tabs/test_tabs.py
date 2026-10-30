"""Offline transport and reservation regressions; no network/GPU calls."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock,patch
from uuid import uuid4
import wave

import tabs_common
import client

class TabsChecks(unittest.TestCase):
    def test_eight_total_reservations_survive_failure_and_refuse_corruption(self):
        with tempfile.TemporaryDirectory()as d:
            path=Path(d)/'attempts.json'
            first=str(uuid4());tabs_common.reserve(path,first)
            with self.assertRaises(RuntimeError):tabs_common.reserve(path,first)
            for _ in range(7):tabs_common.reserve(path,str(uuid4()))
            self.assertEqual(len(json.loads(path.read_text())),8)
            with self.assertRaises(RuntimeError):tabs_common.reserve(path,str(uuid4()))
            path.write_text('{}')
            with self.assertRaises(RuntimeError):tabs_common.reserve(path,str(uuid4()))

    def test_remote_import_has_no_deployer_paths(self):
        spec=importlib.util.spec_from_file_location('tabs_remote_test',Path(__file__).with_name('app.py'));module=importlib.util.module_from_spec(spec)
        with patch('modal.is_local',return_value=False),patch('pathlib.Path.resolve',side_effect=AssertionError('No local resolve on GPU')):
            spec.loader.exec_module(module)
        self.assertIsNone(module.image)

    def test_wave_bounds_and_canonical_paths(self):
        with tempfile.TemporaryDirectory()as d:
            root=Path(d);source=root/'guitar.wav'
            with wave.open(str(source),'wb')as w:w.setparams((1,2,44100,0,'NONE','not compressed'));w.writeframes(bytes(44100*10*2))
            tabs_common.validate_source(source)
            with self.assertRaises(ValueError):tabs_common.job_path(root,'../foreign')
            source.write_bytes(b'invalid')
            with self.assertRaises(ValueError):tabs_common.validate_source(source)

    def test_failed_gpu_call_is_cancelled_and_call_id_saved(self):
        with tempfile.TemporaryDirectory()as d:
            root=Path(d);source=root/'guitar.wav'
            with wave.open(str(source),'wb')as w:w.setparams((1,2,44100,0,'NONE','not compressed'));w.writeframes(bytes(44100*10*2))
            volume=MagicMock();volume.read_file.return_value=iter([b'[]']);call=MagicMock(object_id='fc-test');call.get.side_effect=RuntimeError('TEST GPU failure')
            with patch.object(client.modal.Volume,'from_name',return_value=volume),patch.object(client.modal.Function,'from_name')as fn:
                fn.return_value.spawn.return_value=call
                with self.assertRaises(RuntimeError):client.run(source,root/'output')
            call.cancel.assert_called_once_with(terminate_containers=True)
            self.assertEqual(json.loads((root/'output/modal-tabs-call.json').read_text())['call_id'],'fc-test')
            self.assertTrue(json.loads((root/'output/tabs-cancel.json').read_text())['confirmed'])

    def test_cancel_marker_prevents_submission(self):
        with tempfile.TemporaryDirectory()as d:
            root=Path(d);source=root/'guitar.wav';output=root/'output';output.mkdir();(output/'cancel.request').touch()
            with wave.open(str(source),'wb')as w:w.setparams((1,2,44100,0,'NONE','not compressed'));w.writeframes(bytes(44100*10*2))
            volume=MagicMock();volume.read_file.return_value=iter([b'[]'])
            with patch.object(client.modal.Volume,'from_name',return_value=volume),patch.object(client.modal.Function,'from_name')as fn:
                with self.assertRaises(InterruptedError):client.run(source,output)
                fn.assert_not_called()

    def test_unknown_submission_is_never_reported_cancelled(self):
        with tempfile.TemporaryDirectory()as d:
            root=Path(d);(root/'modal-tabs-call.json').write_text(json.dumps({'job_id':str(uuid4()),'call_id':None}))
            with self.assertRaisesRegex(RuntimeError,'unconfirmed'):client.cancel(root)

if __name__=='__main__':unittest.main()
