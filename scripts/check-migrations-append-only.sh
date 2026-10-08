#!/usr/bin/env bash
# Migrations are forward-only and never edited once merged (CONTRIBUTING.md): a change may only add files to
# db/migrations. Usage: scripts/check-migrations-append-only.sh <base-ref>
set -euo pipefail
base="${1:?usage: $0 <base-ref>}"
if ! git rev-parse --verify --quiet "$base^{commit}" > /dev/null; then
  echo "Base $base isn't in this clone (a new branch or a force push?), so migrations can't be checked" >&2
  exit 1
fi
changed=$(git diff --name-status --no-renames "$(git merge-base "$base" HEAD)" HEAD -- db/migrations | grep -v '^A' || true)
if [ -n "$changed" ]; then
  echo "Merged migrations must not change. Add a new migration instead:" >&2
  echo "$changed" >&2
  exit 1
fi
echo "db/migrations: only additions"
