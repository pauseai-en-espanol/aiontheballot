#!/bin/sh
# Mirrors the roles production's database has (ADR-0002 §2): an owner role that owns the database, and
# runtime roles that own nothing and can never bypass row-level security. Local development only: the passwords
# come from compose.yaml and are not secrets.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner_pw="$AIONTHEBALLOT_OWNER_PASSWORD" -v web_pw="$AIONTHEBALLOT_WEB_PASSWORD" \
  -v admin_pw="$AIONTHEBALLOT_ADMIN_PASSWORD" -v worker_pw="$AIONTHEBALLOT_WORKER_PASSWORD" \
  -v auth_pw="$AIONTHEBALLOT_AUTH_PASSWORD" -v sweeper_pw="$AIONTHEBALLOT_SWEEPER_PASSWORD" \
  -v preview_pw="$AIONTHEBALLOT_PREVIEW_PASSWORD" <<'SQL'
CREATE ROLE aiontheballot_owner WITH LOGIN PASSWORD :'owner_pw';
CREATE ROLE aiontheballot_web WITH LOGIN PASSWORD :'web_pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE aiontheballot_admin WITH LOGIN PASSWORD :'admin_pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE aiontheballot_worker WITH LOGIN PASSWORD :'worker_pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- Better Auth's: reaches only its own tables in the auth schema (ADR-0002 §2).
CREATE ROLE aiontheballot_auth WITH LOGIN PASSWORD :'auth_pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- The scheduled sweep's: executes private.file_sweep_list() and nothing else (ADR-0002 §2, PLAN R141).
CREATE ROLE aiontheballot_sweeper WITH LOGIN PASSWORD :'sweeper_pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- The admin's preview of a site: reads what aiontheballot_web reads, and elections in preview (ADR-0002 §7, PLAN R181).
CREATE ROLE aiontheballot_preview WITH LOGIN PASSWORD :'preview_pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- `aiontheballot` for development, `aiontheballot_test` for the test suites (rebuilt from migrations on every run).
CREATE DATABASE aiontheballot OWNER aiontheballot_owner;
CREATE DATABASE aiontheballot_test OWNER aiontheballot_owner;
GRANT CONNECT ON DATABASE aiontheballot, aiontheballot_test
  TO aiontheballot_web, aiontheballot_admin, aiontheballot_worker, aiontheballot_auth, aiontheballot_sweeper,
     aiontheballot_preview;
SQL
