# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Production is served by this image's Nginx, so browser requests use same-origin /api.
# This takes precedence over any developer-only frontend/.env.local configuration.
ARG NEXT_PUBLIC_API_BASE_URL=
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ARG APP_VERSION=1.9.1
ARG GIT_SHA=unknown
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION

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

RUN printf '{"version":"%s","git_sha":"%s"}\n' "$APP_VERSION" "$GIT_SHA" > /app/out/version.json


FROM nginx:1.27-alpine

COPY deploy/frontend.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/out /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
