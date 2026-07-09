# Nginx Gateway Config

This directory contains the Nginx gateway config for routing browser traffic to the frontend and FastAPI backend.

- Put `default.conf` into the Nginx container at `/etc/nginx/conf.d/default.conf`.
- The config depends on Compose service names `frontend` and `backend-api`.
- Externally, only the gateway port needs to be exposed.
- Keep `proxy_buffering off` for `/api/` so SSE job logs stream in real time.
- This change does not modify Dockerfile or Compose files.
