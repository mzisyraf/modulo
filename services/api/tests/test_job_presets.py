from copy import deepcopy
import json
from threading import Event
import time
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from app.jobs import JobError, JobStore
from app.main import create_app
from app.preset_generation import PresetError, PresetGenerator
from test_jobs import success, terminal, upload
from test_preset_generation import REFERENCE, response
from test_source_calibration import SOURCE


def test_source_identity_scopes_cached_presets_and_rejects_invalid_levels(preset_api):
    client, store, generator, calls = preset_api
    job_id, revision = confirmed_job(client)
    route = f"/api/jobs/{job_id}/preset"
    payload = {"reference_revision": revision, "source_calibration": SOURCE}
    assert client.post(route, json=payload).status_code == 202
    first = wait_generation(client, job_id)["generation"]
    assert first["source_calibration"] == SOURCE
    assert first["preset"]["parameters"]["input_gain_db"] == -2
    assert client.post(route, json=payload).json()["request_id"] == first["request_id"]
    assert len(calls) == 1
    changed = {**SOURCE, "id": "b" * 64, "rms_dbfs": -30.0, "peak_dbfs": -12.0}
    assert client.post(route, json={**payload, "source_calibration": changed}).status_code == 202
    second = wait_generation(client, job_id)["generation"]
    assert second["request_id"] != first["request_id"]
    assert second["preset"]["parameters"]["input_gain_db"] == 6
    assert len(calls) == 2
    assert client.post(route, json={**payload, "source_calibration": {**SOURCE, "clipped_fraction": .1}}).status_code == 422
    assert len(calls) == 2
    persisted = json.loads((store.directory(job_id) / "state.json").read_text())
    assert persisted["generation"]["source_calibration"] == changed


def test_changed_source_cannot_start_another_inflight_request(preset_api):
    client, store, generator, calls = preset_api
    job_id, revision = confirmed_job(client)
    entered, release = Event(), Event()
    def delayed(_key, payload):
        calls.append(payload); entered.set()
        assert release.wait(10)
        return response()
    generator.transport = delayed
    route = f"/api/jobs/{job_id}/preset"
    payload = {"reference_revision": revision, "source_calibration": SOURCE}
    try:
        first = client.post(route, json=payload).json()
        assert entered.wait(1)
        assert client.post(route, json=payload).json()["request_id"] == first["request_id"]
        assert client.post(route, json={**payload, "source_calibration": {**SOURCE, "id": "b" * 64}}).status_code == 409
        assert len(calls) == 1
    finally:
        release.set()
    assert wait_generation(client, job_id)["generation"]["source_calibration"] == SOURCE


@pytest.fixture
def preset_api(tmp_path, monkeypatch):
    calls = []
    generator = PresetGenerator(tmp_path / "budget", key="test-only", budget_usd="0.10", max_requests=3,
        transport=lambda _key, payload: calls.append(deepcopy(payload)) or response())
    store = JobStore(tmp_path / "jobs")
    monkeypatch.setattr(store, "run_worker", success)
    with TestClient(create_app(store, generator), base_url="http://127.0.0.1") as client:
        yield client, store, generator, calls


def confirmed_job(client):
    job_id = upload(client).json()["job_id"]
    assert terminal(client, job_id)["status"] == "ready"
    assert client.post(f"/api/jobs/{job_id}/reference", json={"start_seconds": 0, "end_seconds": 10}).status_code == 200
    return job_id, client.get(f"/api/jobs/{job_id}").json()["result"]["reference_revision"]


def wait_generation(client, job_id):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job.get("generation", {}).get("status") in {"ready", "failed"}:
            return job
        time.sleep(0.01)
    pytest.fail("Generation did not reach a terminal state.")


def test_generation_uses_confirmed_server_metrics_and_caches_exact_revision(preset_api):
    client, store, _generator, calls = preset_api
    job_id, revision = confirmed_job(client)
    payload = {"reference_revision": revision}
    assert client.post(f"/api/jobs/{job_id}/preset", json=payload).status_code == 202
    job = wait_generation(client, job_id)
    preset = job["generation"]["preset"]
    assert preset["provenance"]["kind"] == "generated"
    assert {"source_calibration_missing", "target_energy_only", "tone_matching_unverified"} <= set(preset["quality_flags"])
    assert "Uncalibrated" in preset["description"]
    assert client.post(f"/api/jobs/{job_id}/preset", json=payload).json()["preset"] == preset
    assert len(calls) == 1
    supplied = json.loads(calls[0]["messages"][1]["content"])
    assert supplied["target_metrics"] == job["result"]["reference"]["metrics"]
    assert client.get(job["result"]["artifacts"]["guitar"]).status_code == 200
    assert client.post(f"/api/jobs/{job_id}/reference", json={"start_seconds": 0, "end_seconds": 10}).status_code == 200
    changed = store.get(job_id)
    assert changed["result"]["reference_revision"] == revision + 1
    assert "generation" not in changed
    assert client.post(f"/api/jobs/{job_id}/preset", json=payload).status_code == 409


def test_missing_reference_expiry_and_client_features_never_call_provider(preset_api):
    client, store, _generator, calls = preset_api
    job_id = upload(client).json()["job_id"]
    terminal(client, job_id)
    route = f"/api/jobs/{job_id}/preset"
    assert client.post(route, json={"reference_revision": 0}).json()["error"]["code"] == "reference_required"
    assert client.post(route, json={"reference_revision": 0, "metrics": REFERENCE["metrics"]}).status_code == 422
    assert client.post(route, json={"reference_revision": True}).status_code == 422
    assert client.post(f"/api/jobs/{uuid4()}/preset", json={"reference_revision": 0}).status_code == 404
    store.jobs[job_id]["expires_at"] = time.time() - 1
    assert client.post(route, json={"reference_revision": 0}).status_code == 404
    assert calls == []


def test_default_disabled_generation_keeps_successful_separation(preset_api):
    client, store, generator, calls = preset_api
    job_id, revision = confirmed_job(client)
    generator.max_requests = 0
    assert client.get("/api/health").json()["preset_generation_available"] is False
    request = client.post(f"/api/jobs/{job_id}/preset", json={"reference_revision": revision})
    assert request.status_code == 503 and request.json()["error"]["code"] == "generation_disabled"
    job = store.get(job_id)
    assert job["status"] == "ready" and "generation" not in job
    assert client.get(job["result"]["artifacts"]["backing"]).status_code == 200
    assert calls == [] and not (generator.directory / "budget.json").exists()


def test_duplicate_inflight_and_changed_reference_discard_late_preset(preset_api):
    client, store, generator, calls = preset_api
    job_id, revision = confirmed_job(client)
    entered, release = Event(), Event()

    def delayed(_key, payload):
        calls.append(payload)
        entered.set()
        if not release.wait(10):
            raise PresetError("test_timeout", "Test did not release transport.")
        return response()

    generator.transport = delayed
    route = f"/api/jobs/{job_id}/preset"
    first = client.post(route, json={"reference_revision": revision}).json()
    try:
        assert entered.wait(1)
        duplicate = client.post(route, json={"reference_revision": revision}).json()
        assert duplicate["request_id"] == first["request_id"] and len(calls) == 1
        assert client.get("/api/health").status_code == 200
        assert client.post(f"/api/jobs/{job_id}/reference", json={"start_seconds": 1, "end_seconds": 11}).status_code == 200
        assert "generation" not in store.get(job_id)
        assert client.post(route, json={"reference_revision": revision + 1}).status_code == 409
    finally:
        release.set()
    deadline = time.monotonic() + 2
    while store.preset_running and time.monotonic() < deadline:
        time.sleep(0.01)
    assert not store.preset_running and "generation" not in store.get(job_id)
    assert len(calls) == 1
    assert json.loads((generator.directory / "budget.json").read_text())["attempts"] == 1


@pytest.mark.parametrize("kind", ["invalid", "timeout"])
def test_provider_failure_is_separate_and_retry_is_deliberate(preset_api, kind):
    client, store, generator, calls = preset_api
    job_id, revision = confirmed_job(client)

    def broken(_key, _payload):
        calls.append(1)
        if kind == "timeout":
            raise PresetError("provider_unavailable", "Provider timed out; the attempt may be billed.")
        return {"model": "incorrect", "choices": []}

    generator.transport = broken
    route = f"/api/jobs/{job_id}/preset"
    assert client.post(route, json={"reference_revision": revision}).status_code == 202
    failed = wait_generation(client, job_id)
    assert failed["status"] == "ready" and failed["generation"]["status"] == "failed"
    assert "preset" not in failed["generation"] and len(calls) == 1
    assert client.get(failed["result"]["artifacts"]["guitar"]).status_code == 200
    generator.transport = lambda *_: calls.append(1) or response()
    assert client.post(route, json={"reference_revision": revision}).status_code == 202
    assert wait_generation(client, job_id)["generation"]["status"] == "ready"
    assert len(calls) == 2


def test_generation_pins_retained_files_until_completion(preset_api):
    client, store, generator, _calls = preset_api
    job_id, revision = confirmed_job(client)
    entered, release = Event(), Event()

    def delayed(*_):
        entered.set()
        if not release.wait(5):
            raise PresetError("test_timeout", "Test did not release transport.")
        return response()

    generator.transport = delayed
    client.post(f"/api/jobs/{job_id}/preset", json={"reference_revision": revision})
    try:
        assert entered.wait(1)
        for _ in range(4):
            new_job, _ = store.reserve(str(uuid4()))
            store.fail(new_job["job_id"], JobError("test_only", "Synthetic terminal job."))
        assert store.directory(job_id).exists() and job_id in store.jobs
        store.jobs[job_id]["expires_at"] = time.time() - 1
        assert client.get(f"/api/jobs/{job_id}").status_code == 404
        assert store.directory(job_id).exists()
    finally:
        release.set()


def test_restart_fails_generation_without_resetting_ledger(tmp_path, monkeypatch):
    generator = PresetGenerator(tmp_path / "budget", key="test", budget_usd="0.10", max_requests=1, transport=lambda *_: response())
    generator.generate(REFERENCE)
    first = JobStore(tmp_path / "jobs")
    monkeypatch.setattr(first, "run_worker", success)
    with TestClient(create_app(first, generator), base_url="http://127.0.0.1") as client:
        job_id, revision = confirmed_job(client)
        first.jobs[job_id]["generation"] = {"request_id": str(uuid4()), "reference_revision": revision, "status": "generating"}
        first.save(first.jobs[job_id])
    with TestClient(create_app(JobStore(tmp_path / "jobs"), generator), base_url="http://127.0.0.1") as client:
        job = client.get(f"/api/jobs/{job_id}").json()
        assert job["status"] == "ready"
        assert job["generation"]["error"]["code"] == "generation_interrupted"
        assert json.loads((generator.directory / "budget.json").read_text())["attempts"] == 1


def test_bad_provider_configuration_does_not_break_separation(tmp_path, monkeypatch):
    monkeypatch.setattr(PresetGenerator, "from_env", lambda: (_ for _ in ()).throw(PresetError("provider_configuration", "Review the provider settings.")))
    store = JobStore(tmp_path / "jobs")
    monkeypatch.setattr(store, "run_worker", success)
    with TestClient(create_app(store), base_url="http://127.0.0.1") as client:
        assert client.get("/api/health").json()["preset_generation_available"] is False
        job_id, revision = confirmed_job(client)
        assert client.post(f"/api/jobs/{job_id}/preset", json={"reference_revision": revision}).json()["error"]["code"] == "provider_configuration"
        assert client.get(f"/api/jobs/{job_id}").json()["status"] == "ready"


@pytest.mark.parametrize("invalidate", ["changed", "expired"])
def test_queued_stale_generation_never_reserves_or_calls_provider(preset_api, invalidate):
    client, store, generator, calls = preset_api
    first, first_revision = confirmed_job(client)
    second, second_revision = confirmed_job(client)
    entered, release = Event(), Event()

    def delayed(_key, payload):
        calls.append(payload)
        entered.set()
        if not release.wait(10):
            raise PresetError("test_timeout", "Test did not release transport.")
        return response()

    generator.transport = delayed
    client.post(f"/api/jobs/{first}/preset", json={"reference_revision": first_revision})
    try:
        assert entered.wait(1)
        client.post(f"/api/jobs/{second}/preset", json={"reference_revision": second_revision})
        if invalidate == "changed":
            client.post(f"/api/jobs/{second}/reference", json={"start_seconds": 1, "end_seconds": 11})
        else:
            store.jobs[second]["expires_at"] = time.time() - 1
    finally:
        release.set()
    deadline = time.monotonic() + 2
    while store.preset_running and time.monotonic() < deadline:
        time.sleep(0.01)
    assert not store.preset_running and len(calls) == 1
    assert json.loads((generator.directory / "budget.json").read_text())["attempts"] == 1


def test_unsaved_generated_preset_never_appears_successful(preset_api, monkeypatch):
    client, store, generator, _calls = preset_api
    job_id, revision = confirmed_job(client)
    original_save = store.save

    def disk_full(job):
        if job.get("generation", {}).get("status") == "ready":
            raise OSError("Disk full while saving generation")
        original_save(job)

    monkeypatch.setattr(store, "save", disk_full)
    assert client.post(f"/api/jobs/{job_id}/preset", json={"reference_revision": revision}).status_code == 202
    job = wait_generation(client, job_id)
    assert job["status"] == "ready"
    assert job["generation"]["error"]["code"] == "generation_storage_failed"
    assert "preset" not in job["generation"]
    assert json.loads((generator.directory / "budget.json").read_text())["attempts"] == 1
