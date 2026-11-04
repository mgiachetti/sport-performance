#!/bin/sh
# Entrypoint of the web image (B-701, ADR 0087). Derives the origins the Content-Security-Policy
# of the Caddyfile allows from the same variables as the rest of the deploy, then runs Caddy:
#
#   API_ORIGIN    origin of VITE_API_URL (the API the bundle was built against; required)
#   FILES_ORIGIN  origin of the bucket's signed URLs (ADR 0044), from STORAGE_ENDPOINT,
#                 STORAGE_BUCKET and STORAGE_FORCE_PATH_STYLE; empty without a bucket
#
# Refuses to start on a missing or non-https origin (http only on loopback, for local runs):
# a broken CSP would fail in every browser, a permissive one would fail silently.
set -eu

fail() {
  echo "web: $1" >&2
  exit 1
}

# scheme://host[:port] of a URL, lowercased; empty when it is not an absolute URL.
origin_of() {
  printf '%s\n' "$1" | sed -n -E 's|^([a-zA-Z][a-zA-Z0-9+.-]*://[^/?#@]+)([/?#].*)?$|\1|p' |
    tr '[:upper:]' '[:lower:]'
}

# Accepts https anywhere and http only on loopback.
check_origin() {
  case "$2" in
    https://*) ;;
    http://localhost | http://localhost:* | http://127.0.0.1 | http://127.0.0.1:*) ;;
    *) fail "$1 must be an https URL" ;;
  esac
}

api_url="${VITE_API_URL:-}"
[ -n "$api_url" ] || fail "VITE_API_URL is required (the origin of the API)"
API_ORIGIN="$(origin_of "$api_url")"
[ -n "$API_ORIGIN" ] || fail "VITE_API_URL is not an absolute URL"
check_origin VITE_API_URL "$API_ORIGIN"

FILES_ORIGIN=""
endpoint="${STORAGE_ENDPOINT:-}"
if [ -n "$endpoint" ]; then
  bucket="${STORAGE_BUCKET:-}"
  [ -n "$bucket" ] || fail "STORAGE_BUCKET is required with STORAGE_ENDPOINT"
  case "$bucket" in
    *[!a-z0-9.-]*) fail "STORAGE_BUCKET is not a valid bucket name" ;;
  esac
  endpoint_origin="$(origin_of "$endpoint")"
  [ -n "$endpoint_origin" ] || fail "STORAGE_ENDPOINT is not an absolute URL"
  check_origin STORAGE_ENDPOINT "$endpoint_origin"
  case "${STORAGE_FORCE_PATH_STYLE:-false}" in
    true) FILES_ORIGIN="$endpoint_origin" ;;
    false)
      # Virtual-hosted style: the bucket is a subdomain of the endpoint (Railway's default).
      scheme="${endpoint_origin%%://*}"
      FILES_ORIGIN="${scheme}://${bucket}.${endpoint_origin#*://}"
      ;;
    *) fail "STORAGE_FORCE_PATH_STYLE must be true or false" ;;
  esac
fi

export API_ORIGIN FILES_ORIGIN
exec "$@"
