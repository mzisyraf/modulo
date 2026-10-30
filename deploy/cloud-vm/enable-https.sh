#!/usr/bin/env bash
set -euo pipefail
host=modulo.69-169-102-112.sslip.io
test -d /opt/modulo/current/apps/web/dist
test ! -e /etc/nginx/sites-enabled/modulo
cat > /etc/nginx/sites-available/modulo <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name modulo.69-169-102-112.sslip.io;
    location ^~ /.well-known/acme-challenge/ {
        root /var/lib/modulo-acme;
    }
    location / { return 404; }
}
NGINX
ln -s /etc/nginx/sites-available/modulo /etc/nginx/sites-enabled/modulo
nginx -t
systemctl reload nginx
/opt/pocket-certbot/bin/certbot certonly --webroot -w /var/lib/modulo-acme \
    -d "$host" --non-interactive --agree-tos --register-unsafely-without-email \
    --config-dir /etc/modulo-letsencrypt --work-dir /var/lib/modulo-certbot \
    --logs-dir /var/log/modulo-certbot
install -m 644 /opt/modulo/current/deploy/cloud-vm/modulo.nginx.conf /etc/nginx/sites-available/modulo
nginx -t
systemctl reload nginx
install -m 644 /opt/modulo/current/deploy/cloud-vm/modulo-cert-renew.service /etc/systemd/system/
install -m 644 /opt/modulo/current/deploy/cloud-vm/modulo-cert-renew.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now modulo-cert-renew.timer
echo 'modulo HTTPS enabled; existing default sites unchanged'
