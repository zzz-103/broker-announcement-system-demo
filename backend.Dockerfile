FROM node:20-alpine AS frontend-builder

WORKDIR /build/frontend
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend ./
ARG NEXT_PUBLIC_API_BASE_URL=
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm exec next build


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

# Install python dependencies
RUN pip install --no-cache-dir -r /app/backend/api/requirements.txt

# Copy backend codebase
COPY backend /app/backend
COPY --from=frontend-builder /build/frontend/out /app/frontend/out

# Expose FastAPI port
EXPOSE 8000

# Default command for backend-api
CMD ["uvicorn", "backend.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
