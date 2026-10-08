-- migrate:up

-- Actor context (ADR-0002 §3). The API sets both values at the start of every transaction with
-- set_config(..., true), so they never outlive it. Unset means "no actor", and every member policy denies.
CREATE FUNCTION private.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  SET search_path = ''
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION private.current_aal() RETURNS integer
  LANGUAGE sql STABLE PARALLEL SAFE
  SET search_path = ''
  AS $$ SELECT coalesce(nullif(current_setting('app.aal', true), '')::integer, 0) $$;

GRANT EXECUTE ON FUNCTION private.current_user_id(), private.current_aal() TO ballot_admin;

-- Normalisation for the verbatim quote check (ADR-0002, data rules). Used for matching only: quotes are always
-- displayed exactly as stored. Steps: NFKC (expands ligatures such as "ﬁ"), drop soft hyphens, fold typographic
-- quotes and dashes, join words hyphenated across a line break, collapse whitespace. Must stay identical to
-- normalizeForMatch() in @ballot/domain; packages/db tests both on the same fixtures.
CREATE FUNCTION private.normalize_for_match(input text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  SET search_path = ''
  AS $$
    SELECT btrim(
      regexp_replace(
        regexp_replace(
          translate(
            replace(normalize(input, NFKC), U&'\00AD', ''),
            U&'\2018\2019\201A\201B\2032\201C\201D\201E\201F\2033\00AB\00BB\2010\2011\2012\2013\2014\2015\2212',
            $map$'''''"""""""-------$map$
          ),
          '([[:alpha:]])-[[:space:]]*\n[[:space:]]*([[:alpha:]])', '\1\2', 'g'
        ),
        '[[:space:]]+', ' ', 'g'
      )
    )
  $$;

-- A row's tenant never changes (ADR-0002 §4). Attached as a BEFORE UPDATE trigger to every tenant-owned table.
CREATE FUNCTION private.forbid_tenant_change() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'tenant_id of %.% cannot change', TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;

-- Published history is never changed (ADR-0002 §14). Attached as BEFORE UPDATE OR DELETE (row) and BEFORE TRUNCATE
-- (statement) triggers. The only exception is a tenant purge, where the table owner sets app.purge = 'on' for the
-- transaction. The ownership check matters: any role can set app.purge, but only the owner may use it.
CREATE FUNCTION private.forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    IF current_setting('app.purge', true) = 'on'
       AND (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID)
         = (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
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
