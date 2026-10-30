"""Refuse deployment while a persisted inference operation is in progress."""
import json
from pathlib import Path
for path in Path('/var/lib/modulo/jobs').glob('*/state.json'):
    state=json.loads(path.read_text())
    if state.get('status') in {'queued','running'} or state.get('generation',{}).get('status')=='generating':
        raise SystemExit('A song or rig request is active; wait before deployment')
for path in Path('/var/lib/modulo/jobs').glob('*/tabs-state.json'):
    if json.loads(path.read_text()).get('status') in {'queued','running','uploading','transcribing','arranging','downloading'}:
        raise SystemExit('A tab request is active; wait before deployment')
