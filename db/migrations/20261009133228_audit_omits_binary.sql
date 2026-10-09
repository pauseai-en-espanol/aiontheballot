-- migrate:up

-- The audit log never copies binary columns (brand asset images, later file bytes): they would bloat every entry, and
-- each such table records the content's SHA-256 in a text column, which is logged. The only change to
-- private.audit() is the query for hidden columns, which now also matches bytea columns.
CREATE OR REPLACE FUNCTION private.audit() RETURNS trigger
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
     WHERE a.attrelid = TG_RELID AND a.attnum > 0 AND NOT a.attisdropped
       AND (a.atttypid = 'pg_catalog.bytea'::pg_catalog.regtype
            OR EXISTS (SELECT 1 FROM pg_catalog.pg_description d
                        WHERE d.objoid = a.attrelid AND d.objsubid = a.attnum
                          AND d.classoid = 'pg_catalog.pg_class'::pg_catalog.regclass
                          AND d.description = 'personal data'));

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

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
