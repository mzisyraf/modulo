#!/usr/bin/env bash
# Run as root after copying the release archive and approved private files.
set -euo pipefail
release=/opt/modulo/releases/ee19a8d
uv=/opt/modulo-tools/venv/bin/uv
export UV_PYTHON_INSTALL_DIR=/opt/modulo-tools/python

test -f /opt/modulo/modulo-release.tar
test -f /etc/modulo/provider.env
test -f /etc/modulo/modal.toml
test -f /etc/modulo/judge-password
test ! -e "$release"
install -d -m 755 "$release"
tar -xf /opt/modulo/modulo-release.tar -C "$release"
"$uv" venv --python 3.12 /opt/modulo/runtime/api
"$uv" pip install --python /opt/modulo/runtime/api/bin/python -r "$release/services/api/requirements-lock.txt"
"$uv" venv --python 3.12 /opt/modulo/runtime/modal
"$uv" pip install --python /opt/modulo/runtime/modal/bin/python -r "$release/tools/modal/requirements-lock.txt"
ln -s /opt/modulo/runtime/api "$release/services/api/.venv"
ln -s /opt/modulo/runtime/modal "$release/tools/modal/.venv"
ln -s /var/lib/modulo "$release/data"
ln -s "$release" /opt/modulo/current
install -d -o modulo -g modulo -m 750 /var/lib/modulo/preset-inference
install -o modulo -g modulo -m 600 /etc/modulo/budget.json /var/lib/modulo/preset-inference/budget.json
chown root:modulo /etc/modulo
chmod 750 /etc/modulo
chown root:root /etc/modulo/provider.env
chmod 600 /etc/modulo/provider.env
chown root:modulo /etc/modulo/modal.toml
chmod 640 /etc/modulo/modal.toml
{ printf 'judge:'; openssl passwd -6 -stdin < /etc/modulo/judge-password; } > /etc/modulo/htpasswd
chown root:www-data /etc/modulo/htpasswd
chmod 640 /etc/modulo/htpasswd
# Nginx needs to traverse the directory to read only its own password file.
chmod 751 /etc/modulo
rm -f /etc/modulo/judge-password /etc/modulo/budget.json
install -m 644 "$release/deploy/cloud-vm/modulo.service" /etc/systemd/system/modulo.service
systemctl daemon-reload
systemctl enable --now modulo.service
for attempt in $(seq 1 20); do
    if curl --fail --silent http://127.0.0.1:8123/api/health -H 'Host: localhost' > /var/lib/modulo/deployment-health.json; then
        echo 'modulo API healthy'
        exit 0
    fi
    sleep 1
done
echo 'modulo API startup failed; inspect journalctl -u modulo' >&2
exit 1
