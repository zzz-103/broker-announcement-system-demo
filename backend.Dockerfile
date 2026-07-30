# syntax=docker/dockerfile:1.7
FROM python:3.11-slim

# Install tzdata and curl (for healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tzdata \
    curl \
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

# Adjust the relative requirements path for the container structure
RUN python -c "import pathlib; p = pathlib.Path('/app/backend/api/requirements.txt'); p.write_text(p.read_text().replace('../../requirements.txt', '/app/requirements.txt'))"

# Keep downloaded wheels between builds without storing them in the image.
RUN --mount=type=cache,id=broker-backend-pip,target=/root/.cache/pip \
    pip install -r /app/backend/api/requirements.txt

# Copy backend codebase
COPY backend /app/backend

# Install broker-app-watch into an isolated venv (dependency isolation per design).
# The heavy OCR extra is intentionally excluded; the pazq/平安证券 image-OCR source
# is disabled via BAW_DISABLED_BROKERS so rapidocr-onnxruntime is not required.
COPY broker-app-watch /app/broker-app-watch
RUN --mount=type=cache,id=broker-app-watch-pip,target=/root/.cache/pip \
    python -m venv /app/broker-app-watch/.venv \
    && /app/broker-app-watch/.venv/bin/pip install --upgrade pip \
    && /app/broker-app-watch/.venv/bin/pip install -e /app/broker-app-watch \
    && /app/broker-app-watch/.venv/bin/python -c "import yaml, openai; print('broker-app-watch dependencies ok')"

# broker-app-watch subprocess configuration (consumed by backend JobManager)
ENV APP_WATCH_PYTHON_EXECUTABLE=/app/broker-app-watch/.venv/bin/python
ENV APP_WATCH_WORKING_DIR=/app/broker-app-watch
ENV APP_RELEASES_CSV_PATH=/app/broker-app-watch/data/exports/app_releases.csv
ENV APP_WATCH_LLM_CONFIG_PATH=/app/backend/config/llm_api_config.json
ENV BAW_DISABLED_BROKERS=pazq

# Expose FastAPI port
EXPOSE 8000

# Default command for backend-api
CMD ["uvicorn", "backend.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
