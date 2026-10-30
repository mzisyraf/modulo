"""Deterministic clean plucked-note/chord control with known events, not music quality."""
import argparse
import json
import math
from pathlib import Path
import random
import struct
import wave

p=argparse.ArgumentParser();p.add_argument('directory',type=Path);p.add_argument('--seconds',type=int,default=24);args=p.parse_args()
if not 24<=args.seconds<=295:raise ValueError('Use24–295seconds')
args.directory.mkdir(parents=True,exist_ok=False)
rate=44100;samples=[0.0]*(args.seconds*rate);events=[];rng=random.Random(71)
groups=[(1+i*1.1,[pitch],'melody') for i,pitch in enumerate([40,45,50,55,59,64,67,69,71,72])]
groups += [(13+i*2.2,pitches,'chord') for i,pitches in enumerate([[48,52,55],[50,54,57],[52,55,59]])]
if args.seconds>30:groups += [(args.seconds-3,[64],'end'),(args.seconds-1.5,[67],'end')]
for start,pitches,kind in groups:
    for pitch in pitches:
        duration=.7 if kind!='chord' else 1.5;frequency=440*2**((pitch-69)/12)
        events.append({'start_seconds':start,'end_seconds':start+duration,'midi_pitch':pitch,'kind':kind})
        phase=rng.random()*math.tau
        for i in range(int(rate*duration)):
            t=i/rate;envelope=min(1,t/.008)*math.exp(-2*t/duration)*(1-t/duration)
            sample=sum(math.sin(math.tau*frequency*h*t+phase)*(.55**(h-1)) for h in range(1,5))
            samples[int(start*rate)+i]+=.13/len(pitches)*sample*envelope
with wave.open(str(args.directory/'guitar.wav'),'wb')as w:
    w.setparams((1,2,rate,len(samples),'NONE','not compressed'));w.writeframes(b''.join(struct.pack('<h',round(max(-.9,min(.9,x))*32767))for x in samples))
(args.directory/'expected.json').write_text(json.dumps({'duration_seconds':args.seconds,'events':events},indent=2))
print(f'Prepared{args.seconds}s control, {len(events)} known notes')
