from copy import deepcopy
import json
from threading import Event
import time
from uuid import uuid4
import wave

from fastapi.testclient import TestClient
import pytest
from app.jobs import JobStore,JobError
from app.main import create_app
from app.song_tabs import SongTabs,digest
from app.tab_notes import MODEL_SHA,arrange,validate_transcription

def source_job(store):
    job,_=store.reserve(str(uuid4()));job_id=job['job_id'];directory=store.directory(job_id)
    with wave.open(str(directory/'guitar.wav'),'wb')as w:
        w.setparams((1,2,44100,0,'NONE','not compressed'));w.writeframes(bytes(44100*12*2))
    store.jobs[job_id].update(status='ready',stage='ready',result={'duration_seconds':12})
    store.save(store.jobs[job_id]);return job_id

def transcription(source):
    return {'version':1,'duration_seconds':12,'source_sha256':digest(source),'notes':[
        {'start_seconds':1.,'end_seconds':2.,'midi_pitch':64,'model_strength':.8,'pitch_bend':False},
        {'start_seconds':1.,'end_seconds':2.,'midi_pitch':67,'model_strength':.7,'pitch_bend':False}],
        'provenance':{'provider':'modal','model':'spotify/basic-pitch:0.4.0','model_sha256':MODEL_SHA,'runtime':'onnxruntime-cuda','cuda_kernels':40,'elapsed_seconds':1.}}

def success(source,output,event,stage):
    output.mkdir();(output/'notes.json').write_text(json.dumps(transcription(source)))
    (output/'notes.mid').write_bytes(b'MThd\x00\x00\x00\x06\x00\x00\x00\x01\x01\xe0MTrk\x00\x00\x00\x04\x00\xff\x2f\x00')

def until(test,timeout=4):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        value=test()
        if value:return value
        time.sleep(.01)
    pytest.fail('Tab task did not reach expected state')

def test_tab_api_ready_cache_arrange_exports_and_boundaries(tmp_path):
    calls=[]
    def runner(*args):calls.append(1);success(*args)
    store=JobStore(tmp_path/'jobs')
    with TestClient(create_app(store,tabs_runner=runner),base_url='http://127.0.0.1')as client:
        job=source_job(store);url=f'/api/jobs/{job}/tabs'
        assert client.get(url).json()['status']=='idle'
        assert client.post(url,json={'retry':False}).status_code==202
        ready=until(lambda:(s if (s:=client.get(url).json())['status']=='ready' else None))
        assert ready['scope']=='whole_song' and ready['result']['duration_seconds']==12
        assert len(ready['result']['notes'])==2
        assert client.post(url,json={}).json()['status']=='ready'
        changed=client.get(url+'?tuning=drop_d&capo=2').json()['result']
        assert changed['tuning']=='drop_d' and changed['capo']==2 and calls==[1]
        assert client.get(url+'/files/txt').text.startswith('modulo')
        assert client.get(url+'/files/json').json()['quality_flags'][0]=='draft_tablature'
        assert client.get(url+'/files/mid').content.startswith(b'MThd')
        assert client.get(url+'/files/worker.log').status_code==404
        assert client.get(url+'?tuning=invented').status_code==422
        assert client.get(url+'?capo=13').status_code==422
        assert client.post(url,json={'retry':'yes'}).status_code==422
        assert client.post(url,json={'extra':1}).status_code==422
        assert client.post(url,json={},headers={'origin':'https://attacker.test'}).status_code==403
        assert not store.tabs_running

@pytest.mark.parametrize('repeat',range(3))
def test_duplicate_cancel_late_result_and_pin(tmp_path,repeat):
    entered,release=Event(),Event();calls=[]
    def runner(source,output,event,stage):
        calls.append(1);stage('transcribing');entered.set();assert release.wait(4);success(source,output,event,stage)
    store=JobStore(tmp_path/'jobs')
    with TestClient(create_app(store,tabs_runner=runner),base_url='http://127.0.0.1')as client:
        job=source_job(store);url=f'/api/jobs/{job}/tabs'
        try:
            client.post(url,json={});assert entered.wait(2)
            for _ in range(3):assert client.post(url,json={}).json()['status']=='transcribing'
            assert calls==[1] and job in store.tabs_running
            with pytest.raises(JobError):store.remove(job)
            for _ in range(4):
                other,_=store.reserve(str(uuid4()));store.fail(other['job_id'],JobError('test','test'))
            assert store.directory(job).exists()
            assert client.delete(url).json()['status']=='cancelled'
            assert client.get(url).json()['cancellation_pending'] is True
        finally:release.set()
        until(lambda:not store.tabs_running)
        assert client.get(url).json()['status']=='cancelled'
        assert client.get(url).json()['cancellation_pending'] is False
        assert not (store.directory(job)/'tabs-notes.json').exists()
        assert client.post(url,json={}).status_code==409

@pytest.mark.parametrize('invalid',['source','duration'])
def test_wrong_source_failure_explicit_retry_and_restart(tmp_path,invalid):
    store=JobStore(tmp_path/'jobs');calls=[]
    def runner(*args):
        success(*args);calls.append(1)
        if len(calls)==1:
            path=args[1]/'notes.json';value=json.loads(path.read_text());value['source_sha256' if invalid=='source' else 'duration_seconds']='0'*64 if invalid=='source' else 13;path.write_text(json.dumps(value))
    with TestClient(create_app(store,tabs_runner=runner),base_url='http://127.0.0.1')as client:
        job=source_job(store);url=f'/api/jobs/{job}/tabs'
        client.post(url,json={});until(lambda:client.get(url).json()['status']=='failed')
        assert client.post(url,json={}).status_code==409
        assert client.post(url,json={'retry':True}).status_code==202
        until(lambda:client.get(url).json()['status']=='ready');assert calls==[1,1]
        path=store.directory(job)/'tabs-state.json';path.write_text(json.dumps({'status':'transcribing','request_id':str(uuid4())}))
    with TestClient(create_app(store,tabs_runner=runner),base_url='http://127.0.0.1')as client:
        assert client.get(url).json()['status']=='failed'
        assert 'restarted' in client.get(url).json()['error']

def test_arrangement_pitch_and_overlapping_strings(tmp_path):
    store=JobStore(tmp_path/'jobs');store.start()
    try:
        job=source_job(store);value=transcription(store.directory(job)/'guitar.wav')
        for tuning in ('standard','drop_d'):
            for capo in (0,2,12):
                result=arrange(value,tuning,capo);seen=set()
                opens={'standard':[64,59,55,50,45,40],'drop_d':[64,59,55,50,45,38]}[tuning]
                for n in result['notes']:
                    if n['string']is not None:
                        assert n['midi_pitch']==opens[n['string']-1]+capo+n['fret']
                        assert 0<=n['fret']<=24-capo and n['string']not in seen;seen.add(n['string'])
        invalid=deepcopy(value);invalid['notes'][0]['midi_pitch']=True
        with pytest.raises(ValueError):validate_transcription(invalid)
        invalid=deepcopy(value);invalid['notes'][0]['start_seconds']=float('nan')
        with pytest.raises(ValueError):validate_transcription(invalid)
        invalid=deepcopy(value);invalid['provenance']['cuda_kernels']=0
        with pytest.raises(ValueError):validate_transcription(invalid)
        notes=deepcopy(value);notes['notes'][0]['midi_pitch']=0
        assert arrange(notes)['notes'][0]['assignment_status']=='unassigned'
    finally:store.close()

def test_failed_progress_write_is_reported_instead_of_polling_forever(tmp_path,monkeypatch):
    from app import song_tabs
    original=song_tabs.write
    def failing(path,value):
        if path.name=='tabs-state.json' and value.get('status')in {'ready','failed'}:raise OSError('TEST full disk or Windows lock')
        original(path,value)
    monkeypatch.setattr(song_tabs,'write',failing)
    store=JobStore(tmp_path/'jobs')
    with TestClient(create_app(store,tabs_runner=success),base_url='http://127.0.0.1')as client:
        job=source_job(store);url=f'/api/jobs/{job}/tabs';client.post(url,json={})
        until(lambda:client.get(url).status_code==503)
        assert client.post(url,json={'retry':True}).status_code==503
        assert client.get(f'/api/jobs/{job}').json()['status']=='ready'
