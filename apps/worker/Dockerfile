# Image of the worker (B-701, ADR 0090). Built from the repository root:
#   docker build -f apps/worker/Dockerfile .
# Railway builds it per environment (.railway/railway.ts). No port: the worker only talks to
# Postgres (pg-boss), the bucket, Resend and Expo. Base images are pinned by digest; Dependabot
# updates them.

FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
# pnpm at the version of package.json#packageManager.
RUN corepack enable pnpm
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter-prod "@sport-performance/worker..."
RUN pnpm --filter-prod "@sport-performance/worker..." run build
RUN pnpm --filter @sport-performance/worker deploy --prod /out

FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
USER node
CMD ["node", "--enable-source-maps", "./dist/main.js"]
