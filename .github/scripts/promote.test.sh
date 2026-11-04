#!/bin/sh
# Tests for promote.sh against a fake `gh`: what it moves, creates and refuses.
# Usage: promote.test.sh   (run from the repo root; POSIX sh)
set -eu

script="$(cd "$(dirname "$0")" && pwd)/promote.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
failures=0

A=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
B=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
C=cccccccccccccccccccccccccccccccccccccccc

# Fake gh: answers from $tmp/state (main, ci, production) and $tmp/compare ("BASE...HEAD status").
mkdir -p "$tmp/bin"
cat >"$tmp/bin/gh" <<'EOF'
#!/bin/sh
state="$FAKE_DIR/state"
get() { sed -n "s/^$1=//p" "$state"; }
[ "$1" = api ] || exit 2
shift
case "$1" in
  -X)
    # The GITHUB_TOKEN cannot move production (ruleset): only the push with the deploy key does.
    echo "unexpected write through the API: $*" >&2
    exit 4
    ;;
esac
case "$1" in
  repos/o/r/commits/main) get main ;;
  repos/o/r/compare/*)
    pair="${1#repos/o/r/compare/}"
    status="$(sed -n "s/^$pair //p" "$FAKE_DIR/compare")"
    echo "${status:-diverged}"
    ;;
  repos/o/r/commits/*/check-runs*) get ci ;;
  repos/o/r/git/ref/heads/production)
    production="$(get production)"
    [ -n "$production" ] || { echo "Not Found" >&2; exit 1; }
    echo "$production"
    ;;
  *) echo "unexpected: $*" >&2; exit 3 ;;
esac
EOF
chmod +x "$tmp/bin/gh"

# Fake git: records the fetch and the push (the only writes promote.sh makes).
cat >"$tmp/bin/git" <<'EOF'
#!/bin/sh
echo "git $*" >>"$FAKE_DIR/calls"
EOF
chmod +x "$tmp/bin/git"

# expect <pass|fail> <description> <expected call or message> [sha]
expect() {
  outcome="$1"
  description="$2"
  needle="$3"
  shift 3
  : >"$tmp/calls"
  if FAKE_DIR="$tmp" PATH="$tmp/bin:$PATH" REPO=o/r PUSH_REMOTE=git@github.com:o/r.git GITHUB_STEP_SUMMARY="" \
    sh "$script" "$@" >"$tmp/out" 2>&1; then
    actual=pass
  else
    actual=fail
  fi
  if [ "$actual" = "$outcome" ] && grep -qF -- "$needle" "$tmp/out" "$tmp/calls"; then
    echo "ok - $description"
  else
    echo "not ok - $description (expected $outcome with '$needle', got $actual)"
    sed 's/^/    /' "$tmp/out" "$tmp/calls"
    failures=$((failures + 1))
  fi
}

# state <main> <ci conclusion> <production or empty>, then the compare lines.
state() {
  printf 'main=%s\nci=%s\nproduction=%s\n' "$1" "$2" "$3" >"$tmp/state"
  : >"$tmp/compare"
}
compare() { echo "$1...$2 $3" >>"$tmp/compare"; }

state "$C" success "$A"
compare "$C" "$C" identical
compare "$A" "$C" ahead
expect pass "fast-forwards production to the head of main" "git push --quiet git@github.com:o/r.git $C:refs/heads/production"

state "$C" success "$A"
compare "$B" "$C" ahead
compare "$A" "$B" ahead
expect pass "promotes an older commit of main" "$B:refs/heads/production" "$B"

state "$C" success ""
compare "$C" "$C" identical
expect pass "creates the branch the first time" "git push --quiet git@github.com:o/r.git $C:refs/heads/production"

state "$C" success "$C"
compare "$C" "$C" identical
expect pass "does nothing when production is already there" "already at $C"

state "$C" failure "$A"
compare "$C" "$C" identical
expect fail "refuses a commit whose ci failed" "is 'failure', not success"

state "$C" "" "$A"
compare "$C" "$C" identical
expect fail "refuses a commit without ci" "is 'missing', not success"

state "$C" success "$A"
expect fail "refuses a commit that is not in main" "is not a commit of main" "$B"

state "$C" success "$B"
compare "$A" "$C" ahead
compare "$B" "$A" behind
expect fail "refuses to move production backwards" "is not a fast-forward" "$A"

state "$C" success "$A"
expect fail "refuses a short SHA" "full SHA" "abc123"

state "$C" success "$A"
expect fail "refuses something that is not a SHA" "full SHA" "main; rm -rf /"

if [ "$failures" -gt 0 ]; then
  echo "$failures test(s) failed"
  exit 1
fi
