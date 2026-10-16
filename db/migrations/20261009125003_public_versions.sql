-- migrate:up

-- The public cache key (ADR-0003, keeping the public cache fresh; spec §3.1). Each web replica keeps rendered pages
-- in memory and checks its tenant's version at least every 60 s, as a safety net for missed revalidation calls; a
-- higher version means "drop the cached pages". The version moves only through the trigger below, on every write to
-- a table the public can read, so no runtime role can set it, and it never goes back (PLAN, Answered).

CREATE TABLE app.public_versions (
  tenant_id  uuid PRIMARY KEY REFERENCES app.tenants,
  version    bigint NOT NULL DEFAULT 0
);

-- Bumps the version of the written row's tenant (its id, for app.tenants), creating it on the tenant's first write.
-- SECURITY DEFINER (ADR-0002 §6) so writers need no grant on public_versions. Attached AFTER INSERT OR UPDATE OR
-- DELETE FOR EACH ROW to every table aiontheballot_web can read; a catalog test enforces it. Clearing the cache more
-- often than needed (say, after editing a draft election) is harmless.
CREATE FUNCTION private.bump_public_version() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $$
  DECLARE
    subject jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
    tenant uuid := (CASE WHEN TG_TABLE_SCHEMA = 'app' AND TG_TABLE_NAME = 'tenants' THEN subject ->> 'id'
                         ELSE subject ->> 'tenant_id' END)::uuid;
  BEGIN
    IF tenant IS NULL THEN
      RAISE EXCEPTION 'private.bump_public_version on %.%: the row has no tenant', TG_TABLE_SCHEMA, TG_TABLE_NAME;
    END IF;
    INSERT INTO app.public_versions AS v (tenant_id, version) VALUES (tenant, 1)
      ON CONFLICT (tenant_id) DO UPDATE SET version = v.version + 1;
    RETURN NULL;
  END
  $$;

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.public_versions
  FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();

-- The public reads the versions of active tenants. No runtime role writes them.
ALTER TABLE app.public_versions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON app.public_versions TO aiontheballot_web;
CREATE POLICY public_read ON app.public_versions FOR SELECT TO aiontheballot_web
  USING (EXISTS (SELECT 1 FROM app.tenants t WHERE t.id = tenant_id AND t.active));

-- The tables so far that the public can read.
CREATE TRIGGER bump_public_version AFTER INSERT OR UPDATE OR DELETE ON app.tenants
  FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();

-- Tenants created before this migration start with a version.
INSERT INTO app.public_versions (tenant_id, version) SELECT id, 1 FROM app.tenants ON CONFLICT DO NOTHING;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
