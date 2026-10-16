-- migrate:up

-- The immutable tables' exemption for a purge asks who logged in, not only whose rights run (PLAN R165, from an RLS
-- review; ADR-0002, immutability). It admitted a change while `app.purge` was on and the current user owned the
-- table, but any role may set that flag, and the current user is the owner inside a SECURITY DEFINER function or a
-- foreign key's action, whoever called it. None changes an immutable table today, so nothing could use it; one that
-- did would have. Now the session's own login must also be the owner (or a member of it), as private.purging()
-- already asks of the other triggers: a purge runs as the owner, and a runtime role logs in as itself. Inlined
-- rather than calling private.purging(), which the runtime roles may not execute; pg_has_role is anyone's.

CREATE OR REPLACE FUNCTION private.forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    table_owner oid := (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID);
  BEGIN
    IF current_setting('app.purge', true) = 'on'
       AND table_owner = (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = current_user)
       AND pg_catalog.pg_has_role(session_user, table_owner, 'MEMBER') THEN
      IF TG_LEVEL = 'ROW' THEN
        RETURN coalesce(NEW, OLD);
      END IF;
      RETURN NULL;
    END IF;
    RAISE EXCEPTION '%.% is immutable: % is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
      USING ERRCODE = 'restrict_violation';
  END
  $$;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
