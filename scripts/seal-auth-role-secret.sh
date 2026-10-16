#!/usr/bin/env bash
# Adds what Better Auth needs (ADR-0002 §2, ADR-0003 §2) to the sealed secrets in a gitops checkout:
# - its database role's password, merged into aiontheballot-db-credentials, so the other passwords stay as they are
#   and are never decrypted;
# - that role's DATABASE_URL, in a new aiontheballot-auth-db for the API;
# - the key it signs sessions and tokens with, BETTER_AUTH_SECRET, in a new aiontheballot-better-auth.
# Nothing secret is printed or written unencrypted: the values live in shell variables and reach kubectl through
# /dev/fd.
#
# Usage: scripts/seal-auth-role-secret.sh <path-to-gitops>
# Run once, after scripts/seal-gitops-secrets.sh made the other secrets; it refuses to run twice. Then add the role to
# the database's provisioning (gitops), which creates it.
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
out="$APP_DIR/aiontheballot-auth-db.yaml"
signing="$APP_DIR/aiontheballot-better-auth.yaml"

fail() {
  echo "$1" >&2
  exit 1
}
[ -f "$credentials" ] || fail "$credentials is missing: run scripts/seal-gitops-secrets.sh first"
[ ! -e "$out" ] || fail "Refusing to overwrite $out"
[ ! -e "$signing" ] || fail "Refusing to overwrite $signing"
! grep -Eq '^ +AIONTHEBALLOT_AUTH_PASSWORD:' "$credentials" || fail "$credentials already has the auth role's password"
# One SealedSecret, as seal-gitops-secrets.sh writes it: merging into anything else could drop a document.
[ "$(grep -c '^kind:' "$credentials")" -eq 1 ] || fail "$credentials isn't a single SealedSecret"

# Everything is written beside its target and moved into place only at the end, so an interruption leaves the
# checkout as it was.
trap 'rm -f "$out.tmp" "$signing.tmp" "$credentials.new"' EXIT

auth_pw="$(openssl rand -hex 32)"
auth_secret="$(openssl rand -hex 32)"

url() { printf 'postgres://aiontheballot_auth:%s@%s/aiontheballot?sslmode=disable' "$1" "$DB_HOST"; }

# 1. The API's DATABASE_URL for the role, at sync wave -2 like the other app secrets (before the migration Job). Sealed
#    aside first, so a failure in either step leaves the checkout as it was.
{
  printf '# yamllint disable rule:line-length\n'
  printf '# SealedSecret encryptedData contains long base64 strings that cannot be wrapped.\n'
  printf '# DATABASE_URL for aiontheballot_auth (Better Auth, in the API): %s\n' "$(url '<AUTH_PASSWORD>')"
  kubectl create secret generic aiontheballot-auth-db -n aiontheballot --dry-run=client -o yaml \
    --from-file=DATABASE_URL=<(url "$auth_pw") \
    | kubeseal "${KUBESEAL_ARGS[@]}" --format yaml \
    | kubectl annotate --local -f - "argocd.argoproj.io/sync-wave=-2" -o yaml
} >"$out.tmp" || fail "Failed to seal $out"

# 2. Better Auth's signing key, for the API, at the same wave.
{
  printf '# yamllint disable rule:line-length\n'
  printf '# SealedSecret encryptedData contains long base64 strings that cannot be wrapped.\n'
  printf '# BETTER_AUTH_SECRET: the key Better Auth signs sessions and tokens with (openssl rand -hex 32).\n'
  kubectl create secret generic aiontheballot-better-auth -n aiontheballot --dry-run=client -o yaml \
    --from-file=BETTER_AUTH_SECRET=<(printf %s "$auth_secret") \
    | kubeseal "${KUBESEAL_ARGS[@]}" --format yaml \
    | kubectl annotate --local -f - "argocd.argoproj.io/sync-wave=-2" -o yaml
} >"$signing.tmp" || fail "Failed to seal $signing"

# 3. The password, merged into the provisioning hook's secret (into a copy). kubeseal rewrites the file without its
#    comments, so the leading ones are put back.
header="$(sed -e '/^---$/d' "$credentials" | sed -n '/^#/!q;p')"
sed -e '/^#/d' -e '/^---$/d' "$credentials" >"$credentials.new"
kubectl create secret generic aiontheballot-db-credentials -n "$DATABASE_NAMESPACE" --dry-run=client -o yaml \
  --from-file=AIONTHEBALLOT_AUTH_PASSWORD=<(printf %s "$auth_pw") \
  | kubeseal "${KUBESEAL_ARGS[@]}" --format yaml --merge-into "$credentials.new" ||
  fail "Failed to merge the password into $credentials"
merged="$(sed -e '/^---$/d' "$credentials.new")"
{
  [ -z "$header" ] || printf '%s\n' "$header"
  printf '%s\n' "$merged"
} >"$credentials.new"
mv "$out.tmp" "$out"
mv "$signing.tmp" "$signing"
mv "$credentials.new" "$credentials"
echo "merged AIONTHEBALLOT_AUTH_PASSWORD into $credentials"
echo "sealed $out"
echo "sealed $signing"

unset auth_pw auth_secret
echo "Done. Review with: git -C \"$GITOPS\" status"
