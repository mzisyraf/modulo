#!/usr/bin/env bash
# Apply a tested quota-source snapshot while the parallel session finalizes its commit.
set -euo pipefail
revision=$1
[[ "$revision" =~ ^quota-[0-9a-f]{12}$ ]]
release=/opt/modulo/releases/$revision
old=$(readlink -f /opt/modulo/current)
[[ "$old" == /opt/modulo/releases/* ]]
test ! -e "$release"
test ! -e /opt/modulo/current.next
# Refuse to interrupt a submitted song or inference request.
/opt/modulo/runtime/api/bin/python /opt/modulo/assert-idle.py
before=$(sha256sum /var/lib/modulo/preset-inference/budget.json | cut -d' ' -f1)
cp -a -- "$old" "$release"
tar -xzf /opt/modulo/quota-update.tar.gz -C "$release"
ln -s "$release" /opt/modulo/current.next
mv -Tf /opt/modulo/current.next /opt/modulo/current
systemctl restart modulo
for attempt in $(seq 1 20); do
    if curl --fail --silent http://127.0.0.1:8123/api/health -H 'Host: localhost' > /var/lib/modulo/deployment-health.json; then
        after=$(sha256sum /var/lib/modulo/preset-inference/budget.json | cut -d' ' -f1)
        test "$before" = "$after"
        echo 'Hosted API updated; usage ledger unchanged'
        cat /var/lib/modulo/deployment-health.json
        exit 0
    fi
    sleep 1
done
ln -s "$old" /opt/modulo/current.rollback
mv -Tf /opt/modulo/current.rollback /opt/modulo/current
systemctl restart modulo
echo 'Upgrade failed; previous source restored without resetting data' >&2
exit 1
