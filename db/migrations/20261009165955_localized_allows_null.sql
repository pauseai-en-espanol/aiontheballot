-- migrate:up

-- Fixes app.localized (migration column_conventions): its check was false for SQL NULL, so a nullable localized column
-- (a draft summary, a public note) refused NULL. A domain check must hold for NULL, as the other domains' regex checks
-- do. The shape rules for non-null values are unchanged. Every stored value is non-null, so the new check validates.
ALTER DOMAIN app.localized DROP CONSTRAINT localized_check;
ALTER DOMAIN app.localized ADD CONSTRAINT localized_check CHECK (
  VALUE IS NULL
  OR CASE WHEN jsonb_typeof(VALUE) = 'object' THEN
       VALUE <> '{}'
       AND NOT jsonb_path_exists(VALUE, '$.keyvalue() ? (!(@.key like_regex "^[a-z]{2}(-[a-z]{2})?$"))')
       AND NOT jsonb_path_exists(VALUE, '$.* ? (@.type() != "string" || !(@ like_regex "[^[:space:]]"))')
     ELSE false
     END
);

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
