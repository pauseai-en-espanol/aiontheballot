-- migrate:up

-- A quote is attested by someone who didn't write it (PLAN R167, D17a, from an RLS review). The rule refused only the
-- quote's author (its created_by), but another editor could rewrite the quote's words and attest them in one statement,
-- or in two, so the words were checked by nobody else. Now, while the election requires a second reviewer, the attester
-- must not be one of the cell's contributors as four-eyes counts them (private.revision_contributors): whoever edited
-- its draft since it was last published (a rewrite of the quote included), or uploaded a copy or an attestation file
-- it cites. Nor may they rewrite the quote in the attesting statement, since the trail records that contribution only
-- after the row is written (a change to the quote's source or attestation file is a rewrite too). Like the author's,
-- the rule is checked again on every update of the quote: attesting is refused, and an attestation that no longer
-- holds (its attester has edited the draft since, or four-eyes was turned back on) lapses to unmatched, so the publish
-- trigger's re-check (a no-op update of every quote) never publishes one. Attesting is still not a contribution, so a
-- reviewer who attests may still publish. The function is unchanged otherwise. Runs as the writer, who reads the
-- contributors and the files' uploaders as a member; no grant, no definer.

CREATE OR REPLACE FUNCTION private.evidence_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    not_content text[] := ARRAY['attested_by', 'match_status', 'matched_from_unit', 'matched_to_unit'];
    src record;
    cell_party uuid;
    needle text;
    attesting boolean;
    lapsed text;
  BEGIN
    -- Read as the writer: a source or cell the writer can't see is never cited by them.
    SELECT s.kind, s.party_id, s.file_id, s.extraction_status, m.admissible_source_kinds, e.require_second_reviewer
      INTO src
      FROM app.source_documents s
      JOIN app.elections e ON e.id = s.election_id
      LEFT JOIN app.methodologies m ON m.election_id = s.election_id
     WHERE s.id = NEW.source_document_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'source % is not visible to the writer', NEW.source_document_id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT a.party_id INTO cell_party FROM app.assessments a WHERE a.id = NEW.assessment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'cell % is not visible to the writer', NEW.assessment_id USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF src.file_id IS NULL OR src.extraction_status NOT IN ('done', 'not_applicable') THEN
      RAISE EXCEPTION 'a quote cites a source with a stored copy whose extraction is done or not applicable'
        USING ERRCODE = 'check_violation';
    END IF;
    IF src.party_id IS NOT NULL AND src.party_id <> cell_party THEN
      RAISE EXCEPTION 'one party''s source never backs another party''s cell' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT coalesce(src.kind = ANY (src.admissible_source_kinds), false) THEN
      RAISE EXCEPTION 'the methodology does not admit % sources', src.kind USING ERRCODE = 'check_violation';
    END IF;

    attesting := NEW.attested_by IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.attested_by IS DISTINCT FROM OLD.attested_by);

    -- A source with text: matched across its units, never attested.
    IF src.kind IN ('pdf', 'web_page') AND src.extraction_status = 'done' THEN
      IF attesting THEN
        RAISE EXCEPTION 'a quote from a source with text is matched, not attested' USING ERRCODE = 'check_violation';
      END IF;
      NEW.attested_by := NULL;
      needle := private.normalize_for_match(NEW.quote);
      WITH units AS (
        SELECT t.unit_index, t.normalized,
               sum(char_length(t.normalized) + 1) OVER (ORDER BY t.unit_index) - char_length(t.normalized) AS start
          FROM app.source_texts t
         WHERE t.source_document_id = NEW.source_document_id
      ), hit AS (
        SELECT strpos(string_agg(u.normalized, ' ' ORDER BY u.unit_index), needle) AS at FROM units u
      )
      SELECT (SELECT max(u.unit_index) FROM units u WHERE u.start <= hit.at),
             (SELECT max(u.unit_index) FROM units u WHERE u.start <= hit.at + char_length(needle) - 1)
        INTO NEW.matched_from_unit, NEW.matched_to_unit
        FROM hit
       WHERE hit.at > 0 AND char_length(needle) >= 15;  -- the minimum stops trivial matches
      NEW.match_status := CASE WHEN NEW.matched_from_unit IS NOT NULL THEN 'matched' ELSE 'unmatched' END;
      RETURN NEW;
    END IF;

    -- A source without text: attested by a second person, or unmatched.
    NEW.matched_from_unit := NULL;
    NEW.matched_to_unit := NULL;
    IF attesting AND TG_OP = 'UPDATE' AND OLD.attested_by IS NOT NULL THEN
      RAISE EXCEPTION 'quote % is already attested: withdraw the attestation first', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NOT attesting AND TG_OP = 'UPDATE'
       AND (to_jsonb(NEW) - not_content) IS DISTINCT FROM (to_jsonb(OLD) - not_content) THEN
      NEW.attested_by := NULL;  -- a changed quote needs a new attestation
    END IF;
    IF attesting THEN
      NEW.attested_by := private.current_user_id();
    END IF;
    IF NEW.attested_by IS NOT NULL THEN
      lapsed := CASE
        WHEN src.require_second_reviewer
             AND NEW.attested_by = CASE WHEN TG_OP = 'INSERT' THEN private.current_user_id() ELSE OLD.created_by END
          THEN 'self'
        -- One of the cell's contributors, as four-eyes counts them, or someone rewriting this quote as they attest it.
        WHEN src.require_second_reviewer
             AND ((attesting AND TG_OP = 'UPDATE'
                   AND (to_jsonb(NEW) - not_content) IS DISTINCT FROM (to_jsonb(OLD) - not_content))
                  OR NEW.attested_by IN (
                       SELECT c.user_id
                         FROM app.assessment_contributors c
                         JOIN app.assessments a ON a.id = c.assessment_id AND a.generation = c.generation
                        WHERE c.assessment_id = NEW.assessment_id
                       UNION ALL
                       SELECT f.created_by
                         FROM app.files f
                        WHERE f.id IN (SELECT s.file_id
                                         FROM app.source_documents s
                                        WHERE s.file_origin = 'uploaded'
                                          AND s.id IN (SELECT q.source_document_id FROM app.draft_evidence q
                                                        WHERE q.assessment_id = NEW.assessment_id
                                                       UNION ALL
                                                       SELECT d.source_document_id FROM app.draft_checked_documents d
                                                        WHERE d.assessment_id = NEW.assessment_id)
                                       UNION ALL
                                       SELECT q.attestation_file_id FROM app.draft_evidence q
                                        WHERE q.assessment_id = NEW.assessment_id)))
          THEN 'contributor'
        WHEN NOT EXISTS (SELECT 1 FROM app.files f WHERE f.id = NEW.attestation_file_id AND f.bucket = 'sources')
          THEN 'file'
      END;
      IF lapsed = 'self' AND attesting THEN
        RAISE EXCEPTION 'a quote is attested by someone other than its author' USING ERRCODE = 'insufficient_privilege';
      ELSIF lapsed = 'contributor' AND attesting THEN
        RAISE EXCEPTION 'a quote is attested by someone who has not written or uploaded any of the cell''s draft'
          USING ERRCODE = 'insufficient_privilege';
      ELSIF lapsed = 'file' AND attesting THEN
        RAISE EXCEPTION 'an attestation needs a stored screenshot or clip in the sources bucket'
          USING ERRCODE = 'check_violation';
      ELSIF lapsed IS NOT NULL THEN
        NEW.attested_by := NULL;  -- an attestation that no longer holds
      END IF;
    END IF;
    NEW.match_status := CASE WHEN NEW.attested_by IS NOT NULL THEN 'attested' ELSE 'unmatched' END;
    RETURN NEW;
  END
  $$;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
