"""Authenticate a catalog GET without making an inference request."""
import json
from pathlib import Path
import sys
import urllib.request

sys.path.insert(0, "/opt/modulo/current/services/api")
from app.preset_generation import NoRedirect

settings = {}
for line in Path("/etc/modulo/provider.env").read_text(encoding="utf-8-sig").splitlines():
    name, sep, value = line.strip().partition("=")
    if sep:
        settings[name] = value.strip().strip('"').strip("'")
request = urllib.request.Request("https://api.tokenfactory.nebius.com/v1/models",
    headers={"Authorization": "Bearer " + settings["NEBIUS_API_KEY"]})
with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as response:
    ids = {model["id"] for model in json.load(response)["data"]}
print(json.dumps({"authenticated": True,
    "nano_available": "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B" in ids,
    "super_available": "nvidia/nemotron-3-super-120b-a12b" in ids,
    "inference_requests": 0}))
