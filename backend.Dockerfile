# syntax=docker/dockerfile:1.7
FROM python:3.11-slim

# Install tzdata and curl (for healthcheck)
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
    tzdata \
    curl \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

ENV TZ=Asia/Shanghai
ENV PYTHONUNBUFFERED=1
ENV PYTHONIOENCODING=utf-8
ENV PYTHONPATH=/app
ENV FRONTEND_DIST_PATH=/app/frontend/out

WORKDIR /app

# Copy requirements first to leverage Docker cache
COPY backend/api/requirements.txt /app/backend/api/requirements.txt
COPY requirements.txt /app/requirements.txt
COPY requirements-lock.txt /app/requirements-lock.txt

# Adjust the relative requirements path for the container structure
RUN python -c "import pathlib; p = pathlib.Path('/app/backend/api/requirements.txt'); p.write_text(p.read_text().replace('../../requirements.txt', '/app/requirements.txt'))"

# Avoid reusing proxy-corrupted wheels between release builds.
# Keep the BuildKit pip cache across release builds. The cache is local to the
# builder and never becomes part of the runtime image layer.
RUN --mount=type=cache,id=broker-backend-pip,target=/root/.cache/pip \
    pip install --timeout 300 --retries 5 \
    -r /app/backend/api/requirements.txt -c /app/requirements-lock.txt

# Copy backend codebase
COPY backend /app/backend

# App Watch shares the backend runtime; OCR supports the configured image parsers.
RUN python -c "import backend.broker_app_watch.cli, yaml, openai, rapidocr_onnxruntime; print('broker app watch dependencies ok')"

# App Watch subprocess configuration (consumed by backend JobManager)
ENV APP_WATCH_PYTHON_EXECUTABLE=/usr/local/bin/python
ENV APP_WATCH_WORKING_DIR=/app
ENV APP_RELEASES_CSV_PATH=/app/backend/data/broker_app_watch/exports/app_releases.csv
ENV APP_WATCH_LLM_CONFIG_PATH=/app/backend/config/llm_api_config.json
ENV BAW_DISABLED_BROKERS=pazq

# Expose FastAPI port
EXPOSE 8000

# Default command for backend-api
CMD ["uvicorn", "backend.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
