-- migrate:up

-- A source replaced after its copy is stored (PLAN D14, R172): its copy never changes and it can't be deleted while
-- anything cites it (R132), so a newer version of a party's document is a new source, and the old one stays in every
-- list and in the cell editor's choice. Now those who write sources (RLS: editors and country admins) mark it replaced,
-- once and for good, at the transaction's time, its copy stored or not: `source_documents.replaced_at`, readable by
-- members, never the public. A replaced source takes no new quote and no new "not mentioned" check, nor a quote or
-- check moved to it; those it has stay as they are, still matched, edited and published (the published record of what
-- was checked doesn't change). The functions are unchanged otherwise. Run as the writer; one column grant.

ALTER TABLE app.source_documents ADD COLUMN replaced_at timestamptz;
GRANT UPDATE (replaced_at) ON app.source_documents TO aiontheballot_admin;

CREATE OR REPLACE FUNCTION private.source_document_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = ''
    AS $$
  DECLARE
    workflow text[] := ARRAY['extraction_status', 'archive_url', 'replaced_at'];
    copy record;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.extraction_status <> 'pending' OR NEW.archive_url IS NOT NULL OR NEW.replaced_at IS NOT NULL THEN
        RAISE EXCEPTION 'a new source starts pending, with no archive, not replaced'
          USING ERRCODE = 'restrict_violation';
      END IF;
    ELSE
      IF OLD.file_id IS NOT NULL AND (to_jsonb(NEW) - workflow) IS DISTINCT FROM (to_jsonb(OLD) - workflow) THEN
        RAISE EXCEPTION 'source % has a stored copy, so it never changes: replace it instead', OLD.id
          USING ERRCODE = 'restrict_violation';
      END IF;
      IF NEW.extraction_status IS DISTINCT FROM OLD.extraction_status AND OLD.extraction_status <> 'pending' THEN
        RAISE EXCEPTION 'the extraction status of source % leaves pending only once', OLD.id
          USING ERRCODE = 'restrict_violation';
      END IF;
      IF OLD.archive_url IS NOT NULL AND NEW.archive_url IS DISTINCT FROM OLD.archive_url THEN
        RAISE EXCEPTION 'the archive of source % is set once', OLD.id USING ERRCODE = 'restrict_violation';
      END IF;
      -- Replaced once, for good, at the transaction's time.
      IF OLD.replaced_at IS NOT NULL AND NEW.replaced_at IS DISTINCT FROM OLD.replaced_at THEN
        RAISE EXCEPTION 'source % is marked replaced once, for good', OLD.id USING ERRCODE = 'restrict_violation';
      ELSIF OLD.replaced_at IS NULL AND NEW.replaced_at IS NOT NULL THEN
        NEW.replaced_at := now();
      END IF;
    END IF;

    -- Only a fetch job stores a fetched copy (the worker, as the job's requester). Anyone else's copy is an upload,
    -- which four-eyes counts against its uploader (private.revision_contributors).
    IF NEW.file_origin = 'fetched' AND current_user <> 'aiontheballot_worker'
       AND (TG_OP = 'INSERT' OR OLD.file_origin IS DISTINCT FROM 'fetched') THEN
      RAISE EXCEPTION 'only a fetch job stores a fetched copy' USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- The stored copy, as it is set: the hash comes from the file and the time from the transaction. The file is read
    -- as the writer, so a file the writer can't see is never attached by them.
    IF NEW.file_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.file_id IS NULL) THEN
      SELECT f.sha256, f.bucket INTO copy FROM app.files f WHERE f.id = NEW.file_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'file % is not visible to the writer', NEW.file_id USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF copy.bucket <> 'sources' THEN
        RAISE EXCEPTION 'a source''s copy is a file in the sources bucket' USING ERRCODE = 'check_violation';
      END IF;
      NEW.sha256 := copy.sha256;
      NEW.retrieved_at := now();
    ELSIF NEW.file_id IS NULL THEN
      NEW.sha256 := NULL;
      NEW.retrieved_at := NULL;
    END IF;
    RETURN NEW;
  END
  $$;

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
    SELECT s.kind, s.party_id, s.file_id, s.extraction_status, s.replaced_at, m.admissible_source_kinds,
           e.require_second_reviewer
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
    -- A replaced source takes no new quote; the quotes it has stay.
    IF src.replaced_at IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id) THEN
      RAISE EXCEPTION 'source % was replaced: quote the source that replaced it', NEW.source_document_id
        USING ERRCODE = 'check_violation';
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

CREATE OR REPLACE FUNCTION private.checked_document_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    src record;
    cell_party uuid;
  BEGIN
    SELECT s.kind, s.party_id, s.file_id, s.extraction_status, s.replaced_at, m.not_mentioned_source_kinds INTO src
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
    -- A replaced source is checked no more; the checks made stay.
    IF src.replaced_at IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id) THEN
      RAISE EXCEPTION 'source % was replaced: check the source that replaced it', NEW.source_document_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END
  $$;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
