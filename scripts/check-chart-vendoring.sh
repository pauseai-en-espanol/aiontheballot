#!/usr/bin/env bash
# The umbrella chart vendors its subcharts as .tgz files (`helm dependency update`), and Argo CD deploys those copies.
# Check that each one matches its source directory, so a template change can't merge without being re-vendored.
set -euo pipefail
umbrella=helm-charts/ballot
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
status=0
while read -r name version repository; do
  src="$umbrella/${repository#file://}"
  tgz="$umbrella/charts/$name-$version.tgz"
  if [ ! -f "$tgz" ]; then
    echo "$tgz is missing" >&2
    status=1
    continue
  fi
  mkdir -p "$work/$name"
  tar -xzf "$tgz" -C "$work/$name"
  # Helm re-serialises Chart.yaml when packaging, so compare it as Helm reads it, and everything else byte for byte.
  if ! diff -r -x Chart.yaml "$src" "$work/$name/$name" ||
    ! diff <(helm show chart "$src") <(helm show chart "$tgz"); then
    echo "$tgz doesn't match $src" >&2
    status=1
  fi
done < <(helm dependency list "$umbrella" | awk -F'\t' 'NR > 1 && NF { gsub(/ /, ""); print $1, $2, $3 }')
if [ "$status" -ne 0 ]; then
  echo "Re-vendor with: helm dependency update $umbrella" >&2
  exit 1
fi
echo "Vendored subcharts match their sources"
