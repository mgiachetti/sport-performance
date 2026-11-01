#!/bin/sh
# Fails when the aggregate `ci` job of a workflow does not depend on every other job, or does
# not run with `if: always()`. `ci` is the only required status check on `main`: a job missing
# from its `needs` would be silently optional, and without `always()` a failed dependency would
# skip `ci`, which GitHub counts as passing.
#
# Usage: check-ci-aggregate.sh [workflow-file]   (POSIX sh; requires mikefarah/yq v4)
set -eu

workflow="${1:-.github/workflows/ci.yml}"
aggregate="ci"

if [ "$(yq ".jobs | has(\"${aggregate}\")" "$workflow")" != "true" ]; then
  echo "::error file=${workflow}::Aggregate job '${aggregate}' not found."
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

yq ".jobs | keys | .[] | select(. != \"${aggregate}\")" "$workflow" | sort >"$tmp/jobs"
# `needs` may be a single string or a list.
yq "(.jobs.${aggregate}.needs // []) | [.] | flatten | .[]" "$workflow" | sort >"$tmp/needs"

missing="$(comm -23 "$tmp/jobs" "$tmp/needs" | paste -sd, -)"
unknown="$(comm -13 "$tmp/jobs" "$tmp/needs" | paste -sd, -)"

status=0
if [ -n "$missing" ]; then
  echo "::error file=${workflow}::Jobs missing from '${aggregate}.needs': ${missing}"
  status=1
fi
if [ -n "$unknown" ]; then
  echo "::error file=${workflow}::'${aggregate}.needs' lists unknown jobs: ${unknown}"
  status=1
fi
if [ "$(yq ".jobs.${aggregate}.if" "$workflow")" != "always()" ]; then
  echo "::error file=${workflow}::Job '${aggregate}' must run with 'if: always()'."
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "'${aggregate}' depends on every job: $(paste -sd, - <"$tmp/jobs")"
fi
exit "$status"
