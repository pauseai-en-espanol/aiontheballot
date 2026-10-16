-- migrate:up

-- A source's copy counts as fetched only when a fetch job stored it (PLAN R165, from an RLS review). Four-eyes
-- counts whoever uploaded a document a cell cites as one of its contributors, who can't publish it, but only for an
-- uploaded copy (private.revision_contributors): the admin role may write `file_origin`, and nothing checked the value,
-- so someone could upload a document, call it fetched, have another editor quote it and publish the cell themselves.
-- Now only the worker writes 'fetched' (its job scope already keeps it to that); everyone else's copy is 'uploaded'.
-- The function is unchanged otherwise. Runs as the caller; no grant, no definer.

CREATE OR REPLACE FUNCTION private.source_document_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = ''
    AS $$
  DECLARE
    workflow text[] := ARRAY['extraction_status', 'archive_url'];
    copy record;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.extraction_status <> 'pending' OR NEW.archive_url IS NOT NULL THEN
        RAISE EXCEPTION 'a new source starts pending, with no archive' USING ERRCODE = 'restrict_violation';
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
