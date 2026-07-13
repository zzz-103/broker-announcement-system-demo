FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable

# Production is served through the gateway, so browser requests must use same-origin /api.
# This takes precedence over any developer-only frontend/.env.local configuration.
ARG NEXT_PUBLIC_API_BASE_URL=
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

COPY frontend/package.json frontend/pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY frontend/ ./

RUN pnpm build


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
