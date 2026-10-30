"""Private full-song CUDA transcription; isolated from the working Demucs app."""
import hashlib
import json
import os
from pathlib import Path
import time
os.environ.setdefault("MODAL_IMAGE_BUILDER_VERSION","2025.06")
import modal
from tabs_common import APP_NAME,VOLUME_NAME,job_path,reserve,validate_source

volume=modal.Volume.from_name(VOLUME_NAME,create_if_missing=True,version=2)
app=modal.App(APP_NAME)
image=cpu_image=None
if modal.is_local():
    ROOT=Path(__file__).resolve().parents[2]
    image=(modal.Image.from_registry("nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04",add_python="3.10")
        .apt_install("libsndfile1")
        .pip_install_from_requirements(str(ROOT/"tools/modal_tabs/requirements-lock.txt"))
        .run_commands("python -m pip freeze > /opt/tabs-requirements.txt")
        .add_local_file(ROOT/"tools/modal_tabs/tabs_common.py","/root/tabs_common.py",copy=True)
        .add_local_file(ROOT/"services/api/app/tab_notes.py","/root/tab_notes.py",copy=True))
    cpu_image=modal.Image.debian_slim().add_local_file(ROOT/"tools/modal_tabs/tabs_common.py","/root/tabs_common.py",copy=True)

@app.function(image=image,gpu=["L4","T4"],cpu=2,memory=4096,timeout=300,startup_timeout=180,
    min_containers=0,max_containers=1,buffer_containers=0,scaledown_window=2,retries=0,volumes={"/jobs":volume})
def transcribe(job_id:str):
    import basic_pitch
    from basic_pitch.inference import Model,predict
    import onnxruntime as ort
    from tab_notes import MODEL_SHA,validate_transcription
    volume.reload();directory=job_path("/jobs",job_id);source=directory/"guitar.wav"
    validate_source(source);reserve(Path('/jobs/attempts.json'),job_id);volume.commit()
    started=time.monotonic()
    try:
        model_path=Path(basic_pitch.__file__).parent/'saved_models/icassp_2022/nmp.onnx'
        if hashlib.sha256(model_path.read_bytes()).hexdigest()!=MODEL_SHA:raise RuntimeError('Model hash mismatch')
        if 'CUDAExecutionProvider' not in ort.get_available_providers():raise RuntimeError('CUDA execution unavailable')
        options=ort.SessionOptions();options.enable_profiling=True;options.profile_file_prefix=str(directory/'cuda')
        session=ort.InferenceSession(str(model_path),sess_options=options,providers=['CUDAExecutionProvider'])
        session.disable_fallback()
        if session.get_providers()[0]!='CUDAExecutionProvider':raise RuntimeError('GPU session did not initialize')
        # Pinned0.4.0 constructs CPU-only ONNX sessions; explicitly inject the verified CUDA session.
        model=Model.__new__(Model);model.model_type=Model.MODEL_TYPES.ONNX;model.model=session
        import wave
        import soundfile as sf
        duration=sf.info(source).duration
        # Supply end context for the upstream overlap crop; trim every output to the real timeline.
        padded=directory/'inference.wav'
        with wave.open(str(source))as original,wave.open(str(padded),'wb')as target:
            target.setparams(original.getparams());target.writeframes(original.readframes(original.getnframes()));target.writeframes(bytes(original.getframerate()*original.getnchannels()*original.getsampwidth()*2))
        outputs,midi,events=predict(padded,model,frame_threshold=.5,melodia_trick=False,minimum_note_length=90,minimum_frequency=65.0,maximum_frequency=1400.0)
        profile=Path(session.end_profiling());trace=json.loads(profile.read_text())
        kernels=sum(x.get('args',{}).get('provider')=='CUDAExecutionProvider' and any(op in x.get('args',{}).get('op_name','') for op in ('Conv','MatMul','Gemm')) for x in trace)
        if not kernels:raise RuntimeError('No CUDA model kernels verified')
        notes=[]
        for a,b,pitch,strength,bends in sorted(events,key=lambda n:(n[0],n[2])):
            a,b=max(0,round(float(a),6)),min(duration,round(float(b),6))
            if b>a:notes.append({'start_seconds':a,'end_seconds':b,'midi_pitch':int(pitch),'model_strength':float(max(0,min(1,strength))),'pitch_bend':bends is not None and any(abs(x)>1 for x in bends)})
        result={'version':1,'duration_seconds':duration,'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'notes':notes,
            'provenance':{'provider':'modal','model':'spotify/basic-pitch:0.4.0','model_sha256':MODEL_SHA,'runtime':'onnxruntime-cuda','cuda_kernels':kernels,'elapsed_seconds':round(time.monotonic()-started,3)}}
        validate_transcription(result)
        for instrument in midi.instruments:
            instrument.notes=[n for n in instrument.notes if n.start<duration]
            for note in instrument.notes:note.end=min(note.end,duration)
            instrument.pitch_bends=[b for b in instrument.pitch_bends if b.time<duration]
        (directory/'notes.json').write_text(json.dumps(result,allow_nan=False));midi.write(str(directory/'notes.mid'))
        source.unlink();padded.unlink();profile.unlink();volume.commit()
        return {'job_id':job_id,'status':'ready','note_count':len(notes),'cuda_kernels':kernels,'elapsed_seconds':result['provenance']['elapsed_seconds'],'requirements':Path('/opt/tabs-requirements.txt').read_text()}
    except BaseException:
        source.unlink(missing_ok=True);(directory/'inference.wav').unlink(missing_ok=True);volume.commit();raise

@app.function(image=cpu_image,schedule=modal.Period(hours=1),timeout=60,max_containers=1,volumes={'/jobs':volume})
def expire():
    import shutil
    volume.reload()
    for directory in Path('/jobs').iterdir():
        if directory.is_dir() and time.time()-directory.stat().st_mtime>=86400:shutil.rmtree(directory)
    volume.commit()
