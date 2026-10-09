-- migrate:up

-- Source documents and their extracted text (spec §3.4). A source is a party's document (or a party-neutral one) in an
-- election. Its stored copy is set once, by an upload or by the fetch job; from then on only its extraction status
-- (one way, from pending) and its archive URL (once) change, so a quote matched against it stays matched against the
-- same bytes. A wrong source is replaced, not edited. The extracted text is private (copyright), written while the
-- source is pending, and never changed. The extraction and fetch jobs get their worker access with the job tables; the
-- public reads a source once a published revision cites it, with the revision tables.

CREATE TABLE app.source_documents (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id          uuid NOT NULL,
  election_id        uuid NOT NULL,
  party_id           uuid,                                    -- null: party-neutral
  kind               app.source_kind NOT NULL,
  title              text NOT NULL,                           -- as published, in its original language
  url                text CHECK (url ~ '^https?://'),
  language           app.locale,
  is_programme       boolean NOT NULL DEFAULT false,          -- the party's electoral programme
  file_id            uuid,                                    -- the stored copy (sources bucket)
  file_origin        text CHECK (file_origin IN ('fetched', 'uploaded')),
  sha256             text,                                    -- copied from the file by trigger: the public hash (P8)
  retrieved_at       timestamptz,                             -- when the copy was stored, by trigger
  archive_url        text CHECK (archive_url ~ '^https://'),  -- set once, by the archive job
  extraction_status  app.extraction_status NOT NULL DEFAULT 'pending',
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, election_id, id),
  FOREIGN KEY (tenant_id, election_id) REFERENCES app.elections (tenant_id, id),
  FOREIGN KEY (tenant_id, election_id, party_id) REFERENCES app.parties (tenant_id, election_id, id),
  FOREIGN KEY (tenant_id, file_id) REFERENCES app.files (tenant_id, id),
  CHECK ((file_id IS NULL) = (file_origin IS NULL) AND (file_id IS NULL) = (sha256 IS NULL)),
  CHECK ((file_id IS NULL) = (retrieved_at IS NULL)),
  CHECK (NOT is_programme OR party_id IS NOT NULL),
  CHECK (extraction_status <> 'done' OR file_id IS NOT NULL)
);
CREATE INDEX source_documents_election_id_idx ON app.source_documents (election_id);
CREATE INDEX source_documents_party_id_idx ON app.source_documents (party_id);
CREATE INDEX source_documents_file_id_idx ON app.source_documents (file_id);

-- One row per page (PDF) or section (web page), in order; matching joins them, so a quote may span a page break.
CREATE TABLE app.source_texts (
  source_document_id  uuid NOT NULL,
  tenant_id           uuid NOT NULL,
  unit_index          int NOT NULL CHECK (unit_index > 0),     -- the page number, or the section index
  label               text NOT NULL,                           -- 'p. 47', or a section heading
  body                text NOT NULL,
  normalized          text GENERATED ALWAYS AS (private.normalize_for_match(body)) STORED,
  PRIMARY KEY (source_document_id, unit_index),
  FOREIGN KEY (tenant_id, source_document_id) REFERENCES app.source_documents (tenant_id, id)
);

-- Rules ----------------------------------------------------------------------------------------------------------

CREATE FUNCTION private.source_document_rules() RETURNS trigger
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

-- Text is added only to a pending source with a stored copy (the extraction job's moment); it never changes after.
CREATE FUNCTION private.source_text_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM app.source_documents s
                    WHERE s.id = NEW.source_document_id AND s.extraction_status = 'pending' AND s.file_id IS NOT NULL) THEN
      RAISE EXCEPTION 'text is extracted only into a pending source with a stored copy' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;

-- Triggers --------------------------------------------------------------------------------------------------------

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.source_documents
  FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();
CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.source_documents
  FOR EACH ROW EXECUTE FUNCTION private.source_document_rules();
CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.source_documents
  FOR EACH ROW EXECUTE FUNCTION private.stamp('created_by', 'created_at');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.source_documents
  FOR EACH ROW EXECUTE FUNCTION private.audit();

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.source_texts
  FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();
CREATE TRIGGER forbid_mutation BEFORE UPDATE OR DELETE ON app.source_texts
  FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation();
CREATE TRIGGER forbid_truncate BEFORE TRUNCATE ON app.source_texts
  FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_mutation();
CREATE TRIGGER rules BEFORE INSERT ON app.source_texts
  FOR EACH ROW EXECUTE FUNCTION private.source_text_rules();

-- Grants and policies ---------------------------------------------------------------------------------------------

-- Members read their tenants' sources and texts; editors and country admins add sources, attach an uploaded copy,
-- edit them until the copy is stored, and delete unreferenced ones. No runtime role writes text yet: that is the
-- extraction job's, with the job tables.
ALTER TABLE app.source_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.source_texts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, DELETE,
      INSERT (tenant_id, election_id, party_id, kind, title, url, language, is_programme, file_id, file_origin),
      UPDATE (party_id, kind, title, url, language, is_programme, file_id, file_origin)
  ON app.source_documents TO aiontheballot_admin;
CREATE POLICY member_read ON app.source_documents FOR SELECT TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
         OR (SELECT private.is_platform_admin()));
CREATE POLICY editor_insert ON app.source_documents FOR INSERT TO aiontheballot_admin
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor'))
              OR (SELECT private.is_platform_admin()));
CREATE POLICY editor_update ON app.source_documents FOR UPDATE TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor')) OR (SELECT private.is_platform_admin()))
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor'))
              OR (SELECT private.is_platform_admin()));
CREATE POLICY editor_delete ON app.source_documents FOR DELETE TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor')) OR (SELECT private.is_platform_admin()));

GRANT SELECT ON app.source_texts TO aiontheballot_admin;
CREATE POLICY member_read ON app.source_texts FOR SELECT TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
         OR (SELECT private.is_platform_admin()));

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
