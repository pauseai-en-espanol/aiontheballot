#!/usr/bin/env bash
# Lists the deployables CD must release: each umbrella-chart dependency whose package version is ahead of the image
# tag in the umbrella values.yaml. Tags are "<version>.<short sha>", so only the version part is compared. Changesets
# bumps an app whenever one of its workspace dependencies is bumped, so a version change covers both.
#
# Comparing against the chart, rather than diffing the last commit, makes CD idempotent: a failed or skipped run is
# picked up by the next one. Output: "<chart key> <package name> <version>" per deployable. Requires yq.
set -euo pipefail
umbrella=helm-charts/aiontheballot
while read -r key repository; do
  # Each subchart lives in <package>/helm-chart.
  package="$(dirname "$umbrella/${repository#file://}")"
  name=$(node -p "require('./$package/package.json').name")
  version=$(node -p "require('./$package/package.json').version")
  tag=$(KEY="$key" yq '.[env(KEY)].image.tag // ""' "$umbrella/values.yaml")
  if [ "${tag%.*}" != "$version" ]; then
    echo "$key $name $version"
  fi
done < <(yq '.dependencies[] | .name + " " + .repository' "$umbrella/Chart.yaml")
