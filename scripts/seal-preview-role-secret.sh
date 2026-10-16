#!/usr/bin/env bash
# Adds what the preview's own database login needs (PLAN R181, ADR-0002 §2 and §7) to the sealed secrets in a gitops
# checkout: aiontheballot_preview, which the API uses only for the admin's preview of a site, and which reads what
# aiontheballot_web reads plus the elections in preview (never a draft's content).
# - its database role's password, merged into aiontheballot-db-credentials, so the other passwords stay as they are
#   and are never decrypted;
# - that role's connection, DATABASE_URL, in a new aiontheballot-preview-db for the API.
# Nothing secret is printed or written unencrypted: the values live in shell variables and reach kubectl through
# /dev/fd.
#
# Usage: scripts/seal-preview-role-secret.sh <path-to-gitops>
# Run once; it refuses to run twice. Then add the role to the database's provisioning (gitops), which creates it,
# before the release whose migration grants to it, and give the API PREVIEW_DATABASE_URL from this secret and
# PREVIEW_TOKEN from aiontheballot-preview-token (its env).
set -euo pipefail

GITOPS="${1:?usage: $0 <path-to-gitops>}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# The cluster's settings come from the environment or .env (scripts/lib/settings.sh, PLAN R205). KUBESEAL_ARGS
# names the cluster's context and sealing controller, or is "--cert cert.pem" for a dry run against a throwaway
# certificate.
. "$ROOT/scripts/lib/settings.sh"
kubeseal_args=$(required KUBESEAL_ARGS)
read -r -a KUBESEAL_ARGS <<<"$kubeseal_args"

PG_DIR="$GITOPS/$(required GITOPS_DATABASE_DIR)"
APP_DIR="$GITOPS/$(required GITOPS_SECRETS_DIR)"
DB_HOST=$(required DATABASE_SERVICE)
DATABASE_NAMESPACE=$(required DATABASE_NAMESPACE)
credentials="$PG_DIR/aiontheballot-db-credentials.yaml"
out="$APP_DIR/aiontheballot-preview-db.yaml"

fail() {
  echo "$1" >&2
  exit 1
}
[ -f "$credentials" ] || fail "$credentials is missing: run scripts/seal-gitops-secrets.sh first"
[ ! -e "$out" ] || fail "Refusing to overwrite $out"
! grep -Eq '^ +AIONTHEBALLOT_PREVIEW_PASSWORD:' "$credentials" ||
  fail "$credentials already has the preview role's password"
# One SealedSecret, as seal-gitops-secrets.sh writes it: merging into anything else could drop a document.
[ "$(grep -c '^kind:' "$credentials")" -eq 1 ] || fail "$credentials isn't a single SealedSecret"

# Everything is written beside its target and moved into place only at the end, so an interruption leaves the
# checkout as it was.
trap 'rm -f "$out.tmp" "$credentials.new"' EXIT

preview_pw="$(openssl rand -hex 32)"

url() { printf 'postgres://aiontheballot_preview:%s@%s/aiontheballot?sslmode=disable' "$1" "$DB_HOST"; }

# 1. The API's PREVIEW_DATABASE_URL, at sync wave -2 like the other app secrets (before the migration Job).
{
  printf '# yamllint disable rule:line-length\n'
  printf '# SealedSecret encryptedData contains long base64 strings that cannot be wrapped.\n'
  printf '# DATABASE_URL for aiontheballot_preview (the API, only for previews through the admin): %s\n' "$(url '<PREVIEW_PASSWORD>')"
  kubectl create secret generic aiontheballot-preview-db -n aiontheballot --dry-run=client -o yaml \
    --from-file=DATABASE_URL=<(url "$preview_pw") \
    | kubeseal "${KUBESEAL_ARGS[@]}" --format yaml \
    | kubectl annotate --local -f - "argocd.argoproj.io/sync-wave=-2" -o yaml
} >"$out.tmp" || fail "Failed to seal $out"

# 2. The password, merged into the provisioning hook's secret (into a copy). kubeseal rewrites the file without its
#    comments, so the leading ones are put back.
header="$(sed -e '/^---$/d' "$credentials" | sed -n '/^#/!q;p')"
sed -e '/^#/d' -e '/^---$/d' "$credentials" >"$credentials.new"
kubectl create secret generic aiontheballot-db-credentials -n "$DATABASE_NAMESPACE" --dry-run=client -o yaml \
  --from-file=AIONTHEBALLOT_PREVIEW_PASSWORD=<(printf %s "$preview_pw") \
  | kubeseal "${KUBESEAL_ARGS[@]}" --format yaml --merge-into "$credentials.new" ||
  fail "Failed to merge the password into $credentials"
merged="$(sed -e '/^---$/d' "$credentials.new")"
{
  [ -z "$header" ] || printf '%s\n' "$header"
  printf '%s\n' "$merged"
} >"$credentials.new"
mv "$out.tmp" "$out"
mv "$credentials.new" "$credentials"
echo "merged AIONTHEBALLOT_PREVIEW_PASSWORD into $credentials"
echo "sealed $out"

unset preview_pw
echo "Done. Review with: git -C \"$GITOPS\" status"
