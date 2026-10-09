-- migrate:up

-- Migrations run as the database owner (aiontheballot_owner). The runtime roles aiontheballot_web, aiontheballot_admin and
-- aiontheballot_worker are created by the cluster's Postgres provisioning, own nothing and cannot bypass RLS
-- (ADR-0002 §2). Migrations are forward-only: every down block is empty.

-- Only roles granted CONNECT explicitly may reach this database; other apps on the shared instance cannot.
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
END
$$;

-- Nothing is reachable through the public schema; it only holds dbmate's bookkeeping.
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- Closed by default: functions created by the owner are not executable by PUBLIC. Every grant is explicit
-- (ADR-0002 §6).
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- `app` holds the tables; `private` holds helper functions, never tables.
CREATE SCHEMA app;
CREATE SCHEMA private;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

-- Runtime roles can look objects up in these schemas. Table and function privileges are granted one by one.
GRANT USAGE ON SCHEMA app TO aiontheballot_web, aiontheballot_admin, aiontheballot_worker;
GRANT USAGE ON SCHEMA private TO aiontheballot_web, aiontheballot_admin, aiontheballot_worker;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
