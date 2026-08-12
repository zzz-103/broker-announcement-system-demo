# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Production is served through the gateway, so browser requests must use same-origin /api.
# This takes precedence over any developer-only frontend/.env.local configuration.
ARG NEXT_PUBLIC_API_BASE_URL=
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

COPY frontend/pnpm-lock.yaml frontend/.npmrc ./

RUN --mount=type=cache,id=broker-frontend-pnpm,target=/pnpm/store \
    pnpm fetch --frozen-lockfile --store-dir=/pnpm/store

COPY frontend/package.json ./

RUN --mount=type=cache,id=broker-frontend-pnpm,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --store-dir=/pnpm/store

COPY frontend/ ./

# The frontend TypeScript path alias resolves shared dashboard contracts from
# the repository root during the container build.
COPY shared/dashboard-data/ /shared/dashboard-data/

RUN pnpm build

ARG APP_VERSION
ARG GIT_SHA
RUN printf '{"version":"%s","git_sha":"%s"}\n' "$APP_VERSION" "$GIT_SHA" > /app/out/version.json


FROM nginx:1.27-alpine

RUN rm -f /etc/nginx/conf.d/default.conf && \
    printf '%s\n' \
    'server {' \
    '    listen 3000;' \
    '    server_name _;' \
    '    root /usr/share/nginx/html;' \
    '    index index.html;' \
    '' \
    '    location / {' \
    '        try_files $uri $uri.html $uri/ /index.html;' \
    '    }' \
    '' \
    '    location = /health {' \
    '        access_log off;' \
    '        add_header Content-Type text/plain;' \
    '        return 200 "ok";' \
    '    }' \
    '}' \
    > /etc/nginx/conf.d/default.conf

COPY --from=builder /app/out /usr/share/nginx/html

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
