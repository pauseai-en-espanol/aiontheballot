-- migrate:up

-- File bytes move out of the database onto a persistent volume (ADR-0004; ADR-0001, amended; PLAN R61). The database
-- keeps each file's row (tenant, bucket, type, size, SHA-256) and with it every rule about who may see it, who may
-- write it and that it never changes. The bytes live on the volume under the row's tenant, bucket and SHA-256,
-- written there before the row; the API reads them only for a row RLS shows, and only from that row's own folder.
-- Which rows anyone sees stays in the database; that bytes match their row is now the file store's rule.
--
-- - app.file_blobs goes, with its policies, triggers and the function that checked bytes against their row: the file
--   store checks the hash when it writes and again when it reads (ADR-0004).
-- - Platform brand assets keep their row and lose their inline bytes the same way; their size stays checked.
-- - The tenant purge no longer deletes bytes with each file: purge-tenant-files deletes the tenant's folder on the
--   volume, and bytes no row names are swept from it after a grace period (ADR-0004).

-- Bytes are never lost silently. SQL can't put them on the volume, so this refuses to run while any are stored in
-- the database (the tables are locked first, so none can arrive between the count and the drop). With rows, save their
-- bytes, delete the rows, deploy, then put them back with put-file (ADR-0004).
--
-- Old pods keep running until the rollout ends. Their brand-image query names what this drops and would fail on any
-- call, but it is called only for an image the tenant's home data names, and with no files and no brand assets there
-- is none; their home-data query reads only columns that stay.
LOCK TABLE app.file_blobs, app.brand_assets IN ACCESS EXCLUSIVE MODE;
DO $$
  DECLARE
    blobs bigint := (SELECT count(*) FROM app.file_blobs);
    assets bigint := (SELECT count(*) FROM app.brand_assets);
  BEGIN
    IF blobs > 0 OR assets > 0 THEN
      RAISE EXCEPTION 'files_on_volume would drop the bytes of % stored files and % brand assets', blobs, assets
        USING ERRCODE = 'object_in_use',
              HINT = 'Save their bytes, delete their rows, deploy, then put them back with put-file (ADR-0004). '
                     'A local database: recreate it (CONTRIBUTING.md).';
    END IF;
  END
  $$;

DROP TABLE app.file_blobs;
DROP FUNCTION private.blob_matches_file();

-- No rows (checked above), so the size can be required at once.
ALTER TABLE app.brand_assets
  ADD COLUMN byte_size bigint NOT NULL,
  ADD CONSTRAINT brand_assets_byte_size_check CHECK (byte_size BETWEEN 1 AND 2097152),
  -- The inline bytes' hash check goes with them; the hash keeps its shape, as on files.
  ADD CONSTRAINT brand_assets_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  DROP COLUMN content;

GRANT INSERT (byte_size) ON app.brand_assets TO aiontheballot_admin;

-- purge_tenant as before (migration tenant_brand_uploads), without file_blobs.
CREATE OR REPLACE FUNCTION private.purge_tenant(tenant uuid) RETURNS bigint
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
  DECLARE
    -- Children before parents. Cells take their drafts and contributors with them.
    tables text[] := ARRAY[
      'revision_internal', 'revision_evidence', 'revision_checked_documents', 'structural_changes', 'change_requests',
      'assessment_revisions', 'review_events', 'reports', 'report_daily_counts', 'assessment_contributors',
      'draft_checked_documents', 'draft_evidence', 'assessments', 'job_requests', 'llm_suggestions', 'llm_runs',
      'source_texts', 'source_documents', 'methodology_reviewers', 'methodologies', 'criteria', 'parties', 'elections',
      'tenant_brand_selections', 'files', 'tenant_documents', 'invitations', 'memberships',
      'brand_asset_grants', 'tenant_organizations', 'public_versions', 'tenant_hostnames', 'audit_log'];
    tenant_slug text;
    leftovers jsonb;
    counts jsonb := '{}';
    t text;
    n bigint;
    remaining text;
    logged bigint;
  BEGIN
    PERFORM set_config('app.purge', 'on', true);
    SELECT t.slug INTO tenant_slug FROM app.tenants t WHERE t.id = tenant FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no tenant %', tenant USING ERRCODE = 'no_data_found';
    END IF;

    leftovers := jsonb_build_object(
      'organizations', (SELECT coalesce(jsonb_agg(o.organization_id ORDER BY o.organization_id), '[]')
                          FROM app.tenant_organizations o
                         WHERE o.tenant_id = tenant
                           AND NOT EXISTS (SELECT 1 FROM app.tenant_organizations x
                                            WHERE x.organization_id = o.organization_id AND x.tenant_id <> tenant)),
      'users', (SELECT coalesce(jsonb_agg(DISTINCT m.user_id), '[]')
                  FROM app.memberships m
                 WHERE m.tenant_id = tenant
                   AND NOT EXISTS (SELECT 1 FROM app.memberships x WHERE x.user_id = m.user_id AND x.tenant_id <> tenant)));

    -- Its hostnames are printed on share images: they can never be claimed again.
    INSERT INTO app.hostname_tombstones (hostname)
    SELECT h.hostname FROM app.tenant_hostnames h WHERE h.tenant_id = tenant
    ON CONFLICT DO NOTHING;
    DELETE FROM app.hostname_verifications v
     WHERE v.hostname IN (SELECT h.hostname FROM app.tenant_hostnames h WHERE h.tenant_id = tenant);

    FOREACH t IN ARRAY tables LOOP
      -- Counted first: some rows go with their parents (drafts and contributors with their cells).
      EXECUTE format('SELECT count(*) FROM app.%I WHERE tenant_id = $1', t) INTO n USING tenant;
      IF t NOT IN ('assessment_contributors', 'draft_checked_documents', 'draft_evidence') THEN
        EXECUTE format('DELETE FROM app.%I WHERE tenant_id = $1', t) USING tenant;
      END IF;
      counts := counts || jsonb_build_object(t, n);
    END LOOP;

    -- Every table with a tenant_id must now be empty of it, including any this function doesn't list yet.
    FOR t IN SELECT c.relname FROM pg_catalog.pg_attribute a
               JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
               JOIN pg_catalog.pg_namespace s ON s.oid = c.relnamespace
              WHERE s.nspname = 'app' AND c.relkind IN ('r', 'p') AND a.attname = 'tenant_id' AND NOT a.attisdropped LOOP
      EXECUTE format('SELECT count(*) FROM app.%I WHERE tenant_id = $1', t) INTO n USING tenant;
      IF n > 0 THEN
        remaining := concat_ws(', ', remaining, t);
      END IF;
    END LOOP;
    IF remaining IS NOT NULL THEN
      RAISE EXCEPTION 'purging tenant % left rows in %', tenant, remaining USING ERRCODE = 'object_in_use';
    END IF;

    DELETE FROM app.tenants WHERE id = tenant;
    INSERT INTO app.purge_log (purged_tenant_id, purged_tenant_slug, purged_by, counts, leftovers)
    VALUES (tenant, tenant_slug, session_user, counts || jsonb_build_object('tenants', 1), leftovers)
    RETURNING id INTO logged;
    RETURN logged;
  END
  $_$;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
