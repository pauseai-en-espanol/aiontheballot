-- migrate:up

-- The audit log (ADR-0002 §14, spec §3.11): an append-only record of every write, without personal data. Country
-- admins read their tenant's entries and platform admins read all of them; nobody can change or remove one, except
-- a tenant purge. Every table gets the audit trigger unless a catalog test lists it as an exception, with a reason.

CREATE TABLE app.audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid REFERENCES app.tenants,   -- null for platform-level rows
  actor_id    uuid,                          -- null when written without an actor (the owner, the worker)
  action      text NOT NULL,                 -- 'insert', 'update' or 'delete' for table writes
  table_name  text NOT NULL,
  row_id      text NOT NULL,                 -- the primary key: its value, or a JSON object when it is composite
  diff        jsonb,                         -- {"new": row}, {"old": changed, "new": changed} or {"old": row}
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_id_at_idx ON app.audit_log (tenant_id, at DESC);

-- Logs one row write. SECURITY DEFINER (ADR-0002 §6, audit triggers) so runtime roles need no grant on audit_log.
-- Attached AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW.
-- - Columns commented 'personal data' are never copied; an update that changes only those is still logged, with
--   empty old and new values.
-- - An update that changes nothing is not logged.
-- - The tenant is the row's tenant_id (its id, for app.tenants), or null for platform-wide tables.
CREATE FUNCTION private.audit() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $$
  DECLARE
    before jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
    after jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
    subject jsonb := coalesce(after, before);
    hidden text[];
    key_columns text[];
    changed text[];
    diff jsonb;
  BEGIN
    SELECT coalesce(array_agg(a.attname::text), '{}') INTO hidden
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_description d
        ON d.objoid = a.attrelid AND d.objsubid = a.attnum AND d.classoid = 'pg_catalog.pg_class'::pg_catalog.regclass
     WHERE a.attrelid = TG_RELID AND d.description = 'personal data';

    SELECT array_agg(a.attname::text ORDER BY k.ord) INTO key_columns
      FROM pg_catalog.pg_index i
     CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY k(attnum, ord)
      JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
     WHERE i.indrelid = TG_RELID AND i.indisprimary;
    IF key_columns IS NULL THEN
      RAISE EXCEPTION 'private.audit on %.%: the table needs a primary key', TG_TABLE_SCHEMA, TG_TABLE_NAME;
    END IF;

    IF TG_OP = 'UPDATE' THEN
      SELECT coalesce(array_agg(n.key), '{}') INTO changed
        FROM jsonb_each(after) n
       WHERE n.value IS DISTINCT FROM before -> n.key;
      IF cardinality(changed) = 0 THEN
        RETURN NULL;
      END IF;
      diff := jsonb_build_object(
        'old', (SELECT coalesce(jsonb_object_agg(o.key, o.value), '{}') FROM jsonb_each(before) o
                 WHERE o.key = ANY (changed) AND NOT o.key = ANY (hidden)),
        'new', (SELECT coalesce(jsonb_object_agg(n.key, n.value), '{}') FROM jsonb_each(after) n
                 WHERE n.key = ANY (changed) AND NOT n.key = ANY (hidden)));
    ELSIF TG_OP = 'INSERT' THEN
      diff := jsonb_build_object('new', after - hidden);
    ELSE
      diff := jsonb_build_object('old', before - hidden);
    END IF;

    INSERT INTO app.audit_log (tenant_id, actor_id, action, table_name, row_id, diff)
    VALUES (
      (CASE WHEN TG_TABLE_SCHEMA = 'app' AND TG_TABLE_NAME = 'tenants' THEN subject ->> 'id'
            ELSE subject ->> 'tenant_id' END)::uuid,
      private.current_user_id(),
      lower(TG_OP),
      TG_TABLE_NAME,
      CASE WHEN cardinality(key_columns) = 1 THEN subject ->> key_columns[1]
           ELSE (SELECT jsonb_object_agg(c, subject -> c) FROM unnest(key_columns) c)::text END,
      diff);
    RETURN NULL;
  END
  $$;

-- The log itself: immutable, with its actor taken from the session like every other actor column.
CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.audit_log
  FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();
CREATE TRIGGER forbid_mutation BEFORE UPDATE OR DELETE ON app.audit_log
  FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation();
CREATE TRIGGER forbid_truncate BEFORE TRUNCATE ON app.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_mutation();
CREATE TRIGGER stamp BEFORE INSERT ON app.audit_log
  FOR EACH ROW EXECUTE FUNCTION private.stamp('actor_id');

ALTER TABLE app.audit_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON app.audit_log TO aiontheballot_admin;
CREATE POLICY country_admin_read ON app.audit_log FOR SELECT TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()));

-- The tables so far.
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.tenants
  FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.platform_admins
  FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.memberships
  FOR EACH ROW EXECUTE FUNCTION private.audit();

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
