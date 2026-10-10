#!/usr/bin/env bash
# Adds aiontheballot_auth, Better Auth's database role (ADR-0002 §2), to the sealed secrets in a gitops checkout. Its
# password is merged into aiontheballot-db-credentials, so the other passwords stay as they are and are never
# decrypted, and its DATABASE_URL is sealed into a new aiontheballot-auth-db for the API. Nothing secret is printed or
# written unencrypted: the password lives in a shell variable and reaches kubectl through /dev/fd.
#
# Usage: scripts/seal-auth-role-secret.sh <path-to-gitops>
# Run once, after scripts/seal-gitops-secrets.sh made the other secrets; it refuses to run twice. Then add the role to
# the postgresql values (databases[].extraRoles, beside aiontheballot_worker), whose provisioning hook creates it.
set -euo pipefail

GITOPS="${1:?usage: $0 <path-to-gitops>}"
# Overridable for a dry run against a throwaway certificate (KUBESEAL_ARGS="--cert cert.pem").
read -r -a KUBESEAL_ARGS <<<"${KUBESEAL_ARGS:---context danilupion.com --controller-namespace sealed-secrets --controller-name sealed-secrets}"

PG_DIR="$GITOPS/clusters/danilupion-com/resources/data/postgresql"
APP_DIR="$GITOPS/clusters/danilupion-com/resources/apps/aiontheballot/secrets"
DB_HOST="postgresql.postgresql.svc.cluster.local:5432"
credentials="$PG_DIR/aiontheballot-db-credentials.yaml"
out="$APP_DIR/aiontheballot-auth-db.yaml"

fail() {
  echo "$1" >&2
  exit 1
}
[ -f "$credentials" ] || fail "$credentials is missing: run scripts/seal-gitops-secrets.sh first"
[ ! -e "$out" ] || fail "Refusing to overwrite $out"
! grep -Eq '^ +AIONTHEBALLOT_AUTH_PASSWORD:' "$credentials" || fail "$credentials already has the auth role's password"
# One SealedSecret, as seal-gitops-secrets.sh writes it: merging into anything else could drop a document.
[ "$(grep -c '^kind:' "$credentials")" -eq 1 ] || fail "$credentials isn't a single SealedSecret"

# Everything is written beside its target and moved into place only at the end, so an interruption leaves the
# checkout as it was.
trap 'rm -f "$out.tmp" "$credentials.new"' EXIT

auth_pw="$(openssl rand -hex 32)"

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

# 2. The password, merged into the provisioning hook's secret (into a copy). kubeseal rewrites the file without its
#    comments, so the leading ones are put back.
header="$(sed -e '/^---$/d' "$credentials" | sed -n '/^#/!q;p')"
sed -e '/^#/d' -e '/^---$/d' "$credentials" >"$credentials.new"
kubectl create secret generic aiontheballot-db-credentials -n postgresql --dry-run=client -o yaml \
  --from-file=AIONTHEBALLOT_AUTH_PASSWORD=<(printf %s "$auth_pw") \
  | kubeseal "${KUBESEAL_ARGS[@]}" --format yaml --merge-into "$credentials.new" ||
  fail "Failed to merge the password into $credentials"
merged="$(sed -e '/^---$/d' "$credentials.new")"
{
  [ -z "$header" ] || printf '%s\n' "$header"
  printf '%s\n' "$merged"
} >"$credentials.new"
mv "$out.tmp" "$out"
mv "$credentials.new" "$credentials"
echo "merged AIONTHEBALLOT_AUTH_PASSWORD into $credentials"
echo "sealed $out"

unset auth_pw
echo "Done. Review with: git -C \"$GITOPS\" status"
