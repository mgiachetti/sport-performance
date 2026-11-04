#!/bin/sh
# Tests for entrypoint.sh: the upstream and origins it derives for Caddy and what it refuses.
# Usage: apps/web/deploy/entrypoint.test.sh   (POSIX sh, from any directory)
set -eu

entrypoint="$(dirname "$0")/entrypoint.sh"
failures=0

# run <env assignments...>: prints "API_UPSTREAM|FILES_ORIGIN" or "error: <message>".
run() {
  # The inner shell expands the variables the entrypoint exported.
  # shellcheck disable=SC2016
  if out="$(env -i PATH="$PATH" "$@" sh "$entrypoint" sh -c 'printf "%s|%s" "$API_UPSTREAM" "$FILES_ORIGIN"' 2>&1)"; then
    printf '%s' "$out"
  else
    printf 'error: %s' "$out"
  fi
}

# expect <description> <expected> <env assignments...>
expect() {
  description="$1"
  expected="$2"
  shift 2
  actual="$(run "$@")"
  # The expectation is a glob on purpose (for messages with a variable tail).
  # shellcheck disable=SC2254
  case "$actual" in
    $expected)
      echo "ok - $description"
      ;;
    *)
      echo "not ok - $description"
      echo "    expected: $expected"
      echo "    actual:   $actual"
      failures=$((failures + 1))
      ;;
  esac
}

expect "virtual-hosted bucket (Railway's default)" \
  'http://api.railway.internal:8080|https://files-abc.t3.storageapi.dev' \
  API_UPSTREAM=http://api.railway.internal:8080 STORAGE_ENDPOINT=https://t3.storageapi.dev \
  STORAGE_BUCKET=files-abc STORAGE_FORCE_PATH_STYLE=false

expect "path-style bucket keeps the endpoint's origin and port" \
  'http://api.railway.internal:8080|https://minio.example.org:9000' \
  API_UPSTREAM=http://api.railway.internal:8080 STORAGE_ENDPOINT=https://minio.example.org:9000/ \
  STORAGE_BUCKET=files STORAGE_FORCE_PATH_STYLE=true

expect "path style defaults to false" \
  'http://api.railway.internal:8080|https://files.t3.storageapi.dev' \
  API_UPSTREAM=http://api.railway.internal:8080 STORAGE_ENDPOINT=https://t3.storageapi.dev \
  STORAGE_BUCKET=files

expect "bucket origins drop path, query and case" \
  'http://api.railway.internal:8080|https://files.minio.example.org:8443' \
  API_UPSTREAM=http://api.railway.internal:8080 \
  STORAGE_ENDPOINT='https://MinIO.Example.org:8443/x?y=1' STORAGE_BUCKET=files

expect "no bucket: only the API" 'http://api.railway.internal:8080|' API_UPSTREAM=http://api.railway.internal:8080

expect "upstream keeps https, drops a trailing slash and case" 'https://api.example.org|' \
  API_UPSTREAM=https://API.example.org/

expect "http on loopback for local runs" 'http://localhost:3000|' API_UPSTREAM=http://localhost:3000

expect "refuses a missing upstream" 'error: web: API_UPSTREAM is required*'

expect "refuses an upstream without scheme" 'error: web: API_UPSTREAM must be an http(s) URL' \
  API_UPSTREAM=api.railway.internal:8080

expect "refuses another scheme" 'error: web: API_UPSTREAM must be an http(s) URL' \
  API_UPSTREAM=ftp://api.railway.internal:21

expect "refuses an upstream with a path" 'error: web: API_UPSTREAM must be scheme://host*' \
  API_UPSTREAM=http://api.railway.internal:8080/v1

expect "refuses credentials in the upstream" 'error: web: API_UPSTREAM must be an http(s) URL' \
  API_UPSTREAM=http://user:secret@api.railway.internal:8080

expect "refuses plain http to the bucket outside loopback" \
  'error: web: STORAGE_ENDPOINT must be an https URL' \
  API_UPSTREAM=http://api.railway.internal:8080 STORAGE_ENDPOINT=http://t3.storageapi.dev \
  STORAGE_BUCKET=files

expect "refuses an endpoint without bucket" \
  'error: web: STORAGE_BUCKET is required with STORAGE_ENDPOINT' \
  API_UPSTREAM=http://api.railway.internal:8080 STORAGE_ENDPOINT=https://t3.storageapi.dev

expect "refuses a bucket name that could inject into the CSP" \
  'error: web: STORAGE_BUCKET is not a valid bucket name' \
  API_UPSTREAM=http://api.railway.internal:8080 STORAGE_ENDPOINT=https://t3.storageapi.dev \
  "STORAGE_BUCKET=x; script-src *"

expect "refuses an unknown path style" \
  'error: web: STORAGE_FORCE_PATH_STYLE must be true or false' \
  API_UPSTREAM=http://api.railway.internal:8080 STORAGE_ENDPOINT=https://t3.storageapi.dev \
  STORAGE_BUCKET=files STORAGE_FORCE_PATH_STYLE=yes

if [ "$failures" -gt 0 ]; then
  echo "$failures test(s) failed"
  exit 1
fi
