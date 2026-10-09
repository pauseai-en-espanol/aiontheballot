-- migrate:up

-- Organizations and brand assets (spec §3.1; ADR-0002, platform invariants). Organizations and brand assets are
-- platform-wide: platform admins write them, and tenants link to them (operator and endorsers; granted and selected
-- assets). Only platform admins write organizations, links and grants; country admins choose their tenant's brand
-- selections. The rules that keep one operator per active tenant and restricted assets for eligible tenants come in
-- the next two migrations.

-- Tables ---------------------------------------------------------------------------------------------------------

-- Images stored inline. SVG is not accepted (it can carry script); the hash always matches the content.
CREATE TABLE app.brand_assets (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  name          text NOT NULL,
  restricted    boolean NOT NULL DEFAULT false,           -- e.g. a PauseAI mark: only for eligible tenants
  content_type  text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  sha256        text NOT NULL,
  content       bytea NOT NULL CHECK (octet_length(content) <= 2097152),  -- 2 MB
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (sha256 = encode(sha256(content), 'hex'))
);

-- The legal notice is generated from the operator's row (BRIEF §3, invariant 3), so these columns are public.
CREATE TABLE app.organizations (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  display_name        app.localized NOT NULL,
  legal_name          text NOT NULL,
  tax_id              text,
  address             text,
  registry_entry      text,                                -- pending counsel (PLAN Q6)
  contact_email       text CHECK (contact_email = lower(contact_email)
                                  AND contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  privacy_email       text CHECK (privacy_email = lower(privacy_email)
                                  AND privacy_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),  -- PLAN Q7
  url                 text CHECK (url ~ '^https://'),
  logo_asset_id       uuid REFERENCES app.brand_assets,
  is_pauseai_chapter  boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organizations_logo_asset_id_idx ON app.organizations (logo_asset_id);

CREATE TABLE app.tenant_organizations (
  tenant_id        uuid NOT NULL REFERENCES app.tenants,
  organization_id  uuid NOT NULL REFERENCES app.organizations,
  role             app.org_role NOT NULL,
  display_order    int NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, organization_id)
);
CREATE UNIQUE INDEX tenant_organizations_one_operator_idx ON app.tenant_organizations (tenant_id)
  WHERE role = 'operator';
CREATE INDEX tenant_organizations_organization_id_idx ON app.tenant_organizations (organization_id);

CREATE TABLE app.brand_asset_grants (
  brand_asset_id  uuid NOT NULL REFERENCES app.brand_assets,
  tenant_id       uuid NOT NULL REFERENCES app.tenants,
  granted_by      uuid NOT NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand_asset_id, tenant_id)
);
CREATE INDEX brand_asset_grants_tenant_id_idx ON app.brand_asset_grants (tenant_id);

-- The only source of tenant logos on public pages and share images.
CREATE TABLE app.tenant_brand_selections (
  tenant_id       uuid NOT NULL REFERENCES app.tenants,
  slot            text NOT NULL CHECK (slot ~ '^[a-z]+(_[a-z]+)*$'),  -- e.g. 'product_logo', 'header_mark'
  brand_asset_id  uuid NOT NULL REFERENCES app.brand_assets,
  PRIMARY KEY (tenant_id, slot)
);
CREATE INDEX tenant_brand_selections_brand_asset_id_idx ON app.tenant_brand_selections (brand_asset_id);

-- The public cache key follows shared rows ------------------------------------------------------------------------

-- An organization or brand asset has no tenant of its own: a write to one bumps every tenant whose pages show it
-- (spec §3.1, public_versions). Otherwise unchanged.
CREATE OR REPLACE FUNCTION private.bump_public_version() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $$
  DECLARE
    subject jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
    tenants uuid[];
  BEGIN
    tenants := CASE
      WHEN TG_TABLE_SCHEMA = 'app' AND TG_TABLE_NAME = 'tenants' THEN ARRAY[(subject ->> 'id')::uuid]
      WHEN TG_TABLE_SCHEMA = 'app' AND TG_TABLE_NAME = 'organizations' THEN ARRAY(
        SELECT o.tenant_id FROM app.tenant_organizations o WHERE o.organization_id = (subject ->> 'id')::uuid)
      WHEN TG_TABLE_SCHEMA = 'app' AND TG_TABLE_NAME = 'brand_assets' THEN ARRAY(
        SELECT s.tenant_id FROM app.tenant_brand_selections s WHERE s.brand_asset_id = (subject ->> 'id')::uuid
        UNION
        SELECT o.tenant_id FROM app.tenant_organizations o JOIN app.organizations g ON g.id = o.organization_id
         WHERE g.logo_asset_id = (subject ->> 'id')::uuid)
      ELSE ARRAY[(subject ->> 'tenant_id')::uuid]
    END;
    IF array_position(tenants, NULL) IS NOT NULL THEN
      RAISE EXCEPTION 'private.bump_public_version on %.%: the row has no tenant', TG_TABLE_SCHEMA, TG_TABLE_NAME;
    END IF;
    INSERT INTO app.public_versions AS v (tenant_id, version)
      SELECT t, 1 FROM unnest(tenants) t
      ON CONFLICT (tenant_id) DO UPDATE SET version = v.version + 1;
    RETURN NULL;
  END
  $$;

-- Triggers --------------------------------------------------------------------------------------------------------

CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.brand_assets
  FOR EACH ROW EXECUTE FUNCTION private.stamp('created_at');
CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.organizations
  FOR EACH ROW EXECUTE FUNCTION private.stamp('created_at');
CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.brand_asset_grants
  FOR EACH ROW EXECUTE FUNCTION private.stamp('granted_by', 'granted_at');

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.tenant_organizations
  FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();
CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.brand_asset_grants
  FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();
CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.tenant_brand_selections
  FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();

CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.brand_assets
  FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.organizations
  FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.tenant_organizations
  FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.brand_asset_grants
  FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.tenant_brand_selections
  FOR EACH ROW EXECUTE FUNCTION private.audit();

CREATE TRIGGER bump_public_version AFTER INSERT OR UPDATE OR DELETE ON app.brand_assets
  FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();
CREATE TRIGGER bump_public_version AFTER INSERT OR UPDATE OR DELETE ON app.organizations
  FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();
CREATE TRIGGER bump_public_version AFTER INSERT OR UPDATE OR DELETE ON app.tenant_organizations
  FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();
CREATE TRIGGER bump_public_version AFTER INSERT OR UPDATE OR DELETE ON app.tenant_brand_selections
  FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();

-- Grants and policies ---------------------------------------------------------------------------------------------

ALTER TABLE app.brand_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenant_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.brand_asset_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenant_brand_selections ENABLE ROW LEVEL SECURITY;

-- Links: the public reads those of active tenants; members read their tenants'; platform admins write them.
GRANT SELECT ON app.tenant_organizations TO aiontheballot_web;
CREATE POLICY public_read ON app.tenant_organizations FOR SELECT TO aiontheballot_web
  USING (EXISTS (SELECT 1 FROM app.tenants t WHERE t.id = tenant_id AND t.active));
GRANT SELECT, INSERT (tenant_id, organization_id, role, display_order), UPDATE (role, display_order), DELETE
  ON app.tenant_organizations TO aiontheballot_admin;
CREATE POLICY member_read ON app.tenant_organizations FOR SELECT TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
         OR (SELECT private.is_platform_admin()));
CREATE POLICY platform_admin_insert ON app.tenant_organizations FOR INSERT TO aiontheballot_admin
  WITH CHECK ((SELECT private.is_platform_admin()));
CREATE POLICY platform_admin_update ON app.tenant_organizations FOR UPDATE TO aiontheballot_admin
  USING ((SELECT private.is_platform_admin())) WITH CHECK ((SELECT private.is_platform_admin()));
CREATE POLICY platform_admin_delete ON app.tenant_organizations FOR DELETE TO aiontheballot_admin
  USING ((SELECT private.is_platform_admin()));

-- Organizations: the public reads those linked to an active tenant; members read their tenants'.
GRANT SELECT ON app.organizations TO aiontheballot_web;
CREATE POLICY public_read ON app.organizations FOR SELECT TO aiontheballot_web
  USING (EXISTS (SELECT 1 FROM app.tenant_organizations o JOIN app.tenants t ON t.id = o.tenant_id
                  WHERE o.organization_id = organizations.id AND t.active));
GRANT SELECT, DELETE,
      INSERT (display_name, legal_name, tax_id, address, registry_entry, contact_email, privacy_email, url,
              logo_asset_id, is_pauseai_chapter),
      UPDATE (display_name, legal_name, tax_id, address, registry_entry, contact_email, privacy_email, url,
              logo_asset_id, is_pauseai_chapter)
  ON app.organizations TO aiontheballot_admin;
CREATE POLICY member_read ON app.organizations FOR SELECT TO aiontheballot_admin
  USING (EXISTS (SELECT 1 FROM app.tenant_organizations o
                  WHERE o.organization_id = organizations.id
                    AND o.tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer')))
         OR (SELECT private.is_platform_admin()));
CREATE POLICY platform_admin_insert ON app.organizations FOR INSERT TO aiontheballot_admin
  WITH CHECK ((SELECT private.is_platform_admin()));
CREATE POLICY platform_admin_update ON app.organizations FOR UPDATE TO aiontheballot_admin
  USING ((SELECT private.is_platform_admin())) WITH CHECK ((SELECT private.is_platform_admin()));
CREATE POLICY platform_admin_delete ON app.organizations FOR DELETE TO aiontheballot_admin
  USING ((SELECT private.is_platform_admin()));

-- Grants of restricted assets: private; members read their tenants'.
GRANT SELECT, INSERT (brand_asset_id, tenant_id), DELETE ON app.brand_asset_grants TO aiontheballot_admin;
CREATE POLICY member_read ON app.brand_asset_grants FOR SELECT TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
         OR (SELECT private.is_platform_admin()));
CREATE POLICY platform_admin_insert ON app.brand_asset_grants FOR INSERT TO aiontheballot_admin
  WITH CHECK ((SELECT private.is_platform_admin()));
CREATE POLICY platform_admin_delete ON app.brand_asset_grants FOR DELETE TO aiontheballot_admin
  USING ((SELECT private.is_platform_admin()));

-- Selections: the public reads those of active tenants; country admins choose their tenant's.
GRANT SELECT ON app.tenant_brand_selections TO aiontheballot_web;
CREATE POLICY public_read ON app.tenant_brand_selections FOR SELECT TO aiontheballot_web
  USING (EXISTS (SELECT 1 FROM app.tenants t WHERE t.id = tenant_id AND t.active));
GRANT SELECT, INSERT (tenant_id, slot, brand_asset_id), UPDATE (brand_asset_id), DELETE
  ON app.tenant_brand_selections TO aiontheballot_admin;
CREATE POLICY member_read ON app.tenant_brand_selections FOR SELECT TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
         OR (SELECT private.is_platform_admin()));
CREATE POLICY country_admin_insert ON app.tenant_brand_selections FOR INSERT TO aiontheballot_admin
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()));
CREATE POLICY country_admin_update ON app.tenant_brand_selections FOR UPDATE TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()))
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()));
CREATE POLICY country_admin_delete ON app.tenant_brand_selections FOR DELETE TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()));

-- Brand assets: the public reads unrestricted ones and the restricted ones an active tenant selects. Members read
-- the unrestricted catalogue (to choose from) and the restricted ones granted to or selected by their tenants.
GRANT SELECT ON app.brand_assets TO aiontheballot_web;
CREATE POLICY public_read ON app.brand_assets FOR SELECT TO aiontheballot_web
  USING (NOT restricted
         OR EXISTS (SELECT 1 FROM app.tenant_brand_selections s JOIN app.tenants t ON t.id = s.tenant_id
                     WHERE s.brand_asset_id = brand_assets.id AND t.active));
GRANT SELECT, DELETE, INSERT (name, restricted, content_type, sha256, content), UPDATE (name, restricted)
  ON app.brand_assets TO aiontheballot_admin;
CREATE POLICY member_read ON app.brand_assets FOR SELECT TO aiontheballot_admin
  USING ((NOT restricted AND EXISTS (SELECT private.my_tenants('country_admin', 'editor', 'reviewer')))
         OR EXISTS (SELECT 1 FROM app.brand_asset_grants g
                     WHERE g.brand_asset_id = brand_assets.id
                       AND g.tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer')))
         OR EXISTS (SELECT 1 FROM app.tenant_brand_selections s
                     WHERE s.brand_asset_id = brand_assets.id
                       AND s.tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer')))
         OR (SELECT private.is_platform_admin()));
CREATE POLICY platform_admin_insert ON app.brand_assets FOR INSERT TO aiontheballot_admin
  WITH CHECK ((SELECT private.is_platform_admin()));
CREATE POLICY platform_admin_update ON app.brand_assets FOR UPDATE TO aiontheballot_admin
  USING ((SELECT private.is_platform_admin())) WITH CHECK ((SELECT private.is_platform_admin()));
CREATE POLICY platform_admin_delete ON app.brand_assets FOR DELETE TO aiontheballot_admin
  USING ((SELECT private.is_platform_admin()));

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
