-- migrate:up

-- Archive jobs, as the fetcher's snapshots use them (ADR-0007 §4, PLAN R175). Nothing has requested one yet, so both
-- rules hold on what is there.
--
-- One open per source at most, as for extraction: the API requests one when a copy is stored for a source with a URL
-- and no snapshot, and when a member asks; a second one while the first waits for the archive would only ask it again
-- for the same snapshot, which it limits per URL. Once the job is finished, with a snapshot or without, another may be
-- requested (the job rules already refuse one for a source with a snapshot).

CREATE UNIQUE INDEX job_requests_one_open_archive
  ON app.job_requests (source_document_id)
  WHERE kind = 'archive_source' AND finished_at IS NULL;

-- Only for a source whose copy is stored: until then its URL can still change (S1.2), and a snapshot taken meanwhile,
-- set once, would stay beside a source that names another address, shown to the public as its archive. Once the
-- copy is stored the URL never changes, so the snapshot is of the address the source names. The function is
-- unchanged otherwise.

CREATE OR REPLACE FUNCTION private.job_request_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    source record;
    ready boolean;
  BEGIN
    IF TG_OP = 'UPDATE' THEN
      IF OLD.finished_at IS NOT NULL THEN
        RAISE EXCEPTION 'job request % is finished', OLD.id USING ERRCODE = 'restrict_violation';
      END IF;
      IF (to_jsonb(NEW) - 'finished_at') IS DISTINCT FROM (to_jsonb(OLD) - 'finished_at') THEN
        RAISE EXCEPTION 'job request %: only finishing it is allowed', OLD.id USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.finished_at := CASE WHEN NEW.finished_at IS NOT NULL THEN now() END;
      RETURN NEW;
    END IF;

    SELECT s.url, s.file_id, s.extraction_status, s.archive_url INTO source
      FROM app.source_documents s WHERE s.id = NEW.source_document_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'source % is not visible to the requester', NEW.source_document_id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    ready := CASE NEW.kind
      WHEN 'fetch_source' THEN source.url IS NOT NULL AND source.file_id IS NULL
      WHEN 'extract_source' THEN source.file_id IS NOT NULL AND source.extraction_status = 'pending'
      WHEN 'archive_source' THEN source.url IS NOT NULL AND source.file_id IS NOT NULL AND source.archive_url IS NULL
      WHEN 'llm_run' THEN EXISTS (SELECT 1 FROM app.llm_runs r WHERE r.id = NEW.llm_run_id AND r.status = 'queued')
    END;
    IF NOT coalesce(ready, false) THEN
      RAISE EXCEPTION 'a % job has nothing to do for source %', NEW.kind, NEW.source_document_id
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.finished_at := NULL;
    RETURN NEW;
  END
  $$;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
