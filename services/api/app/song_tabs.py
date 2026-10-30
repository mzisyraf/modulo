"""Full-song GPU tasks, using the existing private Modal client environment."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import hashlib
import json
import logging
import os
from pathlib import Path
import subprocess
from threading import Event
import time
from uuid import uuid4

from .contracts import ROOT
from .jobs import JobError,canonical_id
from .tab_notes import arrange,validate_transcription

logger=logging.getLogger(__name__)
BUSY={"queued","uploading","transcribing","arranging"}

def digest(path):
    result=hashlib.sha256()
    with path.open('rb')as stream:
        while block:=stream.read(1024*1024):result.update(block)
    return result.hexdigest()

def write(path,value):
    temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(value,allow_nan=False),encoding='utf-8');temporary.replace(path)

class SongTabs:
    def __init__(self,store,runner=None):
        self.store=store;self.runner=runner or self.run_modal;self.running={};self.storage_failures=set();self.pool=ThreadPoolExecutor(max_workers=1,thread_name_prefix='song-tabs')
        for job_id in store.jobs:
            path=self.state_path(job_id)
            if path.exists():
                try:
                    state=self.read_state(job_id)
                    if state['status']in BUSY:
                        state.update(status='failed',error='API restarted during transcription. The reserved attempt is retained; review before retrying.')
                        if runner is None:
                            output=store.directory(job_id)/f"tabs-{canonical_id(state['request_id'])}"
                            if output.is_dir():
                                try:self.cancel_remote(output)
                                except (OSError,subprocess.SubprocessError):state['error']+=' Remote cancellation unconfirmed; inspect private call metadata.'
                        write(path,state)
                except (ValueError,OSError,KeyError):logger.warning('Invalid retained tab state for%s',job_id)

    def close(self):
        for event in list(self.running.values()):event.set()
        self.pool.shutdown(wait=True)

    def cancel_remote(self,output):
        python=ROOT/'tools/modal/.venv'/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
        with (output/'cancel.log').open('a',encoding='utf-8')as log:
            subprocess.run([str(python),str(ROOT/'tools/modal_tabs/client.py'),'--cancel',str(output)],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,timeout=30,check=True)

    def state_path(self,job_id):return self.store.directory(job_id)/'tabs-state.json'

    def read_state(self,job_id):
        path=self.state_path(job_id)
        if not path.exists():return {'status':'idle'}
        if path.is_symlink() or path.stat().st_size>8192:raise ValueError('Invalid tab state')
        state=json.loads(path.read_text())
        if not isinstance(state,dict) or state.get('status')not in BUSY|{'idle','ready','failed','cancelled'}:raise ValueError('Invalid tab status')
        return state

    def get(self,job_id,tuning='standard',capo=0):
        with self.store.lock:
            job=self.store.get(job_id)
            if job['status']!='ready':raise JobError('job_not_ready','Wait for guitar separation first.',409)
            if job_id in self.storage_failures:raise JobError('tabs_storage_failed','Tab progress could not be saved. Fix local storage and restart the API before retrying; the attempt may have been billed.',503)
            try:state=self.read_state(job_id)
            except (OSError,ValueError)as failure:raise JobError('tabs_storage_failed','Stored tabs are invalid; review local storage.',503)from failure
            if state['status']=='cancelled':state['cancellation_pending']=job_id in self.running
            if state['status']=='ready':
                path=self.store.directory(job_id)/'tabs-notes.json'
                try:
                    if path.is_symlink() or path.stat().st_size>4*1024*1024:raise ValueError('Oversized notes')
                    raw=validate_transcription(json.loads(path.read_text()))
                    state['result']=arrange(raw,tuning,capo)
                except (OSError,ValueError,KeyError,TypeError)as failure:raise JobError('tabs_invalid','Tab output or tuning is invalid.',422)from failure
            return deepcopy(state)

    def start(self,job_id,retry=False):
        with self.store.lock:
            self.store.get(job_id)
            state=self.get(job_id)
            if state['status']=='ready' or job_id in self.running:return state
            if state['status']in {'failed','cancelled'} and not retry:raise JobError('tabs_retry_required','Review the failure, then explicitly retry. An attempt may have been billed.',409)
            if self.running:raise JobError('tabs_busy','One song is already transcribing. Wait or cancel it first.',429,True)
            request_id=str(uuid4());state={'status':'queued','request_id':request_id,'scope':'whole_song'}
            write(self.state_path(job_id),state)
            event=Event();self.running[job_id]=event;self.store.tabs_running.add(job_id)
            try:self.pool.submit(self.execute,job_id,request_id,event)
            except BaseException:
                self.running.pop(job_id,None);self.store.tabs_running.discard(job_id);raise
            return deepcopy(state)

    def cancel(self,job_id):
        with self.store.lock:
            self.store.get(job_id);state=self.read_state(job_id)
            if state['status']in BUSY:
                if job_id in self.running:self.running[job_id].set()
                state.update(status='cancelled',error='Cancellation requested. Remote confirmation is pending; the reserved attempt is retained.')
                write(self.state_path(job_id),state)
            return state

    def execute(self,job_id,request_id,event):
        store=self.store;directory=store.directory(job_id);output=directory/f'tabs-{request_id}'
        def stage(name):
            with store.lock:
                state=self.read_state(job_id)
                if event.is_set():raise InterruptedError('Transcription cancelled')
                if state.get('request_id')!=request_id:raise InterruptedError('Stale transcription')
                state['status']=name;write(self.state_path(job_id),state)
        try:
            source=directory/'guitar.wav';source_hash=digest(source)
            expected_duration=store.get(job_id)['result']['duration_seconds']
            stage('uploading');self.runner(source,output,event,stage)
            stage('arranging')
            path=output/'notes.json'
            if path.is_symlink() or path.stat().st_size>4*1024*1024:raise ValueError('Invalid notes artifact')
            value=validate_transcription(json.loads(path.read_text()))
            if value['source_sha256']!=source_hash:raise ValueError('Transcription source mismatch')
            if abs(value['duration_seconds']-expected_duration)>1/44100:raise ValueError('Transcription did not cover the full song')
            arrange(value)
            if (output/'notes.mid').is_symlink() or (output/'notes.mid').stat().st_size>1024*1024:raise ValueError('Invalid MIDI size')
            midi=(output/'notes.mid').read_bytes()
            if not 14<=len(midi)<=1024*1024 or not midi.startswith(b'MThd'):raise ValueError('Invalid MIDI artifact')
            with store.lock:
                state=self.read_state(job_id)
                if event.is_set() or state.get('request_id')!=request_id:raise InterruptedError('Discarded late result')
                store.get(job_id)
                write(directory/'tabs-notes.json',value)
                temporary=directory/'tabs-midi.tmp';temporary.write_bytes(midi);temporary.replace(directory/'tabs-midi.mid')
                state.update(status='ready',source_sha256=source_hash);state.pop('error',None);write(self.state_path(job_id),state)
        except Exception as failure:
            logger.warning('Song tabs failed for%s:%s',job_id,type(failure).__name__)
            with store.lock:
                try:
                    state=self.read_state(job_id)
                    if state.get('request_id')==request_id:
                        state.update(status='cancelled' if event.is_set() else 'failed',error=str(failure) if isinstance(failure,InterruptedError) else 'GPU transcription failed. Inspect the private tabs log; no automatic retry. The attempt may have been billed.')
                        write(self.state_path(job_id),state)
                except (OSError,ValueError):self.storage_failures.add(job_id);logger.exception('Could not persist tabs failure for%s',job_id)
        finally:
            with store.lock:self.running.pop(job_id,None);store.tabs_running.discard(job_id)

    def run_modal(self,source,output,event,stage):
        python=ROOT/'tools/modal/.venv'/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
        if not python.is_file():raise RuntimeError('Set up the existing private Modal client environment')
        output.mkdir(parents=True,exist_ok=False)
        command=[str(python),str(ROOT/'tools/modal_tabs/client.py')]
        started=time.monotonic();current='uploading'
        with (output/'worker.log').open('w',encoding='utf-8')as log:
            process=subprocess.Popen(command+[str(source),str(output)],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
            try:
                while process.poll()is None:
                    if event.wait(.2) or time.monotonic()-started>600:raise InterruptedError('Transcription cancelled or exceeded its client deadline')
                    progress=output/'tabs-progress.json'
                    if progress.exists():
                        name=json.loads(progress.read_text()).get('stage')
                        if name in {'transcribing','arranging'}and name!=current:stage(name);current=name
                if process.returncode:raise RuntimeError('Modal transcription failed')
            except BaseException:
                (output/'cancel.request').touch()
                if process.poll()is None:
                    try:process.wait(timeout=10)
                    except subprocess.TimeoutExpired:process.terminate();process.wait(timeout=10)
                try:self.cancel_remote(output)
                except (OSError,subprocess.SubprocessError)as failure:raise InterruptedError('Remote cancellation unconfirmed; inspect private call metadata')from failure
                raise
