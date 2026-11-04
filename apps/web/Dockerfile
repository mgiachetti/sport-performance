# Image of the staff web (B-701, ADR 0090): the Vite build served by Caddy with the security
# headers of apps/web/deploy/Caddyfile. Built from the repository root:
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=https://app.example.org .
# VITE_API_URL (the web's own origin: Caddy proxies /v1/* to the API) is part of the bundle, so
# each environment builds its own image (Railway passes the service's variables as build
# arguments). Base images are pinned by digest; Dependabot updates them.

FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
# pnpm at the version of package.json#packageManager.
RUN corepack enable pnpm
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter-prod "@sport-performance/web..."
ARG VITE_API_URL
# Without it the bundle would build and then stop at startup in every browser (src/env.ts).
RUN test -n "${VITE_API_URL}" || { echo "Set the VITE_API_URL build argument." >&2; exit 1; }
RUN pnpm --filter-prod "@sport-performance/web..." run build

FROM caddy:2-alpine@sha256:e70b164da81ef698b3ad19af799ea6086ce6d9e48ed4079eb9fe26f6fbf14ee5
# Caddy runs as nobody: its state goes to /tmp (nothing to persist, no automatic TLS here).
ENV XDG_CONFIG_HOME=/tmp/caddy/config XDG_DATA_HOME=/tmp/caddy/data PORT=8080
COPY apps/web/deploy/Caddyfile /etc/caddy/Caddyfile
COPY apps/web/deploy/entrypoint.sh /usr/local/bin/web-entrypoint
COPY --from=build /repo/apps/web/dist /srv
# Validated with a stand-in upstream: the real one comes from entrypoint.sh at startup.
RUN API_UPSTREAM=http://api.internal:8080 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
USER 65534:65534
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/web-entrypoint"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
