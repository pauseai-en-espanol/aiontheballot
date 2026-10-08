#!/usr/bin/env bash
# Renovate PRs don't write changesets. Add a patch changeset for every workspace package the PR touches, or an
# empty one when it touches none (same approach as gifcept). Usage: scripts/renovate-changeset.sh <base-ref>
set -euo pipefail
base="${1:?usage: $0 <base-ref>}"
if pnpm release:check > /dev/null 2>&1; then
  echo "No changeset needed: one exists, or the PR changes no package"
  exit 0
fi
paths=$(git diff --name-only "$(git merge-base "$base" HEAD)" HEAD | grep -E '^(apps/[^/]+|packages/[^/]+|db)/' |
  sed -E 's#^(apps/[^/]+|packages/[^/]+|db)/.*#\1#' | sort -u || true)
if [ -z "$paths" ]; then
  pnpm changeset add --empty
  exit 0
fi
file=".changeset/renovate-$(git rev-parse --short HEAD).md"
{
  echo '---'
  for path in $paths; do
    [ -f "$path/package.json" ] && echo "\"$(node -p "require('./$path/package.json').name")\": patch"
  done
  echo '---'
  echo
  echo 'Dependencies bump'
} > "$file"
cat "$file"
