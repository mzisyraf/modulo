import json
import math
import subprocess
import pytest
from app.contracts import ROOT
from app.temporal_features import temporal_features, TemporalFeatures


def test_envelope_descriptors_match_browser_and_reject_invalid_values():
    rate = 8000
    samples = [.2 * math.sin(i * 2 * math.pi * 220 / rate) * math.exp(-(i % rate) / 400) for i in range(rate * 3)]
    measured = temporal_features(samples, rate)
    script = "import {temporalFeatures} from './apps/web/src/temporalFeatures.ts';const r=8000,s=Float32Array.from({length:r*3},(_,i)=>.2*Math.sin(i*2*Math.PI*220/r)*Math.exp(-(i%r)/400));console.log(JSON.stringify(temporalFeatures(s,r)));"
    browser = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", script], cwd=ROOT, text=True))
    assert browser["correlations"] == pytest.approx(measured["correlations"], abs=1e-7)
    assert browser["release_ratio"] == pytest.approx(measured["release_ratio"], abs=1e-7)
    for key in ['envelope_acf','decay_curve']: assert browser[key]==pytest.approx(measured[key],abs=1e-7)
    assert browser['decay_counts']==measured['decay_counts']
    with pytest.raises(ValueError): temporal_features([0.] * (rate * 3), rate)
    with pytest.raises(ValueError): TemporalFeatures.model_validate({**measured, "correlations": [2.] * 10})
