#!/bin/sh
# Smoke test of an image built from apps/<app>/Dockerfile (B-701, ADR 0087), without a database:
# what Railway needs from it is there, it runs as a non-root user and it starts far enough to
# validate its configuration. The web image is served and its headers checked.
#
# Usage: smoke-image.sh <api|worker|web> <image>   (POSIX sh; requires docker and curl)
set -eu

app="$1"
image="$2"
failures=0

check() {
  if eval "$2"; then
    echo "ok - $1"
  else
    echo "::error::not ok - $1"
    failures=$((failures + 1))
  fi
}

# `docker run` that must fail with a message containing $1.
fails_with() {
  expected="$1"
  shift
  if out="$(docker run --rm "$@" 2>&1)"; then
    echo "$out"
    return 1
  fi
  printf '%s\n' "$out" | grep -qF -- "$expected"
}

case "$app" in
  api | worker)
    check "runs as a non-root user" "[ \"\$(docker run --rm '$image' id -u)\" != 0 ]"
    check "ships the migrations and the release CLI" \
      "docker run --rm '$image' node -e \"for (const f of ['dist/main.js', 'node_modules/@sport-performance/db/dist/cli/release.js', 'node_modules/@sport-performance/db/drizzle/meta/_journal.json']) require('node:fs').accessSync('/app/' + f)\""
    check "validates its environment at startup" \
      "fails_with 'DATABASE_URL' -e NODE_ENV=production '$image'"
    if [ "$app" = api ]; then
      check "db:release refuses to run without the owner URL" \
        "fails_with 'MIGRATIONS_DATABASE_URL' '$image' node /app/node_modules/@sport-performance/db/dist/cli/release.js"
    fi
    ;;
  web)
    check "runs as a non-root user" "[ \"\$(docker run --rm --entrypoint id '$image' -u)\" != 0 ]"
    check "refuses to start without API_UPSTREAM" "fails_with 'API_UPSTREAM is required' '$image'"
    # A stand-in for the API on a private network, with the image's own Caddy: it answers /v1/*
    # with the forwarding headers it got, and a header of its own.
    docker network create smoke-net >/dev/null
    trap 'docker rm -f smoke-web smoke-api >/dev/null 2>&1 || true; docker network rm smoke-net >/dev/null 2>&1 || true' EXIT
    upstream_config=':9000 {
	header X-Smoke-Upstream api
	respond "{path}|{header.X-Forwarded-For}|{header.X-Forwarded-Proto}" 200
}'
    # The inner shell expands the variable inside the container.
    # shellcheck disable=SC2016
    docker run -d --name smoke-api --network smoke-net -e UPSTREAM_CONFIG="$upstream_config" \
      --entrypoint sh "$image" -c \
      'printf "%s\n" "$UPSTREAM_CONFIG" >/tmp/Caddyfile && exec caddy run --config /tmp/Caddyfile --adapter caddyfile' \
      >/dev/null
    docker run -d --name smoke-web --network smoke-net -p 18080:8080 \
      -e API_UPSTREAM=http://smoke-api:9000 \
      -e STORAGE_ENDPOINT=https://t3.storageapi.dev \
      -e STORAGE_BUCKET=files-smoke \
      "$image" >/dev/null
    for _ in $(seq 1 30); do
      if curl -fsS http://localhost:18080/healthz >/dev/null 2>&1; then break; fi
      sleep 1
    done
    headers() { curl -sS -o /dev/null -D - "http://localhost:18080$1" | tr -d '\r'; }
    status() { curl -sS -o /dev/null -w '%{http_code}' "http://localhost:18080$1"; }
    check "answers the healthcheck" "[ \"\$(status /healthz)\" = 200 ]"
    check "serves the SPA on any route" \
      "[ \"\$(status /players/123)\" = 200 ] && curl -fsS http://localhost:18080/players/123 | grep -q '<div id=\"root\">'"
    check "allows only itself (the API included) and the bucket" \
      "headers / | grep -qF \"connect-src 'self' https://files-smoke.t3.storageapi.dev;\""
    for _ in $(seq 1 30); do
      if [ "$(status /v1/health)" = 200 ]; then break; fi
      sleep 1
    done
    check "proxies /v1/* to the API with the edge's forwarding headers untouched" \
      "[ \"\$(curl -fsS -H 'X-Forwarded-For: 203.0.113.7' -H 'X-Forwarded-Proto: https' http://localhost:18080/v1/me)\" = '/v1/me|203.0.113.7|https' ]"
    check "answers the API with the API's headers, not the web's" \
      "headers /v1/me | grep -qiF 'X-Smoke-Upstream: api' && ! headers /v1/me | grep -qiF 'frame-ancestors'"
    check "serves the SPA, not the API, outside /v1/" \
      "! headers /v1 | grep -qiF 'X-Smoke-Upstream' && ! headers /v10/x | grep -qiF 'X-Smoke-Upstream'"
    check "forbids framing" "headers / | grep -qF \"frame-ancestors 'none'\""
    for header in 'Strict-Transport-Security: max-age=' 'X-Content-Type-Options: nosniff' \
      'Referrer-Policy: strict-origin-when-cross-origin' 'Permissions-Policy: ' 'Cache-Control: no-cache'; do
      check "sends $header" "headers / | grep -qiF '$header'"
    done
    check "does not announce the server" "! headers / | grep -qi '^server:'"
    asset="$(curl -fsS http://localhost:18080/ | sed -n 's|.*src="\(/assets/[^"]*\.js\)".*|\1|p' | head -n 1)"
    check "caches hashed assets for good" \
      "[ -n '$asset' ] && headers '$asset' | grep -qiF 'Cache-Control: public, max-age=31536000, immutable'"
    check "never caches a missing asset" \
      "[ \"\$(status /assets/missing-0000.js)\" = 404 ] && headers /assets/missing-0000.js | grep -qiF 'Cache-Control: no-store'"
    check "does not serve source maps" "[ \"\$(status '$asset.map')\" = 404 ]"
    ;;
  *)
    echo "Unknown app: $app" >&2
    exit 2
    ;;
esac

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
