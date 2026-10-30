import json
import math
import subprocess
from pathlib import Path
import pytest
from app.tone_features import tone_features, ToneFeatures
from app.preset_generation import PresetError
from test_preset_generation import generator, response, REFERENCE
from test_source_calibration import SOURCE

ROOT=Path(__file__).resolve().parents[3]

def test_browser_and_python_spectral_parity():
    samples=[.2*math.sin(2*math.pi*440*i/44100)+.03*math.sin(2*math.pi*2500*i/44100) for i in range(44100*3)]
    # Match browser Float32 input exactly before comparing both implementations.
    from array import array
    samples=list(array('f',samples))
    actual=tone_features(samples,44100)
    script="import {toneFeatures} from './apps/web/src/audioFeatures.ts';let s='';for await(const x of process.stdin)s+=x;console.log(JSON.stringify(toneFeatures(Float32Array.from(JSON.parse(s)),44100)));"
    browser=json.loads(subprocess.run(["node","--input-type=module","-e",script],cwd=ROOT,input=json.dumps(samples),text=True,capture_output=True,check=True).stdout)
    assert actual['bands']==pytest.approx(browser['bands'],abs=1e-10)
    assert actual['fine_bands']==pytest.approx(browser['fine_bands'],abs=1e-10)
    for key in ['cepstrum','harmonic_profile']: assert actual[key]==pytest.approx(browser[key],abs=1e-8)
    assert actual['harmonic_confidence']==pytest.approx(browser['harmonic_confidence'],abs=1e-8)
    for key in ['centroid_hz','flatness','crest_db']:assert actual[key]==pytest.approx(browser[key],abs=1e-8)
    assert actual['bands'][2]>.9

def test_spectral_pair_reaches_provider_and_preserves_baseline(tmp_path):
    samples=[.1*math.sin(2*math.pi*440*i/44100) for i in range(44100*3)]
    feature=tone_features(samples,44100)
    source={**SOURCE,'tone_features':feature};reference={**REFERENCE,'tone_features':feature}
    calls=[];engine=generator(tmp_path,lambda key,payload:calls.append(payload) or response())
    result=engine.generate(reference,source)
    packet=json.loads(calls[0]['messages'][1]['content'])
    assert packet['target_tone_features']==feature and packet['source_features']['tone_features']==feature
    assert packet['band_delta_db']==[0]*6
    assert 'engine_semantics' in packet
    assert result['parameters']['input_gain_db']==-2
    assert 'spectral_features_measured' in result['quality_flags']
    assert 'target_energy_only' not in result['quality_flags']
    with pytest.raises(PresetError) as failure:engine.generate(REFERENCE,source)
    assert failure.value.code=='missing_target_spectrum' and len(calls)==1

def test_bad_spectra_and_silence_reject():
    with pytest.raises(ValueError):tone_features([0.]*4096,44100)
    with pytest.raises(ValueError):ToneFeatures.model_validate({'method':'spectral_bands_v1','bands':[1.]*6,'centroid_hz':440.,'flatness':.1,'crest_db':3.})
