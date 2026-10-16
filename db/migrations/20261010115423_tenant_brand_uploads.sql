-- migrate:up

-- Tenants' own brand images (PLAN R59): a brand selection can name one of the tenant's uploaded images instead of a
-- platform brand asset, the way a party's logo does. Logos are data each tenant uploads, never code.
--
-- - A selection names exactly one source: a platform brand asset (as before, restricted ones still need a grant)
--   or a file of the same tenant (composite foreign key) in the public_assets bucket (PNG, JPEG or WebP), of at
--   most 2 MB like a platform brand asset: every public page and share card draws it.
-- - Such a file becomes public while an active tenant selects it: the files policy reads selections as the public
--   role, whose own policy shows only active tenants' (ADR-0002, public-visibility rule). Its blob follows its file.
-- - Country admins choose, as for platform assets.

ALTER TABLE app.tenant_brand_selections
  ALTER COLUMN brand_asset_id DROP NOT NULL,
  ADD COLUMN file_id uuid,
  ADD CONSTRAINT tenant_brand_selections_file_fkey
    FOREIGN KEY (tenant_id, file_id) REFERENCES app.files (tenant_id, id),
  ADD CONSTRAINT tenant_brand_selections_one_source CHECK (num_nonnulls(brand_asset_id, file_id) = 1);

CREATE INDEX tenant_brand_selections_file_idx ON app.tenant_brand_selections (tenant_id, file_id);

GRANT INSERT (file_id), UPDATE (file_id) ON app.tenant_brand_selections TO aiontheballot_admin;

CREATE FUNCTION private.brand_file_is_public_asset() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
  BEGIN
    -- Only a file the writer can see is checked here. Anyone who can't see it is refused by RLS, with the error the
    -- isolation matrix expects, and the composite foreign key keeps other tenants' files out either way.
    IF NEW.file_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM app.files f
                    WHERE f.id = NEW.file_id AND (f.bucket <> 'public_assets' OR f.byte_size > 2097152)) THEN
      RAISE EXCEPTION 'a brand image must be an image of at most 2 MB in the public_assets bucket'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER file_is_public_asset BEFORE INSERT OR UPDATE OF file_id ON app.tenant_brand_selections
  FOR EACH ROW EXECUTE FUNCTION private.brand_file_is_public_asset();

ALTER POLICY public_read ON app.files
  USING (bucket = 'public_assets'
         AND (EXISTS (SELECT 1 FROM app.parties p WHERE p.logo_file_id = files.id)
              OR EXISTS (SELECT 1 FROM app.tenant_brand_selections s WHERE s.file_id = files.id)));

-- purge_tenant as before (migration purge), with brand selections deleted before the files they may now name.
CREATE OR REPLACE FUNCTION private.purge_tenant(tenant uuid) RETURNS bigint
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
  DECLARE
    -- Children before parents. Cells take their drafts and contributors with them, files their bytes.
    tables text[] := ARRAY[
      'revision_internal', 'revision_evidence', 'revision_checked_documents', 'structural_changes', 'change_requests',
      'assessment_revisions', 'review_events', 'reports', 'report_daily_counts', 'assessment_contributors',
      'draft_checked_documents', 'draft_evidence', 'assessments', 'job_requests', 'llm_suggestions', 'llm_runs',
      'source_texts', 'source_documents', 'methodology_reviewers', 'methodologies', 'criteria', 'parties', 'elections',
      'tenant_brand_selections', 'file_blobs', 'files', 'tenant_documents', 'invitations', 'memberships',
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
      -- Counted first: some rows go with their parents (drafts with their cells, bytes with their files).
      EXECUTE format('SELECT count(*) FROM app.%I WHERE tenant_id = $1', t) INTO n USING tenant;
      IF t NOT IN ('assessment_contributors', 'draft_checked_documents', 'draft_evidence', 'file_blobs') THEN
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
