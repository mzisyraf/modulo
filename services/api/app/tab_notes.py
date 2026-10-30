"""Strict transcription boundary and bounded guitar fingering; standard library only."""
import math

MODEL_SHA = "2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec"
TUNINGS = {"standard": (40,45,50,55,59,64), "drop_d": (38,45,50,55,59,64)}
MAX_NOTES = 10000


def number(value, low, high):
    return type(value) in (int,float) and math.isfinite(value) and low <= value <= high


def validate_transcription(value):
    if not isinstance(value,dict) or type(value.get("version"))is not int or value.get("version") != 1 or not number(value.get("duration_seconds"),10,295):
        raise ValueError("Invalid full-song transcription")
    if set(value) != {"version","duration_seconds","source_sha256","notes","provenance"}:
        raise ValueError("Unexpected transcription fields")
    digest=value["source_sha256"]
    if not isinstance(digest,str) or len(digest)!=64 or any(c not in "0123456789abcdef" for c in digest): raise ValueError("Invalid source hash")
    p=value["provenance"]
    if not isinstance(p,dict) or p.get("provider")!="modal" or p.get("model")!="spotify/basic-pitch:0.4.0" or p.get("model_sha256")!=MODEL_SHA or p.get("runtime")!="onnxruntime-cuda" or type(p.get("cuda_kernels"))is not int or not number(p.get("cuda_kernels"),1,10000000) or not number(p.get("elapsed_seconds"),0,300):
        raise ValueError("Unverified GPU transcription provenance")
    if not isinstance(value["notes"],list) or len(value["notes"])>MAX_NOTES: raise ValueError("Too many transcribed notes")
    previous=-1
    for n in value["notes"]:
        if not isinstance(n,dict) or set(n)!={"start_seconds","end_seconds","midi_pitch","model_strength","pitch_bend"}: raise ValueError("Invalid note fields")
        a,b,pitch=n["start_seconds"],n["end_seconds"],n["midi_pitch"]
        if not number(a,0,value["duration_seconds"]) or not number(b,a,value["duration_seconds"]) or b<=a or a<previous or type(pitch)is not int or not 0<=pitch<=127 or not number(n["model_strength"],0,1) or type(n["pitch_bend"])is not bool:
            raise ValueError("Invalid note values/timeline")
        previous=a
    return value


def arrange(value,tuning="standard",capo=0):
    validate_transcription(value)
    if tuning not in TUNINGS or type(capo)is not int or not 0<=capo<=12: raise ValueError("Use standard/Drop D tuning and capo0–12")
    # Keep a small beam across notes; overlapping notes cannot occupy the same string.
    beam=[(0.0,{},0,None)]
    for note in value["notes"]:
        options=[(6-i,note["midi_pitch"]-pitch-capo) for i,pitch in enumerate(TUNINGS[tuning]) if 0<=note["midi_pitch"]-pitch-capo<=24-capo]
        candidates=[]
        for cost,active,position,path in beam:
            active={s:v for s,v in active.items() if v[0]>note["start_seconds"]+.02}
            possible=[]
            for string,fret in options:
                if string in active: continue
                frets=[v[1] for v in active.values() if v[1]>0]+([fret] if fret else [])
                if frets and max(frets)-min(frets)>5: continue
                next_position=fret if fret else position
                delta=(abs(next_position-position)*.3 if position else 0)+fret*.01+(len(set(frets))>4)*8
                possible.append((cost+delta,{**active,string:(note["end_seconds"],fret)},next_position,(path,string,fret)))
            candidates.extend(possible)
            # Retain an explicit omission alternative so a dense chord cannot erase better paths.
            candidates.append((cost+30,active,position,(path,None,None)))
        candidates.sort(key=lambda x:x[0]);beam=candidates[:12]
    selected=[];node=beam[0][3]
    while node is not None:
        node,string,fret=node;selected.append((string,fret))
    selected.reverse()
    notes=[{**note,"string":s,"fret":f,"assignment_status":"suggested" if s is not None else "unassigned"} for note,(s,f) in zip(value["notes"],selected)]
    return {**value,"tuning":tuning,"capo":capo,"notes":notes,"quality_flags":["draft_tablature","original_fingering_unverified"]+(["unassigned_notes"] if any(s is None for s,f in selected) else [])}


def text_tab(value):
    lines=["modulo — full-song draft tablature",f"Tuning: {value['tuning']} | capo: {value['capo']} | timestamps in seconds", "Suggested fingering; verify by ear. '-' is not rhythmic notation."]
    for start in range(0,math.ceil(value["duration_seconds"]),10):
        notes=[n for n in value["notes"] if start<=n["start_seconds"]<start+10]
        lines.append(f"\n{start:03d}–{min(start+10,value['duration_seconds']):06.2f}s")
        times=sorted({round(n['start_seconds'],2) for n in notes})
        lines.append(" t "+" ".join(f"{t:>6.2f}" for t in times))
        for string in range(1,7):
            cells=[]
            for t in times:
                ns=[n for n in notes if n['string']==string and round(n['start_seconds'],2)==t]
                cells.append(str(ns[0]['fret']) if ns else "-")
            lines.append(f"{string}| "+" ".join(f"{cell:>6}" for cell in cells))
    if any(n['string']is None for n in value['notes']):lines.append("\nUnassigned notes remain in the JSON/MIDI export.")
    return "\n".join(lines)
