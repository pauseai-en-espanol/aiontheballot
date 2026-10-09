-- migrate:up

-- Background jobs and the worker's access (spec §3.10, §8). The API inserts a job request inside withActor (RLS checks
-- the member; the foreign keys pin the source to the tenant) and puts only its id in the pg-boss payload. The worker
-- runs as aiontheballot_worker and sets two values per job:
-- - app.job_request_id: its RLS on job_requests shows it that one request while it is open, and every other worker
--   policy joins job_requests, so a finished request (or none) authorizes nothing, and the tenant and source always
--   come from the request, never from the payload;
-- - app.user_id: the request's requester, so what it writes is stamped and audited as theirs. Its policies require
--   exactly that person, so it can't act in anyone else's name.
-- What each kind may touch: fetch_source stores a sources-bucket file and attaches it as the source's fetched copy;
-- extract_source writes the source's pages and its extraction status; archive_source sets the archive URL; llm_run
-- reads the source's pages and its election's parties and criteria, runs its run and writes its suggestions.

CREATE TABLE app.job_requests (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id           uuid NOT NULL REFERENCES app.tenants,
  kind                app.job_kind NOT NULL,
  source_document_id  uuid NOT NULL,
  llm_run_id          uuid,                              -- for kind = 'llm_run'
  requested_by        uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,                       -- set once, by the worker, at the transaction time
  UNIQUE (tenant_id, id),
  CHECK ((kind = 'llm_run') = (llm_run_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, source_document_id) REFERENCES app.source_documents (tenant_id, id),
  FOREIGN KEY (tenant_id, llm_run_id, source_document_id) REFERENCES app.llm_runs (tenant_id, id, source_document_id)
);
CREATE INDEX job_requests_source_document_id_idx ON app.job_requests (source_document_id);
CREATE INDEX job_requests_llm_run_id_idx ON app.job_requests (llm_run_id);

-- Rules ----------------------------------------------------------------------------------------------------------

-- A request is made only when its job has something to do, for a source the requester can see; afterwards it changes
-- only by finishing, once, at the transaction time.
CREATE FUNCTION private.job_request_rules() RETURNS trigger
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
      WHEN 'archive_source' THEN source.url IS NOT NULL AND source.archive_url IS NULL
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

-- The worker changes only what its job's kind allows on its source: a fetch attaches the fetched copy, an extraction
-- sets the status, an archive sets the URL. Other writers are unaffected.
CREATE FUNCTION private.worker_job_scope() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    kind app.job_kind;
    allowed text[];
    changed text[];
  BEGIN
    IF current_user <> 'aiontheballot_worker' THEN
      RETURN NEW;
    END IF;
    SELECT r.kind INTO kind FROM app.job_requests r WHERE r.finished_at IS NULL AND r.source_document_id = NEW.id;
    allowed := CASE kind
      WHEN 'fetch_source' THEN ARRAY['file_id', 'file_origin']
      WHEN 'extract_source' THEN ARRAY['extraction_status']
      WHEN 'archive_source' THEN ARRAY['archive_url']
      ELSE '{}'
    END;
    SELECT coalesce(array_agg(n.key), '{}') INTO changed
      FROM jsonb_each(to_jsonb(NEW)) n
     WHERE n.value IS DISTINCT FROM to_jsonb(OLD) -> n.key;
    IF NOT changed <@ allowed OR (kind = 'fetch_source' AND NEW.file_origin IS DISTINCT FROM 'fetched') THEN
      RAISE EXCEPTION 'a % job may not change % of its source', coalesce(kind::text, 'missing'), changed
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.job_requests
  FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();
CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.job_requests
  FOR EACH ROW EXECUTE FUNCTION private.job_request_rules();
CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.job_requests
  FOR EACH ROW EXECUTE FUNCTION private.stamp('requested_by', 'created_at');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.job_requests
  FOR EACH ROW EXECUTE FUNCTION private.audit();

CREATE TRIGGER job_scope BEFORE UPDATE ON app.source_documents
  FOR EACH ROW EXECUTE FUNCTION private.worker_job_scope();

-- Members ---------------------------------------------------------------------------------------------------------

ALTER TABLE app.job_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT (tenant_id, kind, source_document_id, llm_run_id) ON app.job_requests TO aiontheballot_admin;
CREATE POLICY member_read ON app.job_requests FOR SELECT TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
         OR (SELECT private.is_platform_admin()));
CREATE POLICY editor_insert ON app.job_requests FOR INSERT TO aiontheballot_admin
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor'))
              OR (SELECT private.is_platform_admin()));

-- The worker ------------------------------------------------------------------------------------------------------

-- Stamping its fetched files reads the actor; the generated normalized column of source_texts runs the normalizer.
GRANT EXECUTE ON FUNCTION private.current_user_id(), private.normalize_for_match(text) TO aiontheballot_worker;

-- Its one request: while open, and in the transaction that finishes it (an UPDATE that reads the table must still see
-- the row it wrote). Every other worker policy, and the scope trigger, admits only an open request, so finishing a job
-- ends what it authorizes at once.
GRANT SELECT, UPDATE (finished_at) ON app.job_requests TO aiontheballot_worker;
CREATE POLICY worker_job ON app.job_requests FOR SELECT TO aiontheballot_worker
  USING (id = nullif(current_setting('app.job_request_id', true), '')::uuid
         AND (finished_at IS NULL OR finished_at = now()));
CREATE POLICY worker_finish ON app.job_requests FOR UPDATE TO aiontheballot_worker
  USING (id = nullif(current_setting('app.job_request_id', true), '')::uuid AND finished_at IS NULL)
  WITH CHECK (id = nullif(current_setting('app.job_request_id', true), '')::uuid);

-- Its tenant's methodology kind (the scale of its suggestions).
GRANT SELECT (id, methodology_kind) ON app.tenants TO aiontheballot_worker;
CREATE POLICY worker_read ON app.tenants FOR SELECT TO aiontheballot_worker
  USING (EXISTS (SELECT 1 FROM app.job_requests r WHERE r.finished_at IS NULL AND r.tenant_id = tenants.id));

-- Its source.
GRANT SELECT, UPDATE (file_id, file_origin, extraction_status, archive_url) ON app.source_documents
  TO aiontheballot_worker;
CREATE POLICY worker_read ON app.source_documents FOR SELECT TO aiontheballot_worker
  USING (EXISTS (SELECT 1 FROM app.job_requests r WHERE r.finished_at IS NULL AND r.source_document_id = source_documents.id));
CREATE POLICY worker_update ON app.source_documents FOR UPDATE TO aiontheballot_worker
  USING (EXISTS (SELECT 1 FROM app.job_requests r WHERE r.finished_at IS NULL AND r.source_document_id = source_documents.id))
  WITH CHECK (EXISTS (SELECT 1 FROM app.job_requests r WHERE r.finished_at IS NULL AND r.source_document_id = source_documents.id));

-- Its source's copy, and the file a fetch stores in this transaction (sources bucket, its tenant, its requester).
GRANT SELECT (id, tenant_id, bucket, content_type, byte_size, sha256, created_at),
      INSERT (tenant_id, bucket, content_type, byte_size, sha256, original_filename)
  ON app.files TO aiontheballot_worker;
CREATE POLICY worker_read ON app.files FOR SELECT TO aiontheballot_worker
  USING (EXISTS (SELECT 1 FROM app.source_documents s WHERE s.file_id = files.id)
         OR (created_at = now()
             AND EXISTS (SELECT 1 FROM app.job_requests r
                          WHERE r.finished_at IS NULL AND r.kind = 'fetch_source' AND r.tenant_id = files.tenant_id)));
CREATE POLICY worker_fetch ON app.files FOR INSERT TO aiontheballot_worker
  WITH CHECK (bucket = 'sources'
              AND EXISTS (SELECT 1 FROM app.job_requests r
                           WHERE r.finished_at IS NULL AND r.kind = 'fetch_source' AND r.tenant_id = files.tenant_id
                             AND r.requested_by = files.created_by));
GRANT SELECT, INSERT (file_id, tenant_id, content) ON app.file_blobs TO aiontheballot_worker;
CREATE POLICY worker_read ON app.file_blobs FOR SELECT TO aiontheballot_worker
  USING (EXISTS (SELECT 1 FROM app.files f WHERE f.id = file_blobs.file_id));
CREATE POLICY worker_fetch ON app.file_blobs FOR INSERT TO aiontheballot_worker
  WITH CHECK (EXISTS (SELECT 1 FROM app.files f JOIN app.job_requests r ON r.tenant_id = f.tenant_id
                       WHERE f.id = file_blobs.file_id AND f.created_at = now()
                         AND r.finished_at IS NULL AND r.kind = 'fetch_source'));

-- Its source's pages: an extraction writes them; an LLM run reads them.
GRANT SELECT, INSERT (source_document_id, tenant_id, unit_index, label, body) ON app.source_texts
  TO aiontheballot_worker;
CREATE POLICY worker_read ON app.source_texts FOR SELECT TO aiontheballot_worker
  USING (EXISTS (SELECT 1 FROM app.job_requests r WHERE r.finished_at IS NULL AND r.source_document_id = source_texts.source_document_id));
CREATE POLICY worker_extract ON app.source_texts FOR INSERT TO aiontheballot_worker
  WITH CHECK (EXISTS (SELECT 1 FROM app.job_requests r
                       WHERE r.finished_at IS NULL AND r.kind = 'extract_source'
                         AND r.source_document_id = source_texts.source_document_id));

-- Its LLM run and the run's suggestions, and the parties and criteria of the run's election.
GRANT SELECT, UPDATE (status, input_tokens, output_tokens, cost_usd, error) ON app.llm_runs TO aiontheballot_worker;
CREATE POLICY worker_read ON app.llm_runs FOR SELECT TO aiontheballot_worker
  USING (EXISTS (SELECT 1 FROM app.job_requests r WHERE r.finished_at IS NULL AND r.llm_run_id = llm_runs.id));
CREATE POLICY worker_run ON app.llm_runs FOR UPDATE TO aiontheballot_worker
  USING (EXISTS (SELECT 1 FROM app.job_requests r WHERE r.finished_at IS NULL AND r.llm_run_id = llm_runs.id))
  WITH CHECK (EXISTS (SELECT 1 FROM app.job_requests r WHERE r.finished_at IS NULL AND r.llm_run_id = llm_runs.id));
GRANT SELECT,
      INSERT (tenant_id, election_id, run_id, party_id, criterion_id, suggested_rating, rationale, passages)
  ON app.llm_suggestions TO aiontheballot_worker;
CREATE POLICY worker_read ON app.llm_suggestions FOR SELECT TO aiontheballot_worker
  USING (EXISTS (SELECT 1 FROM app.job_requests r WHERE r.finished_at IS NULL AND r.llm_run_id = llm_suggestions.run_id));
CREATE POLICY worker_suggest ON app.llm_suggestions FOR INSERT TO aiontheballot_worker
  WITH CHECK (EXISTS (SELECT 1 FROM app.job_requests r WHERE r.finished_at IS NULL AND r.llm_run_id = llm_suggestions.run_id));
GRANT SELECT ON app.parties, app.criteria TO aiontheballot_worker;
CREATE POLICY worker_read ON app.parties FOR SELECT TO aiontheballot_worker
  USING (EXISTS (SELECT 1 FROM app.job_requests r JOIN app.source_documents s ON s.id = r.source_document_id
                  WHERE r.finished_at IS NULL AND r.kind = 'llm_run' AND s.election_id = parties.election_id));
CREATE POLICY worker_read ON app.criteria FOR SELECT TO aiontheballot_worker
  USING (EXISTS (SELECT 1 FROM app.job_requests r JOIN app.source_documents s ON s.id = r.source_document_id
                  WHERE r.finished_at IS NULL AND r.kind = 'llm_run' AND s.election_id = criteria.election_id));

-- Checks written for members, now met by the worker too ---------------------------------------------------------

-- The page check is a pure check: as an AFTER trigger it runs after RLS, so a writer without the right is refused as
-- such (WITH CHECK) before the data rule speaks. The function is unchanged.
DROP TRIGGER rules ON app.source_texts;
CREATE TRIGGER rules AFTER INSERT ON app.source_texts
  FOR EACH ROW EXECUTE FUNCTION private.source_text_rules();

-- A suggestion's scale is its tenant's: a tenant the writer can't see is a permission error, not an off-scale rating.
-- Only that lookup changes.
CREATE OR REPLACE FUNCTION private.llm_suggestion_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    kind app.methodology_kind;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      SELECT t.methodology_kind INTO kind FROM app.tenants t WHERE t.id = NEW.tenant_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'tenant % is not visible to the writer', NEW.tenant_id USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NOT (CASE kind
                WHEN 'demands' THEN NEW.suggested_rating IN ('meets', 'partially_meets', 'does_not_meet', 'not_mentioned')
                ELSE NEW.suggested_rating IN ('green', 'yellow', 'red', 'not_mentioned')
              END) THEN
        RAISE EXCEPTION 'rating % is not on the % scale', NEW.suggested_rating, kind USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.state <> 'open' THEN
        RAISE EXCEPTION 'a new suggestion is open' USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.decided_by := NULL;
      NEW.decided_at := NULL;
      RETURN NEW;
    END IF;

    IF OLD.state <> 'open' THEN
      RAISE EXCEPTION 'suggestion % is already decided', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF (to_jsonb(NEW) - ARRAY['state', 'decided_by', 'decided_at'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state', 'decided_by', 'decided_at']) THEN
      RAISE EXCEPTION 'suggestion %: only the decision changes', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.state <> 'open' THEN
      NEW.decided_by := private.current_user_id();
      NEW.decided_at := now();
    END IF;
    RETURN NEW;
  END
  $$;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
