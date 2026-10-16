-- migrate:up

-- The evidence rules (spec §3.4, §3.5; ADR-0002, data rules).
--
-- - A quote or a checked document cites only a citable source: one with a stored copy whose extraction is done (or
--   not_applicable, for sources without text), of no party or of the cell's party, and of a kind the methodology
--   admits (for checked documents, a kind it lists for "not mentioned").
-- - match_status is computed, never taken from the caller. A quote from a source with text (a PDF or web page whose
--   extraction is done) is matched: once normalized, it must appear in the source's normalized units joined in order
--   by one space, and the first and last units the match spans are recorded. A quote from a source without text
--   (another kind, or a scanned PDF whose extraction is not_applicable) is attested instead: by a member other than
--   the quote's author (unless the election doesn't require a second reviewer), with a stored file in the sources
--   bucket. Any content change undoes an attestation, and every update checks it again.
-- - Submitting a cell needs every quote matched or attested, from a kind the methodology admits at that moment, and
--   every checked document of a kind it lists for "not mentioned".

-- The match trigger runs as the writer (ADR-0002 §6).
GRANT EXECUTE ON FUNCTION private.normalize_for_match(text) TO aiontheballot_admin;

CREATE FUNCTION private.evidence_rules() RETURNS trigger
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
        WHEN NOT EXISTS (SELECT 1 FROM app.files f WHERE f.id = NEW.attestation_file_id AND f.bucket = 'sources')
          THEN 'file'
      END;
      IF lapsed = 'self' AND attesting THEN
        RAISE EXCEPTION 'a quote is attested by someone other than its author' USING ERRCODE = 'insufficient_privilege';
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

-- A checked document: a citable source, of no party or the cell's party, of a kind listed for "not mentioned".
CREATE FUNCTION private.checked_document_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    src record;
    cell_party uuid;
  BEGIN
    SELECT s.kind, s.party_id, s.file_id, s.extraction_status, m.not_mentioned_source_kinds INTO src
      FROM app.source_documents s
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
      RAISE EXCEPTION 'a checked document is a source with a stored copy whose extraction is done or not applicable'
        USING ERRCODE = 'check_violation';
    END IF;
    IF src.party_id IS NOT NULL AND src.party_id <> cell_party THEN
      RAISE EXCEPTION 'one party''s source never backs another party''s cell' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT coalesce(src.kind = ANY (src.not_mentioned_source_kinds), false) THEN
      RAISE EXCEPTION 'the methodology does not list % sources for "not mentioned"', src.kind
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END
  $$;

-- Submitting: every quote and checked document still meets the methodology, and every quote is matched or attested.
CREATE FUNCTION private.submitted_evidence_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM app.draft_evidence q
                 JOIN app.source_documents s ON s.id = q.source_document_id
                 LEFT JOIN app.methodologies m ON m.election_id = NEW.election_id
                WHERE q.assessment_id = NEW.id
                  AND (q.match_status NOT IN ('matched', 'attested')
                       OR NOT coalesce(s.kind = ANY (m.admissible_source_kinds), false))) THEN
      RAISE EXCEPTION 'cell %: every quote must be matched or attested, from a kind the methodology admits', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM app.draft_checked_documents d
                 JOIN app.source_documents s ON s.id = d.source_document_id
                 LEFT JOIN app.methodologies m ON m.election_id = NEW.election_id
                WHERE d.assessment_id = NEW.id AND NOT coalesce(s.kind = ANY (m.not_mentioned_source_kinds), false)) THEN
      RAISE EXCEPTION 'cell %: every checked document must be of a kind listed for "not mentioned"', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END
  $$;

CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.draft_evidence
  FOR EACH ROW EXECUTE FUNCTION private.evidence_rules();
CREATE TRIGGER rules AFTER INSERT OR UPDATE ON app.draft_checked_documents
  FOR EACH ROW EXECUTE FUNCTION private.checked_document_rules();
CREATE TRIGGER submit_evidence AFTER UPDATE ON app.assessments
  FOR EACH ROW WHEN (OLD.state = 'draft' AND NEW.state = 'in_review')
  EXECUTE FUNCTION private.submitted_evidence_rules();

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
