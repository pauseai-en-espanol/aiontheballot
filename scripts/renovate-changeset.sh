#!/usr/bin/env bash
# Renovate PRs don't write changesets. Add a patch changeset for every workspace package the PR touches and every
# deployable it changes (scripts/check-deployables-released.sh: a root or devDependency bump changes deployables whose
# own directories it doesn't touch), or an empty one when there are none (same approach as gifcept).
# Usage: scripts/renovate-changeset.sh <base-ref>
set -euo pipefail
base="${1:?usage: $0 <base-ref>}"
if pnpm release:check > /dev/null 2>&1 && scripts/check-deployables-released.sh "$base" > /dev/null 2>&1; then
  echo "No changeset needed: one exists and releases every changed deployable, or the PR changes no package"
  exit 0
fi
paths=$(git diff --name-only "$(git merge-base "$base" HEAD)" HEAD | grep -E '^(apps/[^/]+|packages/[^/]+|db)/' |
  sed -E 's#^(apps/[^/]+|packages/[^/]+|db)/.*#\1#' | sort -u || true)
names=$(
  {
    for path in $paths; do
      if [ -f "$path/package.json" ]; then
        node -p "require('./$path/package.json').name"
      fi
    done
    scripts/check-deployables-released.sh --affected "$base"
  } | sort -u | sed '/^$/d'
)
if [ -z "$names" ]; then
  pnpm changeset add --empty
  exit 0
fi
file=".changeset/renovate-$(git rev-parse --short HEAD).md"
{
  echo '---'
  while read -r name; do
    echo "\"$name\": patch"
  done <<< "$names"
  echo '---'
  echo
  echo 'Dependencies bump'
} > "$file"
cat "$file"
