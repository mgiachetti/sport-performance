#!/bin/sh
# Moves the `production` branch, which Railway's production environment deploys, to a commit of
# `main` (B-701, docs/adr/0087-proyecto-de-railway-como-codigo-y-deploy.md). Refuses unless the
# commit is in `main`, its `ci` check passed and the move is a fast-forward: production only
# ever runs code that already went through staging. Rolling back is Railway's rollback, never a
# forced branch.
#
# Usage: promote.sh [sha]   (empty = the latest commit of main)
# Env:   GH_TOKEN (contents: write, checks: read), REPO (owner/name)
#        GITHUB_STEP_SUMMARY (optional)
set -eu

repo="${REPO:?Set REPO to owner/name}"
branch="production"
target="${1:-}"

fail() {
  echo "::error::$1"
  exit 1
}

main="$(gh api "repos/${repo}/commits/main" --jq .sha)"
if [ -z "$target" ]; then
  target="$main"
fi
case "$target" in
  *[!0-9a-f]*) fail "Give the full SHA (40 lowercase hex characters) of a commit of main." ;;
esac
[ "${#target}" -eq 40 ] || fail "Give the full SHA (40 lowercase hex characters) of a commit of main."

# 1. In main: main is ahead of (or at) the commit.
in_main="$(gh api "repos/${repo}/compare/${target}...${main}" --jq .status)"
case "$in_main" in
  ahead | identical) ;;
  *) fail "${target} is not a commit of main (compare: ${in_main})." ;;
esac

# 2. CI passed on that exact commit (the `ci` aggregate check of .github/workflows/ci.yml).
conclusion="$(gh api "repos/${repo}/commits/${target}/check-runs?check_name=ci&filter=latest" \
  --jq '[.check_runs[] | select(.app.slug == "github-actions")] | sort_by(.completed_at) | last | .conclusion // ""')"
[ "$conclusion" = "success" ] || fail "The ci check of ${target} is '${conclusion:-missing}', not success."

# 3. Fast-forward only (or create the branch the first time).
if current="$(gh api "repos/${repo}/git/ref/heads/${branch}" --jq .object.sha 2>/dev/null)"; then
  if [ "$current" = "$target" ]; then
    echo "${branch} is already at ${target}."
    exit 0
  fi
  forward="$(gh api "repos/${repo}/compare/${current}...${target}" --jq .status)"
  [ "$forward" = "ahead" ] ||
    fail "Moving ${branch} from ${current} to ${target} is not a fast-forward (compare: ${forward})."
  gh api -X PATCH "repos/${repo}/git/refs/heads/${branch}" -f sha="$target" -F force=false >/dev/null
  message="${branch}: ${current} -> ${target}"
else
  gh api -X POST "repos/${repo}/git/refs" -f ref="refs/heads/${branch}" -f sha="$target" >/dev/null
  message="${branch} created at ${target}"
fi

echo "$message"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '### Promoted to production\n\n%s\n\nRailway deploys it once its checks pass.\n' "$message" >>"$GITHUB_STEP_SUMMARY"
fi
