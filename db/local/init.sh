#!/bin/sh
# Mirrors what the halyard `postgresql` chart provisions in the cluster: an owner role that owns the database, and
# runtime roles that own nothing and can never bypass row-level security. Local development only: the passwords
# come from compose.yaml and are not secrets.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner_pw="$AIONTHEBALLOT_OWNER_PASSWORD" -v web_pw="$AIONTHEBALLOT_WEB_PASSWORD" \
  -v admin_pw="$AIONTHEBALLOT_ADMIN_PASSWORD" -v worker_pw="$AIONTHEBALLOT_WORKER_PASSWORD" <<'SQL'
CREATE ROLE aiontheballot_owner WITH LOGIN PASSWORD :'owner_pw';
CREATE ROLE aiontheballot_web WITH LOGIN PASSWORD :'web_pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE aiontheballot_admin WITH LOGIN PASSWORD :'admin_pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE aiontheballot_worker WITH LOGIN PASSWORD :'worker_pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- `aiontheballot` for development, `aiontheballot_test` for the test suites (rebuilt from migrations on every run).
CREATE DATABASE aiontheballot OWNER aiontheballot_owner;
CREATE DATABASE aiontheballot_test OWNER aiontheballot_owner;
GRANT CONNECT ON DATABASE aiontheballot, aiontheballot_test TO aiontheballot_web, aiontheballot_admin, aiontheballot_worker;
SQL
