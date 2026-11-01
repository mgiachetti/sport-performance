#!/bin/sh
# Tests for check-ci-aggregate.sh: the real workflow passes and each broken fixture fails.
# Usage: check-ci-aggregate.test.sh   (run from the repo root; POSIX sh, requires yq v4)
set -eu

script="$(dirname "$0")/check-ci-aggregate.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
failures=0

# expect <pass|fail> <description> <workflow-file>
expect() {
  if sh "$script" "$3" >"$tmp/out" 2>&1; then
    actual=pass
  elif grep -q '^::error' "$tmp/out"; then
    actual=fail
  else
    actual="crash (no ::error annotation)"
  fi
  if [ "$actual" = "$1" ]; then
    echo "ok - $2"
  else
    echo "not ok - $2 (expected $1, got $actual)"
    sed 's/^/    /' "$tmp/out"
    failures=$((failures + 1))
  fi
}

fixture() {
  cat >"$tmp/$1.yml"
  echo "$tmp/$1.yml"
}

expect pass "the real CI workflow aggregates every job" .github/workflows/ci.yml

expect pass "needs as a list covering every job" "$(fixture ok-list <<'EOF'
jobs:
  lint: {}
  test: {}
  ci: { if: always(), needs: [lint, test] }
EOF
)"

expect pass "needs as a single string" "$(fixture ok-string <<'EOF'
jobs:
  lint: {}
  ci: { if: always(), needs: lint }
EOF
)"

expect fail "a job missing from needs" "$(fixture missing <<'EOF'
jobs:
  lint: {}
  test: {}
  ci: { if: always(), needs: [lint] }
EOF
)"

expect fail "needs referencing an unknown job" "$(fixture unknown <<'EOF'
jobs:
  lint: {}
  ci: { if: always(), needs: [lint, ghost] }
EOF
)"

expect fail "aggregate without if: always()" "$(fixture no-always <<'EOF'
jobs:
  lint: {}
  ci: { needs: [lint] }
EOF
)"

expect fail "aggregate without needs" "$(fixture no-needs <<'EOF'
jobs:
  lint: {}
  ci: { if: always() }
EOF
)"

expect fail "no aggregate job" "$(fixture no-ci <<'EOF'
jobs:
  lint: {}
EOF
)"

if [ "$failures" -ne 0 ]; then
  echo "$failures test(s) failed"
  exit 1
fi
echo "all tests passed"
