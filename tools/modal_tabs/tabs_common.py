"""Private worker limits; no cloud SDK dependency."""
import json
from pathlib import Path
from uuid import UUID
import wave

APP_NAME="modulo-tabs"
VOLUME_NAME="modulo-tabs-jobs"
LIMIT=8
MAX_BYTES=50*1024*1024

def job_path(root,job_id):
    if str(UUID(job_id))!=job_id:raise ValueError("Invalid canonical job ID")
    path=Path(root)/job_id
    if path.is_symlink():raise ValueError("Symlink job forbidden")
    return path

def validate_source(path):
    if path.is_symlink() or not path.is_file() or not 44<path.stat().st_size<=MAX_BYTES:raise ValueError("Invalid guitar WAV size")
    with wave.open(str(path)) as w:
        if w.getcomptype()!="NONE" or w.getsampwidth()!=2 or w.getnchannels()not in (1,2) or w.getframerate()!=44100 or not 10<=w.getnframes()/44100<=295:raise ValueError("Expected full10–295s PCM16 guitar WAV")
        if len(w.readframes(w.getnframes()))!=w.getnframes()*2*w.getnchannels():raise ValueError("Truncated guitar WAV")

def reserve(path,job_id):
    entries=json.loads(path.read_text()) if path.exists() else []
    if not isinstance(entries,list) or len(entries)>=LIMIT or any(not isinstance(x,str) for x in entries):raise RuntimeError("Tabs eight-attempt allowance exhausted or corrupt; review billing")
    if len(set(entries))!=len(entries) or any(str(UUID(x))!=x for x in entries):raise RuntimeError("Corrupt tabs reservation ledger")
    if job_id in entries:raise RuntimeError("Attempt already reserved; no automatic retry")
    entries.append(job_id);temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(entries));temporary.replace(path)
