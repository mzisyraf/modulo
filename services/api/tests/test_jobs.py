from array import array
import json
import math
import subprocess
from threading import Event
import time
from uuid import uuid4
import wave

from fastapi.testclient import TestClient
import pytest

from app.jobs import JobError, JobStore
from app.main import create_app


def write_audio(path, seconds=12, silent=False):
    rate = 44100
    second = array("h", [0 if silent else int(5000 * math.sin(2 * math.pi * 220 * index / rate)) for index in range(rate) for _ in range(2)])
    with wave.open(str(path), "wb") as audio:
        audio.setparams((2, 2, rate, 0, "NONE", "not compressed"))
        for _ in range(seconds):
            audio.writeframes(second.tobytes())


def success(directory):
    for name in ("mix", "guitar", "backing"):
        write_audio(directory / f"{name}.wav")
    (directory / "result.json").write_text(json.dumps({"device": "synthetic test GPU", "common_gain_linear": 0.9}))


def test_reference_options_for_existing_job_cache_and_confirmation(local_api, monkeypatch):
    client, store = local_api
    job_id = upload(client).json()["job_id"]
    assert terminal(client, job_id)["status"] == "ready"
    response = client.get(f"/api/jobs/{job_id}/references")
    assert response.status_code == 200
    result = response.json()
    assert result["method"] == "signal_contrast_v1" and len(result["options"]) == 1
    assert len(json.dumps(result)) < 65536
    assert client.get(f"/api/jobs/{job_id}").json()["result"]["reference"] is None
    monkeypatch.setattr("app.jobs.reference_options", lambda *_: pytest.fail("Cached waveforms should not reread audio"))
    assert client.get(f"/api/jobs/{job_id}/references").json() == result
    assert client.post(f"/api/jobs/{job_id}/reference", json={"start_seconds": 0, "end_seconds": 10}).status_code == 200
    assert client.get(f"/api/jobs/{job_id}").json()["result"]["reference_revision"] == 1
    store.remove(job_id)
    assert job_id not in store.reference_cache
    assert client.get(f"/api/jobs/{job_id}/references").status_code == 404


def test_empty_locked_directory_does_not_keep_an_evicted_job(local_api, monkeypatch):
    client, store = local_api
    job_id = upload(client).json()["job_id"]
    assert terminal(client, job_id)["status"] == "ready"
    directory = store.directory(job_id)
    for path in directory.iterdir():
        path.unlink()
    monkeypatch.setattr("app.jobs.shutil.rmtree", lambda *_: (_ for _ in ()).throw(PermissionError("Windows directory lock")))
    store.remove(job_id)
    assert job_id not in store.jobs and directory.exists()
    next_job, created = store.reserve(str(uuid4()))
    assert created and next_job["job_id"] != job_id
    store.recover()  # An empty locked remnant does not prevent API restart.
    assert job_id not in store.jobs


def test_locked_directory_with_audio_still_blocks_eviction(local_api, monkeypatch):
    client, store = local_api
    job_id = upload(client).json()["job_id"]
    assert terminal(client, job_id)["status"] == "ready"
    monkeypatch.setattr("app.jobs.shutil.rmtree", lambda *_: (_ for _ in ()).throw(PermissionError("Open audio")))
    with pytest.raises(JobError) as failure:
        store.remove(job_id)
    assert failure.value.code == "storage_busy" and job_id in store.jobs
    assert (store.directory(job_id) / "guitar.wav").exists()


def test_reference_options_reject_pending_and_damaged_artifacts(local_api):
    client, store = local_api
    pending, _ = store.reserve(str(uuid4()))
    assert client.get(f"/api/jobs/{pending['job_id']}/references").status_code == 409
    store.fail(pending["job_id"], JobError("test", "TEST ONLY"))
    job_id = upload(client).json()["job_id"]
    assert terminal(client, job_id)["status"] == "ready"
    (store.directory(job_id) / "guitar.wav").write_bytes(b"broken")
    response = client.get(f"/api/jobs/{job_id}/references")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "reference_analysis_failed"
    assert client.get(f"/api/jobs/{job_id}").json()["status"] == "ready"


def test_waveform_scan_does_not_block_status_or_duplicate_work(local_api, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from app.reference import reference_options
    client, store = local_api
    job_id = upload(client).json()["job_id"]
    assert terminal(client, job_id)["status"] == "ready"
    entered, release = Event(), Event()
    calls = []

    def delayed(*paths):
        calls.append(1); entered.set()
        assert release.wait(10)
        return reference_options(*paths)

    monkeypatch.setattr("app.jobs.reference_options", delayed)
    with ThreadPoolExecutor(max_workers=2) as requests:
        first = requests.submit(client.get, f"/api/jobs/{job_id}/references")
        try:
            assert entered.wait(2)
            second = requests.submit(client.get, f"/api/jobs/{job_id}/references")
            assert client.get(f"/api/jobs/{job_id}").json()["status"] == "ready"
            for _ in range(4):
                extra, _ = store.reserve(str(uuid4()))
                store.fail(extra["job_id"], JobError("test", "TEST ONLY"))
            assert store.directory(job_id).exists()
        finally:
            release.set()
        assert first.result().status_code == second.result().status_code == 200
    assert calls == [1] and not store.reference_pending


@pytest.fixture
def local_api(tmp_path, monkeypatch):
    store = JobStore(tmp_path / "jobs")
    monkeypatch.setattr(store, "run_worker", success)
    with TestClient(create_app(store), base_url="http://127.0.0.1") as client:
        yield client, store


def upload(client, key=None, body=b"test worker supplies synthetic outputs", **headers):
    return client.post("/api/jobs", content=body, headers={
        "content-type": "audio/wav", "idempotency-key": key or str(uuid4()), **headers,
    })


def terminal(client, job_id):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in {"ready", "failed"}:
            return job
        time.sleep(0.01)
    pytest.fail("Background job did not finish within five seconds.")


def test_real_http_lifecycle_duplicate_and_reference(local_api, monkeypatch):
    client, store = local_api
    entered, release = Event(), Event()

    def controlled_worker(directory):
        entered.set()
        if not release.wait(3):
            raise RuntimeError("Test did not release the worker.")
        success(directory)

    monkeypatch.setattr(store, "run_worker", controlled_worker)
    key = str(uuid4())
    response = upload(client, key)
    assert response.status_code == 202
    job_id = response.json()["job_id"]
    try:
        assert entered.wait(1)
        assert client.get(f"/api/jobs/{job_id}").json()["status"] == "running"
        assert client.get("/api/health").status_code == 200
        assert upload(client, key).json()["job_id"] == job_id
        assert len(store.jobs) == 1
        assert upload(client).status_code == 429
        assert client.get(f"/api/jobs/{job_id}/audio/guitar").status_code == 409
        assert client.post(f"/api/jobs/{job_id}/reference", json={"start_seconds": 0, "end_seconds": 10}).status_code == 409
    finally:
        release.set()
    job = terminal(client, job_id)
    assert job["status"] == "ready"
    assert job["result"]["reference"] is None
    assert job["result"]["provenance"]["kind"] == "local_separation"
    assert "preset" not in job["result"] and "idempotency_key" not in job
    assert not (store.directory(job_id) / "source.bin").exists()
    guitar_url = job["result"]["artifacts"]["guitar"]
    response = client.get(guitar_url, headers={"range": "bytes=0-43"})
    assert response.status_code == 206 and len(response.content) == 44
    assert response.content[:4] == b"RIFF"
    confirmed = client.post(f"/api/jobs/{job_id}/reference", json={"start_seconds": 1, "end_seconds": 11})
    assert confirmed.status_code == 200
    assert confirmed.json()["method"] == "manual_interval_v1"
    assert "separation_quality_unverified" in confirmed.json()["quality_flags"]
    assert client.get(f"/api/jobs/{job_id}").json()["result"]["reference"] == confirmed.json()


@pytest.mark.parametrize("headers,body,status", [
    ({"content-type": "text/plain"}, b"audio", 415),
    ({"content-length": str(50 * 1024 * 1024 + 1)}, b"audio", 413),
    ({"content-length": "-1"}, b"audio", 400),
    ({}, b"", 400),
    ({"idempotency-key": "../../elsewhere"}, b"audio", 400),
    ({"origin": "https://attacker.example"}, b"audio", 403),
])
def test_rejects_upload_boundaries_without_work(local_api, headers, body, status):
    client, store = local_api
    assert upload(client, body=body, **headers).status_code == status
    assert not store.jobs


def test_streaming_upload_limit_and_incomplete_upload(local_api, monkeypatch):
    client, store = local_api
    monkeypatch.setattr("app.main.MAX_UPLOAD_BYTES", 4)
    response = client.post("/api/jobs", content=iter([b"123", b"456"]), headers={
        "content-type": "audio/wav", "idempotency-key": str(uuid4()),
    })
    assert response.status_code == 413
    assert next(iter(store.jobs.values()))["status"] == "failed"
    assert not list(store.root.glob("*/source.bin"))


@pytest.mark.parametrize("interval", [
    {"start_seconds": 0.0, "end_seconds": 10}, {"start_seconds": True, "end_seconds": 10},
    {"start_seconds": 0, "end_seconds": 9}, {"start_seconds": 3, "end_seconds": 13},
    {"start_seconds": 0, "end_seconds": 10, "path": "/private.wav"},
])
def test_reference_rejects_invalid_changed_intervals(local_api, interval):
    client, _store = local_api
    job_id = upload(client).json()["job_id"]
    terminal(client, job_id)
    assert client.post(f"/api/jobs/{job_id}/reference", json=interval).status_code == 422
    assert client.get(f"/api/jobs/{job_id}").json()["result"]["reference"] is None


@pytest.mark.parametrize("failure", [
    JobError("invalid_audio", "Undecodable audio."),
    JobError("separation_timeout", "Timed out.", retryable=True),
    RuntimeError("Private internal exception must not reach the browser."),
])
def test_worker_failures_hide_artifacts_and_internal_errors(local_api, monkeypatch, failure):
    client, store = local_api

    def broken(directory):
        (directory / "guitar.wav").write_bytes(b"partial")
        raise failure

    monkeypatch.setattr(store, "run_worker", broken)
    job_id = upload(client).json()["job_id"]
    job = terminal(client, job_id)
    assert job["status"] == "failed" and "result" not in job
    assert "Private" not in job["error"]["message"]
    assert not (store.directory(job_id) / "guitar.wav").exists()
    assert client.get(f"/api/jobs/{job_id}/audio/guitar").status_code == 409


def test_zero_exit_missing_output_is_failure(local_api, monkeypatch):
    client, store = local_api
    monkeypatch.setattr(store, "run_worker", lambda _directory: None)
    job_id = upload(client).json()["job_id"]
    assert terminal(client, job_id)["status"] == "failed"


def test_artifact_and_host_protection(local_api):
    client, _store = local_api
    job_id = upload(client).json()["job_id"]
    terminal(client, job_id)
    assert client.get(f"/api/jobs/{job_id}/audio/source.bin").status_code == 404
    assert client.get(f"/api/jobs/{job_id}/audio/state.json").status_code == 404
    assert client.get("/api/jobs/not-a-uuid").status_code == 400
    assert client.get(f"/api/jobs/{uuid4()}").status_code == 404
    assert client.get("/api/health", headers={"host": "attacker.example"}).status_code == 400


def test_restart_marks_interrupted_jobs_failed_and_enforces_single_service(tmp_path):
    root = tmp_path / "jobs"
    first = JobStore(root)
    first.start()
    job, _ = first.reserve(str(uuid4()))
    with pytest.raises(RuntimeError, match="Another local API"):
        JobStore(root).start()
    first.close()
    restarted = JobStore(root)
    restarted.start()
    try:
        result = restarted.get(job["job_id"])
        assert result["status"] == "failed" and result["error"]["code"] == "interrupted"
        assert "result" not in result
    finally:
        restarted.close()


def test_retention_and_job_count_are_bounded(local_api):
    client, store = local_api
    identifiers = []
    for _ in range(5):
        job_id = upload(client).json()["job_id"]
        terminal(client, job_id)
        identifiers.append(job_id)
    assert len(store.jobs) == 4
    assert client.get(f"/api/jobs/{identifiers[0]}").status_code == 404
    assert not store.directory(identifiers[0]).exists()
    with store.lock:
        store.jobs[identifiers[1]]["expires_at"] = time.time() - 1
    assert client.get(f"/api/jobs/{identifiers[1]}").status_code == 404
    assert not store.directory(identifiers[1]).exists()


def test_worker_subprocess_timeout_is_actionable(tmp_path, monkeypatch):
    store = JobStore(tmp_path)

    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired(args[0], kwargs["timeout"])

    monkeypatch.setattr(subprocess, "run", timeout)
    with pytest.raises(JobError) as error:
        store.run_worker(tmp_path)
    assert error.value.code == "separation_timeout" and error.value.retryable


def test_failed_job_retries_as_new_job_without_stale_artifacts(local_api, monkeypatch):
    client, store = local_api

    def broken(_directory):
        raise JobError("invalid_audio", "Undecodable audio.")

    monkeypatch.setattr(store, "run_worker", broken)
    first = upload(client).json()["job_id"]
    assert terminal(client, first)["status"] == "failed"
    monkeypatch.setattr(store, "run_worker", success)
    second = upload(client).json()["job_id"]
    assert second != first
    assert terminal(client, second)["status"] == "ready"
    assert store.get(first)["status"] == "failed"


def test_corrupt_job_cleanup_is_scoped_to_server_uuid_directories(tmp_path):
    root = tmp_path / "jobs"
    corrupt = root / str(uuid4())
    corrupt.mkdir(parents=True)
    (corrupt / "source.bin").write_bytes(b"interrupted upload")
    unrelated = root / "keep-me"
    unrelated.mkdir()
    (unrelated / "notes.txt").write_text("not a server job")
    store = JobStore(root)
    store.start()
    try:
        assert not corrupt.exists()
        assert (unrelated / "notes.txt").read_text() == "not a server job"
        assert store.jobs == {}
    finally:
        store.close()


def test_expired_open_file_is_unavailable_until_cleanup_can_retry(local_api, monkeypatch):
    client, store = local_api
    job_id = upload(client).json()["job_id"]
    terminal(client, job_id)
    store.jobs[job_id]["expires_at"] = time.time() - 1

    def still_open(_path):
        raise PermissionError("Windows is still serving this file")

    with monkeypatch.context() as patch:
        patch.setattr("app.jobs.shutil.rmtree", still_open)
        assert client.get(f"/api/jobs/{job_id}").status_code == 404
        assert store.directory(job_id).exists()
    store.prune()
    assert not store.directory(job_id).exists()


def test_modal_job_routes_remotely_and_preserves_provenance(local_api, monkeypatch):
    client, store = local_api
    monkeypatch.setattr(store, 'run_worker', lambda _: pytest.fail('No local GPU fallback'))
    def cloud(directory):
        success(directory)
        report = {'device': 'TEST ONLY cloud GPU', 'common_gain_linear': .9,
                  'provider': 'modal', 'model': 'htdemucs_6s'}
        (directory / 'result.json').write_text(json.dumps(report))
    monkeypatch.setattr(store, 'run_modal_worker', cloud)
    key = str(uuid4())
    response = upload(client, key=key, **{'x-separation-backend': 'modal'})
    assert response.status_code == 202
    job = terminal(client, response.json()['job_id'])
    assert job['backend'] == 'modal' and job['status'] == 'ready'
    assert job['result']['provenance']['kind'] == 'cloud_separation'
    assert job['result']['provenance']['provider'] == 'modal'
    assert upload(client, key=key).status_code == 409
    assert upload(client, key=key, **{'x-separation-backend': 'modal'}).json()['job_id'] == job['job_id']


def test_backend_validation_and_cloud_failure_do_not_fall_back(local_api, monkeypatch):
    client, store = local_api
    assert upload(client, **{'x-separation-backend': 'invented'}).status_code == 400
    assert not store.jobs
    def broken(_):
        raise JobError('cloud_failed', 'TEST ONLY credentials unavailable', 502)
    monkeypatch.setattr(store, 'run_modal_worker', broken)
    monkeypatch.setattr(store, 'run_worker', lambda _: pytest.fail('No local GPU fallback'))
    response = upload(client, **{'x-separation-backend': 'modal'})
    job = terminal(client, response.json()['job_id'])
    assert job['status'] == 'failed' and job['backend'] == 'modal'
    assert job['error']['code'] == 'cloud_failed'


def test_cloud_timeout_attempts_remote_cancellation(tmp_path, monkeypatch):
    store = JobStore(tmp_path)
    monkeypatch.setattr('app.jobs.Path.is_file', lambda _: True)
    calls = []
    def timeout_then_cancel(command, **kwargs):
        calls.append(command)
        if len(calls) == 1:
            raise subprocess.TimeoutExpired(command, kwargs['timeout'])
        return subprocess.CompletedProcess(command, 0)
    monkeypatch.setattr('app.jobs.subprocess.run', timeout_then_cancel)
    with pytest.raises(JobError) as error:
        store.run_modal_worker(tmp_path)
    assert error.value.code == 'cloud_timeout'
    assert calls[0][-2] == str(tmp_path / 'source.bin')
    assert calls[1][-2:] == ['--cancel', str(tmp_path)]
