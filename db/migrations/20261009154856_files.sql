-- migrate:up

-- Stored files (ADR-0002 §5, spec §3.4): metadata in app.files and the bytes in app.file_blobs, under the same RLS.
-- The public_assets bucket holds vetted images (party logos); sources holds documents, screenshots and clips. A stored
-- file never changes, so a quote matched against it stays matched against the same bytes; it can be deleted only while
-- nothing references it (the foreign keys of the tables that cite files), and its bytes go with it. Party logos become
-- public with the election tables.

CREATE TABLE app.files (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id          uuid NOT NULL REFERENCES app.tenants,
  bucket             app.file_bucket NOT NULL,
  content_type       text NOT NULL CHECK (content_type ~ '^[a-z]+/[a-z0-9.+-]+$'),
  byte_size          bigint NOT NULL CHECK (byte_size BETWEEN 0 AND 52428800),  -- 50 MB
  sha256             text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  original_filename  text,
  created_by         uuid NOT NULL,                                  -- the uploader (or the requester of a fetch)
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, bucket, sha256),                                -- the same file is stored once per tenant and bucket
  CHECK (bucket <> 'public_assets' OR content_type IN ('image/png', 'image/jpeg', 'image/webp'))
);
COMMENT ON COLUMN app.files.original_filename IS 'personal data';

CREATE TABLE app.file_blobs (
  file_id    uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL,
  content    bytea NOT NULL,
  FOREIGN KEY (tenant_id, file_id) REFERENCES app.files (tenant_id, id) ON DELETE CASCADE
);

-- The bytes match their file's hash and size. They are removed only with their file (the cascade); deleting the bytes
-- of a file that still exists is refused, even for the owner.
CREATE FUNCTION private.blob_matches_file() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    expected_sha text;
    expected_size bigint;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      IF EXISTS (SELECT 1 FROM app.files f WHERE f.id = OLD.file_id) THEN
        RAISE EXCEPTION 'delete file %, not just its bytes', OLD.file_id USING ERRCODE = 'restrict_violation';
      END IF;
      RETURN OLD;
    END IF;
    -- Read as the writer: a file the writer can't see gets no bytes from them.
    SELECT f.sha256, f.byte_size INTO expected_sha, expected_size FROM app.files f WHERE f.id = NEW.file_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'file % is not visible to the writer', NEW.file_id USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF encode(sha256(NEW.content), 'hex') <> expected_sha OR octet_length(NEW.content) <> expected_size THEN
      RAISE EXCEPTION 'the bytes of file % do not match its hash and size', NEW.file_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.files
  FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();
CREATE TRIGGER forbid_update BEFORE UPDATE ON app.files
  FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation();
CREATE TRIGGER forbid_truncate BEFORE TRUNCATE ON app.files
  FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_mutation();
CREATE TRIGGER stamp BEFORE INSERT ON app.files
  FOR EACH ROW EXECUTE FUNCTION private.stamp('created_by', 'created_at');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.files
  FOR EACH ROW EXECUTE FUNCTION private.audit();

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.file_blobs
  FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();
CREATE TRIGGER forbid_update BEFORE UPDATE ON app.file_blobs
  FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation();
CREATE TRIGGER forbid_truncate BEFORE TRUNCATE ON app.file_blobs
  FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_mutation();
CREATE TRIGGER matches_file BEFORE INSERT OR DELETE ON app.file_blobs
  FOR EACH ROW EXECUTE FUNCTION private.blob_matches_file();

-- Members read their tenants' files; editors and country admins upload them and delete unreferenced ones. The bytes
-- follow their file: no runtime role deletes them directly.
ALTER TABLE app.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.file_blobs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, DELETE, INSERT (tenant_id, bucket, content_type, byte_size, sha256, original_filename)
  ON app.files TO aiontheballot_admin;
CREATE POLICY member_read ON app.files FOR SELECT TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
         OR (SELECT private.is_platform_admin()));
CREATE POLICY editor_insert ON app.files FOR INSERT TO aiontheballot_admin
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor'))
              OR (SELECT private.is_platform_admin()));
CREATE POLICY editor_delete ON app.files FOR DELETE TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor')) OR (SELECT private.is_platform_admin()));

GRANT SELECT, INSERT (file_id, tenant_id, content) ON app.file_blobs TO aiontheballot_admin;
CREATE POLICY member_read ON app.file_blobs FOR SELECT TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
         OR (SELECT private.is_platform_admin()));
CREATE POLICY editor_insert ON app.file_blobs FOR INSERT TO aiontheballot_admin
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor'))
              OR (SELECT private.is_platform_admin()));

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
