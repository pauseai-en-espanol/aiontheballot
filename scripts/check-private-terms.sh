#!/usr/bin/env bash
# Fails when a term naming the operator's infrastructure appears in this public repository (PLAN R205): in the working
# tree (tracked files, and new ones .gitignore doesn't exclude), and, given a base, in every commit after it (each
# commit's files and its message), since a term added in one commit and removed in the next is still published. The
# terms are themselves private, so they never live here: PRIVATE_TERMS, separated by commas or new lines, comes from
# the environment (in CI, a repository secret) or the gitignored .env. Unset, nothing is checked, unless
# REQUIRE_PRIVATE_TERMS is true.
#
# Prints where a term is (locally file and line, in CI only how many places), never the term: CI's logs are public,
# and a place in a public diff would tell which word is private.
#
# Usage: scripts/check-private-terms.sh [base]
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
. scripts/lib/settings.sh
TERMS=$(setting PRIVATE_TERMS)
patterns=$(tr ',' '\n' <<<"$TERMS" | sed -e 's/^ *//' -e 's/ *$//' -e '/^$/d')
if [ -z "$patterns" ]; then
  if [ "${REQUIRE_PRIVATE_TERMS:-}" = true ]; then
    echo "PRIVATE_TERMS is not set, and this run requires it"
    exit 1
  fi
  echo "PRIVATE_TERMS is not set: no private term checked"
  exit 0
fi

# Each place, as file:line or commit:file. In CI, only their number.
report() {
  if [ "${GITHUB_ACTIONS:-}" = true ]; then
    echo "$1: $(wc -l <<<"$2" | tr -d ' ') (run scripts/check-private-terms.sh locally to see where)"
  else
    echo "$1:"
    sed 's/^/  /' <<<"$2"
  fi
}

# search <label> <git grep arguments...>: git grep's status is 1 for no match and 2 or more for an error.
found=0
search() {
  local label=$1 hits status
  shift
  hits=$(git grep -I -i -F -n -f <(printf '%s\n' "$patterns") "$@")
  status=$?
  if [ "$status" -gt 1 ]; then
    echo "git grep failed ($status): nothing was checked"
    exit 2
  fi
  if [ -n "$hits" ]; then
    report "$label" "$(cut -d: -f1-2 <<<"$hits")"
    found=1
  fi
}

search "A private term appears in the working tree" --untracked -- .
if [ -n "${1:-}" ]; then
  git rev-parse -q --verify "$1^{commit}" >/dev/null || { echo "Unknown base: $1"; exit 2; }
  for commit in $(git rev-list "$1..HEAD"); do
    short=$(git rev-parse --short "$commit")
    search "A private term appears in the files of commit $short" "$commit" --
    message=$(git log -1 --format=%B "$commit")
    if grep -q -i -F -f <(printf '%s\n' "$patterns") <<<"$message"; then
      echo "A private term appears in the message of commit $short"
      found=1
    fi
  done
fi
[ "$found" = 0 ] && echo "No private term found"
exit "$found"
