-- migrate:up

-- Which sessions completed TOTP (ADR-0002 §9, PLAN R84). The API sets app.aal = '2' only for a session whose `aal` is 2,
-- which Better Auth's database hook writes only when a TOTP or backup code creates the session. Every other session,
-- such as the one a password alone opens so that a new account can enrol, is written as 1 and stays so: a session
-- opened before its user enrolled never becomes aal2 because they enrolled elsewhere.
--
-- The column ends as Better Auth 1.7 creates it for the session field in apps/api/src/auth/schema.ts, with no default
-- (Better Auth writes the field on every insert); the API's database test compares the two catalogs. The default here
-- only fills any session that already exists, which a password alone opened. Its grants are the table's
-- (aiontheballot_auth only, migration auth_schema).
ALTER TABLE auth.sessions ADD COLUMN aal integer DEFAULT 1 NOT NULL;
ALTER TABLE auth.sessions ALTER COLUMN aal DROP DEFAULT;
COMMENT ON COLUMN auth.sessions.aal IS
  '2 only for a session created by a TOTP or backup-code verification; the API sets app.aal from it';

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
