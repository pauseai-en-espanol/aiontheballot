#!/usr/bin/env bash
# Every deployable whose code changed must be in the release plan, or CD won't rebuild its image: the API and web once
# went out needing migration 29 while the migration image kept its old tag, because no changeset named it.
#
# A deployable is an umbrella-chart dependency. It changed if a commit since the merge-base with the base touched it
# or one of its workspace dependencies (turbo; uncommitted work doesn't count, since it isn't being pushed). It is
# released if the changesets added since the base bump it (changeset status; a "none" entry is no release, which is
# how a devDependency's bump reaches web and admin). Changes to root files mark every deployable, conservatively.
#
# Usage: scripts/check-deployables-released.sh <base-ref>              fail if a changed deployable isn't released
#        scripts/check-deployables-released.sh --affected <base-ref>   print the changed deployables
set -euo pipefail
mode=check
if [ "${1:-}" = --affected ]; then
  mode=affected
  shift
fi
base="${1:?usage: $0 [--affected] <base-ref>}"
umbrella=helm-charts/aiontheballot

# After a force push the previous tip is on no branch, so the clone lacks it; GitHub still serves it by SHA.
if [[ "$base" =~ ^[0-9a-f]{40}$ ]] && ! git rev-parse --verify --quiet "$base^{commit}" > /dev/null; then
  git fetch --quiet --no-tags origin "$base" || true
fi
if ! git rev-parse --verify --quiet "$base^{commit}" > /dev/null; then
  echo "Base $base isn't in this clone (a new branch or a force push?), so releases can't be checked" >&2
  exit 1
fi

deployables=$(
  sed -n "s|^ *repository: *['\"]\{0,1\}file://\([^'\"]*\)['\"]\{0,1\} *$|\1|p" "$umbrella/Chart.yaml" |
    while read -r chart; do
      node -p "require('./$(dirname "$umbrella/$chart")/package.json').name" || exit 1
    done
)
if [ "$(wc -l <<< "$deployables")" -ne "$(grep -c '^ *repository:' "$umbrella/Chart.yaml")" ]; then
  echo "Couldn't read every dependency of $umbrella/Chart.yaml" >&2
  exit 1
fi

affected=$(
  pnpm exec turbo ls --filter="...[$base...HEAD]" --output=json |
    node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () =>
      console.log(JSON.parse(s).packages.items.map((p) => p.name).join("\n")))'
)
changed=$(comm -12 <(sort <<< "$deployables") <(sort <<< "$affected") | sed '/^$/d')

if [ "$mode" = affected ]; then
  [ -z "$changed" ] || echo "$changed"
  exit 0
fi

plan=$(mktemp)
errors=$(mktemp)
trap 'rm -f "$plan" "$errors"' EXIT
if ! pnpm exec changeset status --since="$base" --output="$plan" > /dev/null 2> "$errors"; then
  # Typically packages changed with no changeset at all: say so, and check against an empty plan.
  cat "$errors" >&2
  echo '{"releases": []}' > "$plan"
fi
released=$(PLAN="$plan" node -p "JSON.parse(require('node:fs').readFileSync(process.env.PLAN, 'utf8')).releases
  .filter((r) => r.type !== 'none').map((r) => r.name).join('\\n')")

missing=$(comm -23 <(sort <<< "$changed") <(sort <<< "$released") | sed '/^$/d')
if [ -n "$missing" ]; then
  echo "These deployables changed but no changeset releases them, so their images wouldn't be rebuilt:" >&2
  sed 's/^/  /' <<< "$missing" >&2
  echo "Run 'pnpm release:note' and include them." >&2
  exit 1
fi
echo "Every changed deployable is in the release plan"
