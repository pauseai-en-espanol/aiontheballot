-- migrate:up

-- The quote normaliser follows Unicode's rules, as its TypeScript twin does (PLAN R113, D9). Its regexes run under
-- the builtin `pg_c_utf8` collation, so letters (`[[:alpha:]]`) and spaces (`[[:space:]]`) are Unicode's Alphabetic
-- and White_Space, from Postgres itself rather than the OS's C library, which an image update could change without a
-- word; and it drops U+FEFF, which copying from a PDF or a word processor brings in. A stored normalised text never
-- changes under it (a generated column isn't recomputed), so this checks first that no stored source text or quote
-- would normalise differently, and stops if one would.

CREATE FUNCTION private.normalize_for_match_r113(input text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  SET search_path = ''
  AS $$
    SELECT btrim(
      regexp_replace(
        regexp_replace(
          translate(
            replace(replace(normalize(input, NFKC), U&'\00AD', ''), U&'\FEFF', ''),
            U&'\2018\2019\201A\201B\2032\201C\201D\201E\201F\2033\00AB\00BB\2010\2011\2012\2013\2014\2015\2212',
            $map$'''''"""""""-------$map$
          ) COLLATE "pg_c_utf8",
          '([[:alpha:]])-[[:space:]]*\n[[:space:]]*([[:alpha:]])', '\1\2', 'g'
        ),
        '[[:space:]]+', ' ', 'g'
      )
    )
  $$;

-- No text or quote is written while the check runs and the function changes: one written in between would be stored
-- under the old rules unseen. Held only for this migration's transaction.
LOCK TABLE app.source_texts, app.draft_evidence, app.revision_evidence IN SHARE MODE;

DO $check$
DECLARE
  changed bigint;
BEGIN
  SELECT (SELECT count(*) FROM app.source_texts t
           WHERE t.normalized IS DISTINCT FROM private.normalize_for_match_r113(t.body))
       + (SELECT count(*) FROM app.draft_evidence e
           WHERE private.normalize_for_match(e.quote) IS DISTINCT FROM private.normalize_for_match_r113(e.quote))
       + (SELECT count(*) FROM app.revision_evidence e
           WHERE private.normalize_for_match(e.quote) IS DISTINCT FROM private.normalize_for_match_r113(e.quote))
    INTO changed;
  IF changed > 0 THEN
    RAISE EXCEPTION '% stored source texts or quotes would normalise differently: see PLAN R113', changed;
  END IF;
END
$check$;

DROP FUNCTION private.normalize_for_match_r113(text);

CREATE OR REPLACE FUNCTION private.normalize_for_match(input text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  SET search_path = ''
  AS $$
    SELECT btrim(
      regexp_replace(
        regexp_replace(
          translate(
            replace(replace(normalize(input, NFKC), U&'\00AD', ''), U&'\FEFF', ''),
            U&'\2018\2019\201A\201B\2032\201C\201D\201E\201F\2033\00AB\00BB\2010\2011\2012\2013\2014\2015\2212',
            $map$'''''"""""""-------$map$
          ) COLLATE "pg_c_utf8",
          '([[:alpha:]])-[[:space:]]*\n[[:space:]]*([[:alpha:]])', '\1\2', 'g'
        ),
        '[[:space:]]+', ' ', 'g'
      )
    )
  $$;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
