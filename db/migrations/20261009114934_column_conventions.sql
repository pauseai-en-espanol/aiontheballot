-- migrate:up

-- Column conventions shared by every table (data model spec §1): the shape of locale codes, slugs and localized
-- text, and the actor and time of each write, taken from the session.

-- The domains check with built-in functions only, so writing them needs no EXECUTE grant to a runtime role.

-- A locale code as it appears in public URLs: a language, optionally with a region, in lowercase ('es', 'es-mx').
CREATE DOMAIN app.locale AS text
  CHECK (VALUE ~ '^[a-z]{2}(-[a-z]{2})?$');

-- Lowercase words joined by single hyphens. A slug never starts with '_', so it can't reach the internal path prefix
-- (ADR-0002, Routing).
CREATE DOMAIN app.slug AS text
  CHECK (VALUE ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- Localized text: an object mapping locale codes to non-blank strings, e.g. {"es": "…", "en": "…"}. Whether the
-- tenant's default locale is present is checked when content goes public, not here.
CREATE DOMAIN app.localized AS jsonb
  CHECK (
    CASE WHEN jsonb_typeof(VALUE) = 'object' THEN
      VALUE <> '{}'
      AND NOT jsonb_path_exists(VALUE, '$.keyvalue() ? (!(@.key like_regex "^[a-z]{2}(-[a-z]{2})?$"))')
      AND NOT jsonb_path_exists(VALUE, '$.* ? (@.type() != "string" || !(@ like_regex "[^[:space:]]"))')
    ELSE false
    END
  );

-- Sets actor columns and event timestamps from the session, so nobody can act in someone else's name or backdate
-- anything (spec §1). Attached BEFORE INSERT [OR UPDATE] FOR EACH ROW, with the stamped columns as arguments, e.g.
-- private.stamp('created_by', 'created_at', 'updated_by', 'updated_at'):
-- - On insert, every argument is set: *_by and actor_id to private.current_user_id(), *_at to the transaction time.
-- - On update, updated_by and updated_at are set again, and every other argument keeps its stored value.
-- Whatever the caller sent is overwritten. Without an actor the actor columns are null, so a NOT NULL one refuses the
-- write. Columns set on a later transition (decided_by, triaged_at, …) belong to the trigger for that transition.
CREATE FUNCTION private.stamp() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    col text;
    fresh jsonb := to_jsonb(NEW);
    stamped jsonb := '{}';
  BEGIN
    IF TG_NARGS = 0 THEN
      RAISE EXCEPTION 'private.stamp on %.% needs the columns to stamp', TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    FOREACH col IN ARRAY TG_ARGV LOOP
      IF NOT fresh ? col OR NOT (col LIKE '%\_at' OR col LIKE '%\_by' OR col = 'actor_id') THEN
        RAISE EXCEPTION 'private.stamp on %.%: % is not an actor column or event timestamp of the table',
          TG_TABLE_SCHEMA, TG_TABLE_NAME, col
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
      stamped := stamped || jsonb_build_object(col,
        CASE
          WHEN TG_OP = 'UPDATE' AND col NOT IN ('updated_by', 'updated_at') THEN to_jsonb(OLD) -> col
          WHEN col LIKE '%\_at' THEN to_jsonb(now())
          ELSE to_jsonb(private.current_user_id())
        END);
    END LOOP;
    RETURN jsonb_populate_record(NEW, stamped);
  END
  $$;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
