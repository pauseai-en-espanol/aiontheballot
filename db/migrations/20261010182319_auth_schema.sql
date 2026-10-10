-- migrate:up

-- Better Auth's tables (ADR-0002 §2, ADR-0003 §2): accounts, password hashes, TOTP secrets and backup codes,
-- sessions, verification tokens and the rate limiter's counters. They live in a schema of their own, owned like
-- everything else by aiontheballot_owner, and only aiontheballot_auth is granted on them, so no query run as the admin,
-- web or worker role can reach a credential. They hold no tenant data (one account can belong to several tenants), so
-- grants keep them apart, not RLS.
--
-- The tables are the ones Better Auth 1.7 generates for apps/api/src/auth/schema.ts (its migration, compiled, with the
-- schema added and one column per line); an API database test checks it finds nothing left to create or add.
--
-- The grants need the role, which the postgresql provisioning creates (gitops, PLAN O2): without it this stops here,
-- and nothing is applied.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aiontheballot_auth') THEN
    RAISE EXCEPTION 'aiontheballot_auth does not exist: add it to the postgresql values first (gitops, PLAN O2)';
  END IF;
END
$$;

CREATE SCHEMA auth;
COMMENT ON SCHEMA auth IS 'Better Auth''s tables: only aiontheballot_auth reaches them (ADR-0002 §2)';

CREATE TABLE auth.users (
  id uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL,
  image text,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  two_factor_enabled boolean
);

CREATE TABLE auth.sessions (
  id uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE TABLE auth.accounts (
  id uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE auth.verifications (
  id uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE auth.two_factors (
  id uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL PRIMARY KEY,
  secret text NOT NULL,
  backup_codes text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  verified boolean,
  failed_verification_count integer,
  locked_until timestamptz
);

CREATE TABLE auth.rate_limits (
  id uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL PRIMARY KEY,
  key text NOT NULL UNIQUE,
  count integer NOT NULL,
  last_request bigint NOT NULL
);

CREATE INDEX sessions_user_id_idx ON auth.sessions (user_id);
CREATE INDEX accounts_user_id_idx ON auth.accounts (user_id);
CREATE INDEX verifications_identifier_idx ON auth.verifications (identifier);
CREATE INDEX two_factors_secret_idx ON auth.two_factors (secret);
CREATE INDEX two_factors_user_id_idx ON auth.two_factors (user_id);

-- Personal data (spec §1). These tables have no audit trigger, so none of it is copied elsewhere. Better Auth deletes
-- an expired session when it next meets it, expired verification tokens on any lookup, and old rate-limit rows (keyed
-- by address) itself; deleting expired sessions it never meets again comes with sign-in (PLAN, M2).
COMMENT ON COLUMN auth.users.name IS 'personal data';
COMMENT ON COLUMN auth.users.email IS 'personal data';
COMMENT ON COLUMN auth.users.image IS 'personal data';
COMMENT ON COLUMN auth.sessions.ip_address IS 'personal data';
COMMENT ON COLUMN auth.sessions.user_agent IS 'personal data';
COMMENT ON COLUMN auth.rate_limits.key IS 'personal data';

-- Closed by default (ADR-0002 §6): nothing for PUBLIC, and for Better Auth's role only what it reads and writes.
REVOKE ALL ON SCHEMA auth FROM PUBLIC;
GRANT USAGE ON SCHEMA auth TO aiontheballot_auth;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON auth.users, auth.sessions, auth.accounts, auth.verifications, auth.two_factors, auth.rate_limits
  TO aiontheballot_auth;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
