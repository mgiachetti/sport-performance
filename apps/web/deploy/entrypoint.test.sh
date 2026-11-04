#!/bin/sh
# Tests for entrypoint.sh: the origins it derives for the CSP and what it refuses.
# Usage: apps/web/deploy/entrypoint.test.sh   (POSIX sh, from any directory)
set -eu

entrypoint="$(dirname "$0")/entrypoint.sh"
failures=0

# run <env assignments...>: prints "API_ORIGIN|FILES_ORIGIN" or "error: <message>".
run() {
  if out="$(env -i PATH="$PATH" "$@" sh "$entrypoint" sh -c 'printf "%s|%s" "$API_ORIGIN" "$FILES_ORIGIN"' 2>&1)"; then
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
  'https://api.example.org|https://files-abc.t3.storageapi.dev' \
  VITE_API_URL=https://api.example.org/ STORAGE_ENDPOINT=https://t3.storageapi.dev \
  STORAGE_BUCKET=files-abc STORAGE_FORCE_PATH_STYLE=false

expect "path-style bucket keeps the endpoint's origin and port" \
  'https://api.example.org|https://minio.example.org:9000' \
  VITE_API_URL=https://api.example.org STORAGE_ENDPOINT=https://minio.example.org:9000/ \
  STORAGE_BUCKET=files STORAGE_FORCE_PATH_STYLE=true

expect "path style defaults to false" \
  'https://api.example.org|https://files.t3.storageapi.dev' \
  VITE_API_URL=https://api.example.org STORAGE_ENDPOINT=https://t3.storageapi.dev \
  STORAGE_BUCKET=files

expect "origins drop path, query and case" \
  'https://api.example.org:8443|' \
  VITE_API_URL='https://API.Example.org:8443/v1?x=1'

expect "no bucket: only the API" 'https://api.example.org|' VITE_API_URL=https://api.example.org

expect "http on loopback for local runs" 'http://localhost:3000|' VITE_API_URL=http://localhost:3000

expect "refuses a missing API URL" 'error: web: VITE_API_URL is required*'

expect "refuses a relative API URL" 'error: web: VITE_API_URL is not an absolute URL' \
  VITE_API_URL=/api

expect "refuses plain http outside loopback" 'error: web: VITE_API_URL must be an https URL' \
  VITE_API_URL=http://api.example.org

expect "refuses credentials in the URL" 'error: web: VITE_API_URL is not an absolute URL' \
  VITE_API_URL=https://user:secret@api.example.org

expect "refuses an endpoint without bucket" \
  'error: web: STORAGE_BUCKET is required with STORAGE_ENDPOINT' \
  VITE_API_URL=https://api.example.org STORAGE_ENDPOINT=https://t3.storageapi.dev

expect "refuses a bucket name that could inject into the CSP" \
  'error: web: STORAGE_BUCKET is not a valid bucket name' \
  VITE_API_URL=https://api.example.org STORAGE_ENDPOINT=https://t3.storageapi.dev \
  "STORAGE_BUCKET=x; script-src *"

expect "refuses an unknown path style" \
  'error: web: STORAGE_FORCE_PATH_STYLE must be true or false' \
  VITE_API_URL=https://api.example.org STORAGE_ENDPOINT=https://t3.storageapi.dev \
  STORAGE_BUCKET=files STORAGE_FORCE_PATH_STYLE=yes

if [ "$failures" -gt 0 ]; then
  echo "$failures test(s) failed"
  exit 1
fi
