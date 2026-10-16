-- migrate:up

-- The scheduled sweep's one permission (PLAN R117, R141; ADR-0002 §2 and §6; ADR-0004 §5). The sweep of orphaned
-- bytes (PLAN R75) needs the list of every file key a row names, and of when rows stopped naming the others: every
-- tenant's rows, which RLS keeps from every runtime role. This function, owned by the tables' owner (whom their RLS
-- doesn't filter, since no table forces it), returns that list and nothing else, a line per row in the format
-- `sweep-files` reads: file rows, brand assets, the keys rows stopped naming with when, then the `end` line with the
-- count, the snapshot, the audit sequence, the database's incarnation and whether every row was seen. Lines are
-- ordered by `k` (the `end` line last). The owner's manual sweep reads the same function, so there is one list.
--
-- Every relation it reads is named with its schema, pg_catalog's included: with an empty search_path Postgres still
-- looks in the session's temporary schema first for an unqualified one, so a caller could otherwise put a view of its own
-- under a catalog's name and have it run as the owner.
--
-- Only aiontheballot_sweeper, the CronJob's own login, may execute it. The role is provisioned with the database
-- (gitops), not by a migration: if it doesn't exist yet when this runs, its grants wait for the owner to run them once
-- it does (PLAN R141 has the statements), and nobody else can call the function meanwhile.

CREATE FUNCTION private.file_sweep_list() RETURNS TABLE (k int, line text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = ''
  AS $$
    WITH named AS (
      SELECT f.tenant_id || ' ' || f.bucket || ' ' || f.sha256 AS line FROM app.files f
      UNION ALL
      SELECT 'platform ' || b.sha256 FROM app.brand_assets b
      UNION ALL
      SELECT 'deleted '
             || CASE WHEN a.table_name = 'files'
                     THEN (a.diff -> 'old' ->> 'tenant_id') || ' ' || (a.diff -> 'old' ->> 'bucket') || ' '
                     ELSE 'platform ' END
             || (a.diff -> 'old' ->> 'sha256') || ' '
             || to_char(max(a.at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        FROM app.audit_log a
       WHERE a.table_name IN ('files', 'brand_assets')
         AND (a.action = 'delete'
              OR (a.table_name = 'brand_assets' AND a.action = 'update' AND a.diff -> 'old' ? 'sha256'))
       GROUP BY a.table_name, a.diff -> 'old' ->> 'tenant_id', a.diff -> 'old' ->> 'bucket',
                a.diff -> 'old' ->> 'sha256'
    )
    SELECT 0, named.line FROM named
    UNION ALL
    SELECT 1, 'end ' || (SELECT count(*) FROM named)
           || ' ' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
           || ' ' || coalesce(pg_sequence_last_value('app.audit_log_id_seq'), 0)
           || ' ' || (SELECT pg_catalog.to_hex(system_identifier) FROM pg_catalog.pg_control_system())
           || '-' || (SELECT timeline_id FROM pg_catalog.pg_control_checkpoint())
           || '-' || (SELECT oid FROM pg_catalog.pg_database WHERE datname = pg_catalog.current_database())
           || '-' || 'app.audit_log'::regclass::oid
           -- Every row seen: row security off, a role above it, or (as here) the tables' owner, none forcing it.
           || ' ' || (current_setting('row_security') = 'off'
                      OR (SELECT r.rolsuper OR r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = current_user)
                      OR NOT EXISTS (
                        SELECT 1 FROM pg_catalog.pg_class c
                         WHERE c.oid IN ('app.files'::regclass, 'app.brand_assets'::regclass, 'app.audit_log'::regclass)
                           AND (c.relforcerowsecurity
                                OR c.relowner <> (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = current_user))))
  $$;

REVOKE ALL ON FUNCTION private.file_sweep_list() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aiontheballot_sweeper') THEN
    GRANT USAGE ON SCHEMA private TO aiontheballot_sweeper;
    GRANT EXECUTE ON FUNCTION private.file_sweep_list() TO aiontheballot_sweeper;
  END IF;
END
$$;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
