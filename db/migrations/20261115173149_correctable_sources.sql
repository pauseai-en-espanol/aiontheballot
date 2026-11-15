-- migrate:up

-- A source's description, corrected while nothing rests on it (PLAN R226). Once its copy was stored a source never
-- changed (R132, D14): a programme saved without its party, or under a wrong title, could only be replaced, even in an
-- election nobody sees yet and with no cell citing it. Now, while its election is a draft or in preview and no quote,
-- "not mentioned" check or suggestion run rests on it, its title, language, party and programme mark can still be
-- corrected. Its kind, its address and its copy never change once the copy is stored (the address is what a fetch and
-- the archive took it from); and once its election is public or anything cites it, nothing does: it is replaced, as
-- before. What rests on it is read as the writer, as RLS shows it: members read every quote, check and run of their
-- tenant, so none is missed.
--
-- And, for any source: a party whose programme is published keeps a source marked as its programme (programme_rules
-- checks it when the status is set), so the mark leaves its source, unmarked or moved to another party, only once
-- another of the party's sources carries it.
--
-- The function is otherwise as before (migration replaced_sources). Run as the writer; no grant.

CREATE OR REPLACE FUNCTION private.source_document_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = ''
    AS $$
  DECLARE
    workflow text[] := ARRAY['extraction_status', 'archive_url', 'replaced_at'];
    -- What may still change once the copy is stored, until anything rests on the source or its election is public.
    correctable text[] := ARRAY['title', 'language', 'party_id', 'is_programme'];
    copy record;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.extraction_status <> 'pending' OR NEW.archive_url IS NOT NULL OR NEW.replaced_at IS NOT NULL THEN
        RAISE EXCEPTION 'a new source starts pending, with no archive, not replaced'
          USING ERRCODE = 'restrict_violation';
      END IF;
    ELSE
      IF OLD.file_id IS NOT NULL AND (to_jsonb(NEW) - workflow) IS DISTINCT FROM (to_jsonb(OLD) - workflow) THEN
        IF (to_jsonb(NEW) - workflow - correctable) IS DISTINCT FROM (to_jsonb(OLD) - workflow - correctable) THEN
          RAISE EXCEPTION 'source % has a stored copy, so its kind, address and copy never change: replace it instead',
            OLD.id USING ERRCODE = 'restrict_violation';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM app.elections e
                        WHERE e.id = OLD.election_id AND e.status IN ('draft', 'preview'))
           OR EXISTS (SELECT 1 FROM app.draft_evidence x WHERE x.source_document_id = OLD.id)
           OR EXISTS (SELECT 1 FROM app.revision_evidence x WHERE x.source_document_id = OLD.id)
           OR EXISTS (SELECT 1 FROM app.draft_checked_documents x WHERE x.source_document_id = OLD.id)
           OR EXISTS (SELECT 1 FROM app.revision_checked_documents x WHERE x.source_document_id = OLD.id)
           OR EXISTS (SELECT 1 FROM app.llm_runs x WHERE x.source_document_id = OLD.id) THEN
          RAISE EXCEPTION 'source % is cited, or its election is public, so it never changes: replace it instead',
            OLD.id USING ERRCODE = 'restrict_violation';
        END IF;
      END IF;
      -- A published programme keeps its source: the mark goes only once another of the party's sources carries it.
      IF OLD.is_programme AND (NOT NEW.is_programme OR NEW.party_id IS DISTINCT FROM OLD.party_id)
         AND EXISTS (SELECT 1 FROM app.parties p WHERE p.id = OLD.party_id AND p.programme_status = 'published')
         AND NOT EXISTS (SELECT 1 FROM app.source_documents s
                          WHERE s.party_id = OLD.party_id AND s.is_programme AND s.id <> OLD.id) THEN
        RAISE EXCEPTION 'party %: its published programme needs a source marked as its programme: mark another first',
          OLD.party_id USING ERRCODE = 'check_violation';
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

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
