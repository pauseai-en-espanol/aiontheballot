#!/usr/bin/env bash
# Seals the registry pull secret alone, for when the pull robot's secret changes (renewed in the registry) or was
# mistyped, without regenerating the database passwords that scripts/seal-gitops-secrets.sh seals with it. Before
# sealing, it asks the registry's token service for a token as the cluster will, so a wrong secret, or a robot without
# pull rights, is caught here rather than as a 401 in the cluster. Nothing secret is printed or written unencrypted:
# the secret reaches curl and jq through stdin and kubectl through /dev/fd, never argv or the environment.
#
# Usage: scripts/seal-registry-pull-secret.sh <path-to-gitops>
# Run it in a terminal, from a machine that reaches the registry: it asks for the robot's secret (input hidden), and
# replaces the existing pull secret (CREATE=1 writes one where there is none). The cluster, the gitops layout and the
# registry come from the environment or .env (scripts/lib/settings.sh, PLAN R205); REGISTRY_PROBE_REPOSITORY is the
# image the check asks to pull (the migrations job's, which runs first). CHECK_ONLY=1 checks the secret and seals
# nothing. REGISTRY_CHECK_URL, from the environment only, sends the check to a stand-in instead of
# https://$REGISTRY_HOST, for a dry run: it then seals only against a throwaway certificate (KUBESEAL_ARGS --cert).
set -euo pipefail
set +x # a trace would print the secret
# Never exported to the tools below, even if the caller's shell exports these names.
unset REGISTRY_SECRET secret_q config

GITOPS="${1:?usage: $0 <path-to-gitops>}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
. "$ROOT/scripts/lib/settings.sh"
for tool in curl jq kubectl kubeseal; do
  command -v "$tool" >/dev/null || { echo "$tool is missing" >&2; exit 1; }
done
kubeseal_args=$(required KUBESEAL_ARGS)
read -r -a KUBESEAL_ARGS <<<"$kubeseal_args"
APP_DIR="$GITOPS/$(required GITOPS_SECRETS_DIR)"
REGISTRY_HOST=$(required REGISTRY_HOST)
REGISTRY_ROBOT=$(required REGISTRY_ROBOT)
REGISTRY_PULL_SECRET=$(required REGISTRY_PULL_SECRET)
PROBE=$(setting REGISTRY_PROBE_REPOSITORY aiontheballot/migrations)

OUT="$APP_DIR/$REGISTRY_PULL_SECRET.yaml"
[ -d "$APP_DIR" ] || { echo "Not a gitops checkout with aiontheballot: $APP_DIR is missing" >&2; exit 1; }
if [ ! -f "$OUT" ] && [ -z "${CREATE:-}" ] && [ -z "${CHECK_ONLY:-}" ]; then
  echo "$OUT doesn't exist: check REGISTRY_PULL_SECRET, or set CREATE=1 to write a new pull secret" >&2
  exit 1
fi

# curl only over HTTPS, and never reading ~/.curlrc (-q, first), which could log the Authorization header. A stand-in
# (REGISTRY_URL) may be plain HTTP.
curl_opts=(-q -sS --max-time 15)
if [ -n "${REGISTRY_CHECK_URL:-}" ]; then
  REGISTRY_URL=${REGISTRY_CHECK_URL%/}
  echo "Checking against $REGISTRY_URL (REGISTRY_CHECK_URL), not the registry"
  if [ -z "${CHECK_ONLY:-}" ] && [[ " ${KUBESEAL_ARGS[*]} " != *" --cert "* ]]; then
    echo "REGISTRY_CHECK_URL is for dry runs: seal against a throwaway certificate (KUBESEAL_ARGS --cert), or" >&2
    echo "unset it" >&2
    exit 1
  fi
else
  REGISTRY_URL="https://$REGISTRY_HOST"
  curl_opts+=(--proto =https --proto-redir =https)
fi

printf 'Secret of %s on %s: ' "$REGISTRY_ROBOT" "$REGISTRY_HOST"
IFS= read -rs REGISTRY_SECRET || true
echo
[ -n "$REGISTRY_SECRET" ] || { echo "Empty registry secret" >&2; exit 1; }

# The registry's token service, found as the cluster finds it: /v2/ answers 401 with a Bearer challenge naming the
# realm (where tokens come from) and the service.
headers=$(curl "${curl_opts[@]}" -o /dev/null -D - "$REGISTRY_URL/v2/" | tr -d '\r') ||
  { echo "Couldn't reach $REGISTRY_URL/v2/" >&2; exit 1; }
challenge=$(sed -n 's/^[Ww][Ww][Ww]-[Aa]uthenticate: *[Bb]earer //p' <<<"$headers" | head -n 1)
realm=$(sed -n 's/.*realm="\([^"]*\)".*/\1/p' <<<"$challenge")
service=$(sed -n 's/.*service="\([^"]*\)".*/\1/p' <<<"$challenge")
if [ -z "$realm" ]; then
  echo "No Bearer challenge from $REGISTRY_URL/v2/ ($(head -n 1 <<<"$headers")): is that the registry?" >&2
  exit 1
fi
# The credentials go only to the registry itself, whatever realm it names.
if [[ "$realm" != "$REGISTRY_URL"/* ]]; then
  echo "The registry names a token service elsewhere ($realm): not sending the secret there" >&2
  exit 1
fi

# token_request [scope]: the answer's body, a new line, and its HTTP status. The credentials go through curl's config
# on stdin, quoted as its format wants (\ and " escaped).
robot_q=${REGISTRY_ROBOT//\\/\\\\}
robot_q=${robot_q//\"/\\\"}
secret_q=${REGISTRY_SECRET//\\/\\\\}
secret_q=${secret_q//\"/\\\"}
token_request() {
  local scope_args=()
  [ -z "${1:-}" ] || scope_args=(--data-urlencode "scope=$1")
  printf 'user = "%s:%s"\n' "$robot_q" "$secret_q" |
    curl "${curl_opts[@]}" -K - -G -w '\n%{http_code}' --data-urlencode "service=$service" \
      ${scope_args[@]+"${scope_args[@]}"} --url "$realm" || true
}

# First without a scope, as `docker login` asks: the token service answers a wrong secret, or a disabled or expired
# robot, with 401. (With a scope it would hand out an anonymous token instead, which grants only what anonymous gets.)
answer=$(token_request)
case "${answer##*$'\n'}" in
  200) ;;
  401)
    echo "The registry refuses this robot and secret: renew the robot there (its secret, and its expiry if it" >&2
    echo "lapsed) and paste the new secret" >&2
    exit 1
    ;;
  *)
    echo "Couldn't check with the registry (answer: ${answer##*$'\n'})" >&2
    exit 1
    ;;
esac

# Then with the probe's pull scope: the token must be the robot's, not anonymous, and grant pull on the probe. The
# token is a JWT: its claims are the middle part, in unpadded base64url.
answer=$(token_request "repository:$PROBE:pull")
[ "${answer##*$'\n'}" = 200 ] || { echo "Couldn't get a pull token (answer: ${answer##*$'\n'})" >&2; exit 1; }
claims=$(printf '%s' "${answer%$'\n'*}" | jq -er --arg probe "$PROBE" '
  (.token // .access_token) | split(".")[1] | gsub("-"; "+") | gsub("_"; "/")
  | . as $p | $p + ("===" | .[0:((4 - ($p | length) % 4) % 4)]) | @base64d | fromjson
  | (.sub // ""),
    ([.access[]? | select(.type == "repository" and .name == $probe) | .actions[]?] | join(","))' 2>/dev/null) ||
  { echo "Couldn't read the registry's token" >&2; exit 1; }
subject=$(head -n 1 <<<"$claims")
granted=$(sed -n 2p <<<"$claims")
# The subject is the robot's name, with or without the registry's robot prefix (robot$ by default).
if [ -z "$subject" ] || { [ "$subject" != "$REGISTRY_ROBOT" ] && [ "$subject" != "${REGISTRY_ROBOT#*\$}" ]; }; then
  echo "The registry didn't issue the token to $REGISTRY_ROBOT (${subject:-anonymous}): it refuses this secret" >&2
  exit 1
fi
if [[ ",$granted," != *",pull,"* ]]; then
  echo "The registry accepts the secret, but the robot can't pull $PROBE: give it pull rights on the project," >&2
  echo "then run this again" >&2
  exit 1
fi
echo "The registry accepts the secret, and the robot can pull $PROBE"
if [ -n "${CHECK_ONLY:-}" ]; then
  echo "CHECK_ONLY: nothing sealed"
  exit 0
fi

# Built before sealing, so a failure stops here rather than sealing an empty config.
config=$(printf '%s' "$REGISTRY_SECRET" | jq -Rsc --arg host "$REGISTRY_HOST" --arg robot "$REGISTRY_ROBOT" '
  {auths: {($host): {username: $robot, password: ., auth: ("\($robot):\(.)" | @base64)}}}')
unset REGISTRY_SECRET secret_q

# The same file, header and sync wave as scripts/seal-gitops-secrets.sh writes: wave -2, so Argo CD applies it before
# the migrations job (wave -1) and the Deployments (wave 0).
tmp="$OUT.tmp"
trap 'rm -f "$tmp"' EXIT
if ! {
  printf '# yamllint disable rule:line-length\n'
  printf '# SealedSecret encryptedData contains long base64 strings that cannot be wrapped.\n'
  printf '# Pull secret for %s/aiontheballot (%s, pull only), on the default SA.\n' "$REGISTRY_HOST" "$REGISTRY_ROBOT"
  kubectl create secret generic "$REGISTRY_PULL_SECRET" -n aiontheballot --type=kubernetes.io/dockerconfigjson \
    --from-file=.dockerconfigjson=<(printf '%s' "$config") --dry-run=client -o yaml \
    | kubeseal "${KUBESEAL_ARGS[@]}" --format yaml \
    | kubectl annotate --local -f - "argocd.argoproj.io/sync-wave=-2" -o yaml
} >"$tmp" || ! grep -q '^kind: SealedSecret$' "$tmp" || ! grep -q '^ *\.dockerconfigjson: ' "$tmp"; then
  echo "Failed to seal $OUT" >&2
  exit 1
fi
mv "$tmp" "$OUT"
echo "sealed $OUT"
echo "Done. Commit and push it in gitops. A sync already running stays on its revision until it ends: to skip the"
echo "wait, terminate it in Argo CD and sync the whole application (docs/runbooks/incidents.md §3)."
