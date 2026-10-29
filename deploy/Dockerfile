FROM ghcr.io/astral-sh/uv:0.9.5 AS uv
FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04 AS api
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_PYTHON_INSTALL_DIR=/opt/python UV_LINK_MODE=copy
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/api/requirements-lock.txt services/api/
COPY tools/demucs/requirements-lock.txt tools/demucs/
RUN uv python install 3.12 3.10 \
    && uv venv --python 3.12 services/api/.venv \
    && uv pip install --python services/api/.venv/bin/python -r services/api/requirements-lock.txt \
    && uv venv --python 3.10 tools/demucs/.venv \
    && uv pip install --index-strategy unsafe-best-match --python tools/demucs/.venv/bin/python -r tools/demucs/requirements-lock.txt
COPY services/api/app services/api/app
COPY tools/demucs/worker.py tools/demucs/worker.py
COPY contracts/preset.schema.json contracts/preset.schema.json
COPY fixtures fixtures
RUN useradd --uid 10001 --create-home modulo && mkdir -p data models/torch && chown -R modulo:modulo data models
USER modulo
ENV TORCH_HOME=/app/models/torch
CMD ["services/api/.venv/bin/python", "-m", "uvicorn", "app.main:app", "--app-dir", "services/api", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-proxy-headers"]

FROM caddy:2.10.2 AS gateway
COPY deploy/Caddyfile /etc/caddy/Caddyfile
