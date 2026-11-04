# Image of the API (B-701, ADR 0090). Built from the repository root:
#   docker build -f apps/api/Dockerfile .
# Railway builds it per environment (.railway/railway.ts) and runs `db:release` in it as the
# pre-deploy command. Base images are pinned by digest; Dependabot updates them.

FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
# pnpm at the version of package.json#packageManager.
RUN corepack enable pnpm
WORKDIR /repo
COPY . .
# Only the API and the workspace packages it ships with (production dependencies), each with
# its own dev dependencies to compile.
RUN pnpm install --frozen-lockfile --filter-prod "@sport-performance/api..."
RUN pnpm --filter-prod "@sport-performance/api..." run build
# A self-contained copy: dist/ and production node_modules, with the workspace packages
# (including the migrations of @sport-performance/db) copied in.
RUN pnpm --filter @sport-performance/api deploy --prod /out

FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
ENV NODE_ENV=production
WORKDIR /app
# Owned by root: `node` can read the files but not change them (they stay world-readable).
COPY --from=build /out /app
USER node
EXPOSE 8080
# The owner and worker logins exist only for `db:release` (the pre-deploy command, which runs
# with the full environment): the API process never receives them, and refuses to start in
# production if it does (src/config/env.ts).
CMD ["env", "-u", "MIGRATIONS_DATABASE_URL", "-u", "WORKER_DATABASE_URL", \
  "node", "--enable-source-maps", "--import", "./dist/instrument.js", "./dist/main.js"]
