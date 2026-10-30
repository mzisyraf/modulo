"""Read provider state without starting GPU work or reserving attempts."""
import json
import os

os.environ.setdefault("MODAL_CONFIG_PATH", "/etc/modulo/modal.toml")
import modal

for app, function, volume_name in (
    ("modulo-demucs", "separate", "modulo-demucs-jobs"),
    ("modulo-tabs", "transcribe", "modulo-tabs-jobs"),
):
    stats = modal.Function.from_name(app, function).get_current_stats()
    volume = modal.Volume.from_name(volume_name)
    attempts = json.loads(b"".join(volume.read_file("attempts.json")))
    # Tabs retains one job ID per attempt; Demucs stores just its count.
    if not isinstance(attempts, (int, list)):
        raise ValueError("Unrecognized reservation ledger")
    count = attempts if isinstance(attempts, int) else len(attempts)
    print(json.dumps({"app": app, "runners": stats.num_total_runners,
                      "backlog": stats.backlog, "attempts_recorded": count}))
