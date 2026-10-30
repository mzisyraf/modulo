# Hosted judge application

URL: https://modulo.69-169-102-112.sslip.io

The owner supplied this existing server and explicitly authorized privately transferring Token Factory and Modal credentials. The free IP-based hostname resolves to the server; Nginx serves the browser build over a valid HTTPS certificate. Provider credentials never enter the frontend. The pre-existing default site and system Python are preserved.

## Judge login and testing

The application uses the username `judge`. Isyraf's generated password is in the ignored local file `data/deploy/judge-access.json`. Put the application password in Devpost's testing instructions; do not submit the provider `.env`, Modal token or server SSH credentials. Do not commit or screenshot the password file.

Use current desktop Chrome/Edge. Connect a guitar to an audio interface for the complete live tone workflow; select the physical instrument channel, use headphones, calibrate for ten seconds, then prepare a permitted song and select its reference passage. Match tone runs Nemotron and automatically refines before the explicit Use this tone action. Play and record remain explicit. Recordings live in the browser tab and must be downloaded before refreshing.

Song exploration and full-song draft tabs do not require a guitar. After Prepare song, open Play & record, expand Practice with full-song tabs and request generation. Uploaded songs must be 10 seconds–4:55, WAV/MP3 and at most 50 MiB. No local GPU is needed.

## Server layout

- `/opt/modulo/current`: current source/static build, with release directories under `/opt/modulo/releases/`.
- `/opt/modulo/runtime/api` and `/opt/modulo/runtime/modal`: isolated Python 3.12 environments; no CUDA or model weights on the VM.
- `/etc/modulo/provider.env`, `modal.toml`, `htpasswd`: private backend configuration and application login hash. The unprivileged `modulo` service reads its Modal token; systemd privately loads provider environment variables.
- `/var/lib/modulo`: durable jobs, usage records and SDK home. Releases share this directory so deployment does not reset counters.
- `modulo.service`: one API process bound to `127.0.0.1:8123`, automatic restart and memory protection. Nginx serves static files and forwards `/api/`. The public Origin is validated before proxy adaptation to the existing localhost-only API boundary.

The gateway retains authentication, a 50 MiB upload bound and a modest write-request rate safeguard. These protect the VM and are separate from model attempt/spending quotas. The user subsequently instructed removal of all project spending/attempt quotas. Source `0a0d7fc` removes those quotas and is deployed on the hosted API as snapshot `quota-5d629b8886b2`; both Modal workers were redeployed by the quota-removal session. Usage records remain intact. Provider billing, credit balances and account quotas still apply.

## Operations and verification

The scripts in `deploy/cloud-vm/` document this specific server setup, not a generic deployment framework. `bootstrap.sh` expects the tested source archive and approved private files already transferred by the owner over SSH. Initial provisioning used an isolated `uv==0.9.5` installation and managed Python 3.12.12. `enable-https.sh` obtains only this hostname's certificate using the server's existing Certbot binary with a separate account/configuration directory.

Check `systemctl status modulo`, `journalctl -u modulo`, and `nginx -t`. Restart with `systemctl restart modulo`. Certificate checking/renewal is scheduled twice daily by `modulo-cert-renew.timer`; the current certificate expires 28 January 2027. Keep the server's existing Certbot binary available for renewal.

`verify-modal.py` reads function statistics and cumulative ledgers as the `modulo` user without starting GPU work. `verify-token-factory.py` runs as root and authenticates a catalog GET without inference. Neither prints credentials. Hosted browser checks prove HTTPS/secure media context, actual static assets, API routing, valid-Origin validation, invalid-Origin rejection and the current four-stage visual rig. They do not prove physical guitar quality or fresh paid inference.

To roll back an app release, point `/opt/modulo/current` to the previous complete release and restart `modulo`; keep `/var/lib/modulo` intact. To disable only this site, remove its own `sites-enabled/modulo` symlink, test/reload Nginx and stop `modulo`. Never remove or replace the server's default site.

## Remaining judging-access work

Keep this server and provider accounts available through 24 December 2026, 04:00 MYT. The shared Modal token was originally documented as expiring 5 November; renew or replace it before then and update `/etc/modulo/modal.toml` privately. A custom domain can replace the free hostname later, but this URL depends on the current server IP and third-party DNS availability. Public source/licence, the public YouTube demonstration and final Devpost submission are separate deliverables.
