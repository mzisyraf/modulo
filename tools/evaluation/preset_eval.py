"""Prepare a paired benchmark, or explicitly request cached Nemotron proposals. No DSP copy."""
import argparse
from array import array
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import wave
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import re
import secrets

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "api"))
from app.source_calibration import SourceCalibration, baseline_gain
from app.tone_features import tone_features


def write(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf-8")
    temporary.replace(path)


def engine_hash():
    return hashlib.sha256(b"".join((ROOT / "packages/audio/src" / name).read_bytes() for name in ["index.ts", "dsp.ts"])).hexdigest()


def evaluation_hash():
    paths=["tools/evaluation/metrics.mjs","apps/web/src/audioFeatures.ts","apps/web/src/refinePreset.ts"]
    return hashlib.sha256(b"".join((ROOT/name).read_bytes() for name in paths)).hexdigest()


def prepare(source, output):
    with wave.open(str(source)) as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != 44100 or audio.getnframes() < 44100 * 18:
            raise ValueError("Use at least 18 seconds of mono PCM16 WAV at 44.1 kHz, <=20 MiB (15s calibration plus >=3s held out).")
        if source.stat().st_size > 20 * 1024 * 1024:
            raise ValueError("Source exceeds 20 MiB.")
        data = audio.readframes(44100 * 15)
        validation_data = audio.readframes(44100 * 15)
        if len(data) != 44100*15*2: raise ValueError("Truncated source WAV")
    samples = array("h"); samples.frombytes(data)
    if sys.byteorder != "little": samples.byteswap()
    rms = math.sqrt(sum(x*x for x in samples) / len(samples)) / 32768
    peak = max(map(abs, samples)) / 32768
    if min(rms, peak) <= 0: raise ValueError("Silent source")
    source_features = SourceCalibration.model_validate({"id": hashlib.sha256(data).hexdigest(), "method": "browser_level_v1",
        "duration_seconds": 15.0, "rms_dbfs": 20*math.log10(rms), "peak_dbfs": 20*math.log10(peak),
        "clipped_fraction": sum(abs(x) >= 32760 for x in samples) / len(samples),
        "tone_features":tone_features([x/32768 for x in samples],44100)}).model_dump(exclude_none=True)
    output.mkdir(parents=True, exist_ok=False)
    with wave.open(str(output / "input.wav"), "wb") as audio:
        audio.setparams((1, 2, 44100, len(samples), "NONE", "not compressed")); audio.writeframes(data)
    baseline = {"input_gain_db": baseline_gain(source_features), "drive": 0, "bass_db": 0, "mid_db": 0, "treble_db": 0, "master_gain_db": -12}
    config = {"version": 1, "output_dir": str(output), "source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "engine_sha256": engine_hash(), "evaluation_sha256":evaluation_hash(), "source_sha256": hashlib.sha256((output / "input.wav").read_bytes()).hexdigest(),
        "source_calibration": source_features, "baseline": baseline, "cases": [
            {"id": "eq", "target_parameters": {**baseline, "bass_db": 6, "mid_db": -7, "treble_db": 8}},
            {"id": "drive", "target_parameters": {**baseline, "drive": .45, "bass_db": -5, "mid_db": 5, "treble_db": -4, "master_gain_db": -18}}]}
    if len(validation_data) >= 44100*3*2:
        with wave.open(str(output / "validation.wav"), "wb") as audio:
            audio.setparams((1,2,44100,len(validation_data)//2,"NONE","not compressed"));audio.writeframes(validation_data)
        config["validation_sha256"] = hashlib.sha256((output / "validation.wav").read_bytes()).hexdigest()
    attribution = source.parent / "ATTRIBUTION.txt"
    if attribution.is_file(): (output / "ATTRIBUTION.txt").write_text(attribution.read_text(encoding="utf-8") + "\nBenchmark change: first 15 seconds only.\n", encoding="utf-8")
    write(output / "config.json", config)
    print(f"Prepared {output}. Serve it on loopback port 5175, then run tools/verification/preset-quality.browser.js.")


def propose(output):
    from app.preset_generation import PresetGenerator
    config = json.loads((output / "config.json").read_text(encoding="utf-8"))
    report = json.loads((output / "report.json").read_text(encoding="utf-8"))
    if config["engine_sha256"] != engine_hash() or report["engine_sha256"] != config["engine_sha256"] or report["source_sha256"] != config["source_sha256"]:
        raise ValueError("Engine/source changed; rerender before requesting proposals.")
    provider = PresetGenerator.from_env()
    for case in config["cases"]:
        if case["id"] not in {"eq","drive"}: raise ValueError("Unknown benchmark case")
        if "candidate" in case: continue
        if "candidate_error" in case: raise ValueError("Previous request failed; inspect its saved error before deliberately preparing a new run.")
        target = next(row for row in report["cases"] if row["id"] == case["id"])
        reference = {"start_seconds": 0, "end_seconds": 15, "quality_flags": ["controlled_same_performance_target", "not_separated_song"],
                     "metrics": target["target_metrics"]}
        if config["source_calibration"].get("tone_features"):
            reference["tone_features"] = target["target_tone_features"]
        try:
            # Explicit --generate only; the normal budget ledger and no-retry transport remain authoritative.
            case["candidate"] = provider.generate(reference, config["source_calibration"])
            write(output / f"{case['id']}-candidate.json", case["candidate"])
        except Exception as failure:
            case["candidate_error"] = {"code": getattr(failure, "code", "proposal_failed"), "message": "Proposal failed; inspect local configuration/allowance. No automatic retry."}
            write(output / "config.json", config)
            raise
        write(output / "config.json", config)
        print(f"Saved real Nemotron proposal: {case['id']}")


def serve(output):
    token = secrets.token_hex(24)
    origin = "http://127.0.0.1:5173"
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs): super().__init__(*args, directory=str(output), **kwargs)
        def end_headers(self):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Cache-Control", "no-store")
            super().end_headers()
        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Eval-Token")
            self.end_headers()
        def do_GET(self):
            if self.path == "/session":
                data = json.dumps({"token": token}).encode()
                self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(data)
            else: super().do_GET()
        def do_POST(self):
            if self.headers.get("Origin") != origin or self.headers.get("X-Eval-Token") != token:
                self.send_error(403); return
            name = self.path.removeprefix("/save/")
            if not self.path.startswith("/save/") or not re.fullmatch(r"report\.(json|html)|(eq|drive)(-heldout)?-(target|neutral|nemotron|refined)(-listen)?\.wav", name):
                self.send_error(400); return
            try: size = int(self.headers.get("Content-Length", "0"))
            except ValueError: size = 0
            if not 0 < size <= 2*1024*1024:
                self.send_error(413); return
            data = self.rfile.read(size)
            if len(data) != size: self.send_error(400); return
            temporary = output / (name + ".tmp")
            temporary.write_bytes(data); temporary.replace(output / name)
            self.send_response(204); self.end_headers()
    print(f"Benchmark receiver: http://127.0.0.1:5175/report.html", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 5175), Handler).serve_forever()


def verify(output):
    config = json.loads((output/"config.json").read_text(encoding="utf-8"))
    report = json.loads((output/"report.json").read_text(encoding="utf-8"))
    def better(candidate, baseline):
        values = [candidate['raw']['loss'],candidate['rms_matched']['loss'],baseline['raw']['loss'],baseline['rms_matched']['loss']]
        return all(math.isfinite(x) and x>=0 for x in values) and candidate['safe'] and values[0]<values[2] and values[1]<values[3]*.9
    def require(condition,message):
        if not condition: raise ValueError(message)
    require(report['engine_sha256']==config['engine_sha256']==engine_hash(),'Engine changed')
    require(report['evaluation_sha256']==config['evaluation_sha256']==evaluation_hash(),'Scorer or refinement changed')
    require(report['source_sha256']==hashlib.sha256((output/'input.wav').read_bytes()).hexdigest(),'Source changed')
    require(report['audible_contexts']==0 and report['paired_same_performance'] is True,'Render mode changed')
    require({x['id'] for x in report['cases']}=={'eq','drive'},'Missing benchmark cases')
    for case in report['cases']:
        require(case['oracle_raw_loss']<=1e-8 and case['wrong_raw_loss']>case['oracle_raw_loss'],'Scorer control failed')
        require(better(case['refinement']['metrics'],case['neutral']),f"{case['id']}: no verified calibration improvement")
        require(case['refined_improves_candidate'],f"{case['id']}: refinement did not beat raw proposal")
        held=case['held_out']
        require(held['not_used_for_refinement'] is True,'Held-out data was used for refinement')
        require(held['source_sha256']==hashlib.sha256((output/'validation.wav').read_bytes()).hexdigest(),'Held-out source changed')
        require(better(held['refined'],held['neutral']),f"{case['id']}: held-out regression")
        print(f"PASS {case['id']}: calibration + held-out improve neutral; refinement improves raw AI")
    print('Controlled quality gate PASS. Human listening and broader rig acceptance remain open.')


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "propose", "serve", "verify"])
    parser.add_argument("output", type=Path)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--generate", action="store_true", help="Explicitly authorize paid proposal requests; at most two in a fresh run")
    args = parser.parse_args()
    directory = args.output.resolve()
    if not directory.is_relative_to(ROOT / "data"):
        parser.error("Keep benchmark artifacts inside the ignored repository data directory.")
    if args.action == "prepare":
        if not args.source: parser.error("prepare requires --source")
        prepare(args.source, directory)
    elif args.action == "propose":
        if not args.generate: parser.error("propose requires explicit --generate; it can incur provider charges")
        propose(directory)
    elif args.action == "serve":
        serve(directory)
    else:
        verify(directory)
