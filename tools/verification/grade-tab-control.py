"""Fixed onset/pitch F1 and full-window checks; never changes extraction thresholds."""
import argparse
import json
from pathlib import Path

p=argparse.ArgumentParser();p.add_argument('directory',type=Path);args=p.parse_args()
truth=json.loads((args.directory/'expected.json').read_text());result=json.loads((args.directory/'result/notes.json').read_text());grades={}
for kind,low,high,minimum in [('melody',0,12,.85),('chord',12,21,.75)]+([('end',truth['duration_seconds']-4,truth['duration_seconds'],.85)] if truth['duration_seconds']>30 else []):
    expected=[x for x in truth['events'] if x['kind']==kind];predicted=[x for x in result['notes'] if low<=x['start_seconds']<high];used=set();matched=0
    for e in expected:
        candidates=[i for i,n in enumerate(predicted) if i not in used and e['midi_pitch']==n['midi_pitch'] and abs(e['start_seconds']-n['start_seconds'])<=.08]
        if candidates:used.add(min(candidates,key=lambda i:abs(predicted[i]['start_seconds']-e['start_seconds'])));matched+=1
    f1=2*matched/(len(expected)+len(predicted)) if expected or predicted else 1
    grades[kind]={'expected':len(expected),'predicted':len(predicted),'matched':matched,'onset_pitch_f1':f1,'threshold':minimum,'passed':f1>=minimum}
if truth['duration_seconds']>30:
    unexpected=[n for n in result['notes'] if 22<n['start_seconds']<truth['duration_seconds']-4]
    grades['long_silence']={'notes':len(unexpected),'passed':not unexpected}
grades['full_duration']={'passed':result['duration_seconds']==truth['duration_seconds']}
grades['cuda']={'kernels':result['provenance']['cuda_kernels'],'passed':result['provenance']['cuda_kernels']>0}
(args.directory/'grade.json').write_text(json.dumps(grades,indent=2));print(json.dumps(grades,indent=2))
if not all(x['passed'] for x in grades.values()):raise SystemExit(1)
