#!/bin/sh
# Mirrors what the halyard `postgresql` chart provisions in the cluster: an owner role that owns the database, and
# runtime roles that own nothing and can never bypass row-level security. Local development only: the passwords
# come from compose.yaml and are not secrets.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner_pw="$BALLOT_OWNER_PASSWORD" -v web_pw="$BALLOT_WEB_PASSWORD" \
  -v admin_pw="$BALLOT_ADMIN_PASSWORD" -v worker_pw="$BALLOT_WORKER_PASSWORD" <<'SQL'
CREATE ROLE ballot_owner WITH LOGIN PASSWORD :'owner_pw';
CREATE ROLE ballot_web WITH LOGIN PASSWORD :'web_pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE ballot_admin WITH LOGIN PASSWORD :'admin_pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE ballot_worker WITH LOGIN PASSWORD :'worker_pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- `ballot` for development, `ballot_test` for the test suites (rebuilt from migrations on every run).
CREATE DATABASE ballot OWNER ballot_owner;
CREATE DATABASE ballot_test OWNER ballot_owner;
GRANT CONNECT ON DATABASE ballot, ballot_test TO ballot_web, ballot_admin, ballot_worker;
SQL
