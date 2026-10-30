"""Authenticated bounded Modal transport, shared by CLI and local API subprocess."""
import argparse
import json
import os
from pathlib import Path
import sys
import time
from uuid import uuid4
from tabs_common import APP_NAME,VOLUME_NAME,LIMIT,job_path,validate_source

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'services/api'))
from app.tab_notes import validate_transcription
os.environ.setdefault('MODAL_CONFIG_PATH',str(ROOT/'data/modal/config.toml'))
import modal

def write(path,value):
    temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(value,allow_nan=False));temporary.replace(path)

def run(source,output):
    validate_source(source);output.mkdir(parents=True,exist_ok=True)
    if any((output/name).exists() for name in ('notes.json','notes.mid','modal-tabs-call.json')):raise ValueError('Use a fresh tabs output directory')
    volume=modal.Volume.from_name(VOLUME_NAME)
    try:
        raw=b''
        for block in volume.read_file('/attempts.json'):
            if len(raw)+len(block)>4096:raise RuntimeError('Oversized attempt ledger')
            raw+=block
        entries=json.loads(raw)
    except FileNotFoundError:entries=[]
    if not isinstance(entries,list) or len(entries)>=LIMIT or any(not isinstance(x,str) for x in entries):raise RuntimeError('Tabs GPU allowance exhausted or corrupt; review billing')
    job_id=str(uuid4());job_path('/',job_id)
    call=None;complete=False
    write(output/'tabs-progress.json',{'stage':'uploading'})
    def cancelled():
        if (output/'cancel.request').exists():raise InterruptedError('Cancellation requested')
    try:
        cancelled()
        with volume.batch_upload() as batch:batch.put_file(source,f'/{job_id}/guitar.wav')
        cancelled()
        # Persist the remote UUID before spawn as well as the call ID immediately afterward.
        write(output/'modal-tabs-call.json',{'job_id':job_id,'call_id':None})
        call=modal.Function.from_name(APP_NAME,'transcribe').spawn(job_id)
        write(output/'modal-tabs-call.json',{'job_id':job_id,'call_id':call.object_id})
        cancelled()
        write(output/'tabs-progress.json',{'stage':'transcribing'})
        deadline=time.monotonic()+540
        while True:
            cancelled()
            try:result=call.get(timeout=0);break
            except TimeoutError:
                if time.monotonic()>deadline:raise TimeoutError('GPU transcription timed out; cancellation requested')
                time.sleep(1)
        if result.get('job_id')!=job_id or result.get('status')!='ready':raise ValueError('Unexpected GPU result')
        complete=True
        for name,limit in [('notes.json',4*1024*1024),('notes.mid',1024*1024)]:
            temporary=output/(name+'.partial');size=0
            try:
                with temporary.open('wb') as target:
                    for block in volume.read_file(f'/{job_id}/{name}'):
                        size+=len(block)
                        if size>limit:raise ValueError('Transcription artifact too large')
                        target.write(block)
                if not size:raise ValueError('Empty transcription artifact')
                temporary.replace(output/name)
            finally:temporary.unlink(missing_ok=True)
        validate_transcription(json.loads((output/'notes.json').read_text()))
        midi=(output/'notes.mid').read_bytes()
        if not midi.startswith(b'MThd'):raise ValueError('Invalid MIDI header')
        write(output/'tabs-worker-report.json',result)
        volume.remove_file(f'/{job_id}',recursive=True)
        write(output/'tabs-progress.json',{'stage':'arranging'})
        return result
    except BaseException:
        if call is not None and not complete:
            try:
                call.cancel(terminate_containers=True);write(output/'tabs-cancel.json',{'confirmed':True})
            except Exception as failure:
                write(output/'tabs-cancel.json',{'confirmed':False});print(f'Cancellation unconfirmed: {type(failure).__name__}; inspect private call metadata',file=sys.stderr)
        elif call is None:write(output/'tabs-cancel.json',{'confirmed':True})
        raise

def cancel(output):
    path=output/'modal-tabs-call.json'
    if not path.exists():return
    metadata=json.loads(path.read_text());job_path('/',metadata['job_id'])
    if (output/'tabs-cancel.json').exists() and json.loads((output/'tabs-cancel.json').read_text()).get('confirmed')is True:return
    if not metadata.get('call_id'):raise RuntimeError('Submission interrupted before call ID was saved; cancellation unconfirmed')
    modal.FunctionCall.from_id(metadata['call_id']).cancel(terminate_containers=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('source',type=Path);parser.add_argument('output',nargs='?',type=Path);parser.add_argument('--cancel',action='store_true');args=parser.parse_args()
    try:
        if args.cancel:cancel(args.source)
        elif args.output is None:parser.error('Supply an output directory')
        else:
            result=run(args.source,args.output)
            print(json.dumps({k:v for k,v in result.items() if k!='requirements'}),flush=True)
    except Exception as failure:
        print(f'Tabs failed: {type(failure).__name__}: {failure}',file=sys.stderr);raise SystemExit(1)
