#!/usr/bin/env bash
# Follows a pushed commit to production (PLAN R137): CI on the commit, the release it triggers, then Argo CD until it
# runs the release bot's commit, Synced and Healthy, and finally each address in WATCH_URLS (read-only throughout).
#
# Usage: scripts/watch-release.sh [sha]   (the pushed HEAD by default)
#
# Settings, from the environment or .env (scripts/lib/settings.sh; none is a secret): WATCH_URLS, the addresses that
# must answer 200 (after redirects), space-separated; KUBE_CONTEXT and ARGO_NAMESPACE, the cluster's; ARGO_APP and
# APP_NAMESPACE (both aiontheballot by default).
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
. scripts/lib/settings.sh
WATCH_URLS=$(setting WATCH_URLS)
KUBE_CONTEXT=$(required KUBE_CONTEXT) || exit 1
ARGO_NAMESPACE=$(required ARGO_NAMESPACE) || exit 1
ARGO_APP=$(setting ARGO_APP aiontheballot)
APP_NAMESPACE=$(setting APP_NAMESPACE aiontheballot)
sha=$(git rev-parse "${1:-HEAD}")

run_of() {
  gh run list --workflow "$1" --limit 30 --json databaseId,headSha,status,conclusion \
    --jq "[.[] | select(.headSha == \"$sha\")] | first | \"\(.databaseId) \(.status) \(.conclusion)\"" 2>/dev/null
}

# CI, then the release that follows it (a workflow_run on the same commit). Up to an hour each.
for workflow in ci.yml release.yml; do
  outcome=''
  for _ in $(seq 1 180); do
    read -r id status conclusion <<< "$(run_of "$workflow")"
    if [ "${status:-}" = completed ]; then
      outcome=$conclusion
      echo "$workflow: run $id $conclusion"
      break
    fi
    sleep 20
  done
  # A release with nothing to build is skipped; Argo then runs the pushed commit itself.
  if [ "$outcome" != success ] && ! { [ "$workflow" = release.yml ] && [ "$outcome" = skipped ]; }; then
    echo "$workflow did not succeed (${outcome:-still running after an hour}): gh run view ${id:-}"
    exit 1
  fi
done

# The release bot commits the new image tags on top: Argo must be running that commit.
git fetch -q origin
target=$(git rev-parse origin/main)
echo "waiting for Argo CD to run $(git log -1 --format='%h %s' "$target")"
state=''
for _ in $(seq 1 90); do
  # A multi-source application: this repository is its first source.
  state=$(kubectl --context "$KUBE_CONTEXT" -n "$ARGO_NAMESPACE" get application "$ARGO_APP" \
    -o jsonpath='{.status.sync.status} {.status.health.status} {.status.sync.revisions[0]}' 2>/dev/null)
  if [ "$state" = "Synced Healthy $target" ]; then
    break
  fi
  sleep 20
done
echo "argo: $state"
kubectl --context "$KUBE_CONTEXT" -n "$APP_NAMESPACE" get pods --no-headers 2>/dev/null |
  awk '{print "  " $1, $2, $3, $4}'
if [ "$state" != "Synced Healthy $target" ]; then
  echo "Argo CD is not running $target, Synced and Healthy, after 30 minutes"
  exit 1
fi

failed=0
for url in $WATCH_URLS; do
  code=$(curl -sL -o /dev/null -w '%{http_code}' --max-time 20 "$url")
  echo "$url: $code"
  [ "$code" = 200 ] || failed=1
done
[ -n "$WATCH_URLS" ] || echo "WATCH_URLS is not set: no address checked"
exit $failed
