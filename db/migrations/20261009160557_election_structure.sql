-- migrate:up

-- An election and its structure (spec §3.3): elections, their methodology and its external reviewers, parties and
-- criteria, plus the global core criteria. Who writes what (PLAN, Answered: election structure):
-- - editors and country admins: elections (name, date, slug, type, territory), parties and criteria;
-- - country admins: election status and freeze window, the methodology and its external reviewers;
-- - platform admins only: require_second_reviewer, in both directions.
-- A new election always starts as a draft, with four-eyes review on and no freeze (column grants). Structure is
-- deleted only while its election is a draft. Lifecycle rules (going live, archiving, what freezes once live) come in
-- the next migrations. The public reads the structure of live and archived elections of active tenants, and the
-- images their parties show as logos.

-- Tables ---------------------------------------------------------------------------------------------------------

CREATE TABLE app.core_criteria (                   -- global, for future cross-country views
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  key          app.slug NOT NULL UNIQUE,
  title        app.localized NOT NULL,
  description  app.localized NOT NULL
);

CREATE TABLE app.elections (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id                uuid NOT NULL REFERENCES app.tenants,
  slug                     app.slug NOT NULL,
  type                     app.election_type NOT NULL,
  territory_code           text CHECK (territory_code ~ '^[A-Z]{2}-[A-Z0-9]{1,3}$'),  -- ISO 3166-2; null: whole country
  name                     app.localized NOT NULL,
  election_date            date,
  status                   app.election_status NOT NULL DEFAULT 'draft',
  went_live_at             timestamptz,                                   -- set by trigger when it goes live
  require_second_reviewer  boolean NOT NULL DEFAULT true,                 -- four-eyes; platform admins only
  frozen_from              timestamptz,                                   -- the freeze window (PLAN Q8)
  frozen_until             timestamptz,                                   -- null with frozen_from set: until cleared
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, slug),
  CHECK (slug !~ '^[a-z]{2}(-[a-z]{2})?$'),                               -- never a locale prefix such as /ca/
  CHECK (type NOT IN ('general', 'european') OR territory_code IS NULL),
  CHECK (type <> 'regional' OR territory_code IS NOT NULL),
  CHECK (frozen_until IS NULL OR (frozen_from IS NOT NULL AND frozen_until > frozen_from))
);

CREATE TABLE app.methodologies (                   -- one per election
  id                          uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id                   uuid NOT NULL,
  election_id                 uuid NOT NULL UNIQUE,
  kind                        app.methodology_kind NOT NULL,              -- the tenant's kind (next migration)
  demands_owner_id            uuid REFERENCES app.organizations,         -- the operator or an endorser (same)
  body                        app.localized NOT NULL,                     -- Markdown, sanitized on render
  admissible_source_kinds     app.source_kind[] NOT NULL DEFAULT '{pdf,web_page}',  -- may back a rating (PLAN Q9)
  not_mentioned_source_kinds  app.source_kind[] NOT NULL DEFAULT '{pdf,web_page}',  -- may back "not mentioned"
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, election_id) REFERENCES app.elections (tenant_id, id),
  CHECK ((kind = 'demands') = (demands_owner_id IS NOT NULL)),
  CHECK (cardinality(admissible_source_kinds) > 0 AND cardinality(not_mentioned_source_kinds) > 0)
);
CREATE INDEX methodologies_demands_owner_id_idx ON app.methodologies (demands_owner_id);

CREATE TABLE app.methodology_reviewers (           -- named external reviewers, published with consent
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL,
  methodology_id  uuid NOT NULL,
  name            text NOT NULL,
  affiliation     text NOT NULL,
  display_order   int NOT NULL DEFAULT 0,
  retired_at      timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, methodology_id) REFERENCES app.methodologies (tenant_id, id)
);
COMMENT ON COLUMN app.methodology_reviewers.name IS 'personal data';
CREATE INDEX methodology_reviewers_methodology_id_idx ON app.methodology_reviewers (methodology_id);

CREATE TABLE app.parties (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id             uuid NOT NULL,
  election_id           uuid NOT NULL,
  slug                  app.slug NOT NULL,                                -- party pages and share images
  name                  app.localized NOT NULL,
  short_name            app.localized NOT NULL,
  logo_file_id          uuid,                                             -- an image in the public_assets bucket
  colour                text CHECK (colour ~ '^#[0-9a-f]{6}$'),
  display_order         int NOT NULL,
  website               text CHECK (website ~ '^https?://'),
  programme_status      app.programme_status NOT NULL DEFAULT 'pending',
  programme_checked_at  timestamptz,
  territory_codes       text[] CHECK (cardinality(territory_codes) > 0
                                      AND array_to_string(territory_codes, ',')
                                          ~ '^[A-Z]{2}-[A-Z0-9]{1,3}(,[A-Z]{2}-[A-Z0-9]{1,3})*$'),  -- null: everywhere
  retired_at            timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, election_id, id),
  UNIQUE (election_id, slug),
  FOREIGN KEY (tenant_id, election_id) REFERENCES app.elections (tenant_id, id),
  FOREIGN KEY (tenant_id, logo_file_id) REFERENCES app.files (tenant_id, id)
);
CREATE INDEX parties_logo_file_id_idx ON app.parties (logo_file_id);

CREATE TABLE app.criteria (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id          uuid NOT NULL,
  election_id        uuid NOT NULL,
  slug               app.slug NOT NULL,                                   -- criterion pages and share images
  title              app.localized NOT NULL,
  description        app.localized NOT NULL,
  display_order      int NOT NULL,
  core_criterion_id  uuid REFERENCES app.core_criteria,
  retired_at         timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, election_id, id),
  UNIQUE (election_id, slug),
  FOREIGN KEY (tenant_id, election_id) REFERENCES app.elections (tenant_id, id)
);
CREATE INDEX criteria_core_criterion_id_idx ON app.criteria (core_criterion_id);

-- Rules ----------------------------------------------------------------------------------------------------------

-- Restricts columns to some tenant roles: attached BEFORE UPDATE with the roles (comma-separated; empty for platform
-- admins only) and then the columns, e.g. private.restrict_columns('country_admin', 'status', 'frozen_from'). A change
-- to one of those columns needs one of the roles in the row's tenant, at aal2, or a platform admin.
CREATE FUNCTION private.restrict_columns() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    roles app.tenant_role[] := CASE WHEN TG_ARGV[0] = '' THEN '{}' ELSE string_to_array(TG_ARGV[0], ',') END;
    guarded text[] := TG_ARGV[1:TG_NARGS - 1];
    changed text;
  BEGIN
    SELECT string_agg(n.key, ', ' ORDER BY n.key) INTO changed
      FROM jsonb_each(to_jsonb(NEW)) n
     WHERE n.key = ANY (guarded) AND n.value IS DISTINCT FROM to_jsonb(OLD) -> n.key;
    IF changed IS NOT NULL
       AND NOT private.is_platform_admin()
       AND (to_jsonb(NEW) ->> 'tenant_id')::uuid NOT IN (SELECT private.my_tenants(VARIADIC roles)) THEN
      RAISE EXCEPTION 'changing % of %.% needs %', changed, TG_TABLE_SCHEMA, TG_TABLE_NAME,
        CASE WHEN cardinality(roles) = 0 THEN 'a platform admin' ELSE array_to_string(roles, ' or ') END
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END
  $$;

-- A party's logo is a vetted image in the public_assets bucket, never a source document: the logo becomes public.
CREATE FUNCTION private.party_logo_is_public_asset() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    IF NEW.logo_file_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM app.files f WHERE f.id = NEW.logo_file_id AND f.bucket = 'public_assets') THEN
      RAISE EXCEPTION 'a party logo must be an image in the public_assets bucket' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;

-- Core criteria have no tenant of their own: a change bumps the tenants whose criteria use them. Otherwise unchanged.
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
      WHEN TG_TABLE_SCHEMA = 'app' AND TG_TABLE_NAME = 'core_criteria' THEN ARRAY(
        SELECT DISTINCT c.tenant_id FROM app.criteria c WHERE c.core_criterion_id = (subject ->> 'id')::uuid)
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

CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.core_criteria
  FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER bump_public_version AFTER INSERT OR UPDATE OR DELETE ON app.core_criteria
  FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();

CREATE TRIGGER country_admin_columns BEFORE UPDATE ON app.elections
  FOR EACH ROW EXECUTE FUNCTION private.restrict_columns('country_admin', 'status', 'frozen_from', 'frozen_until');
CREATE TRIGGER platform_admin_columns BEFORE UPDATE ON app.elections
  FOR EACH ROW EXECUTE FUNCTION private.restrict_columns('', 'require_second_reviewer');
CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.elections
  FOR EACH ROW EXECUTE FUNCTION private.stamp('created_at');

CREATE TRIGGER logo_is_public_asset BEFORE INSERT OR UPDATE OF logo_file_id ON app.parties
  FOR EACH ROW EXECUTE FUNCTION private.party_logo_is_public_asset();

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['elections', 'methodologies', 'methodology_reviewers', 'parties', 'criteria'] LOOP
    EXECUTE format('CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.%I
                      FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change()', t);
    EXECUTE format('CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.%I
                      FOR EACH ROW EXECUTE FUNCTION private.audit()', t);
    EXECUTE format('CREATE TRIGGER bump_public_version AFTER INSERT OR UPDATE OR DELETE ON app.%I
                      FOR EACH ROW EXECUTE FUNCTION private.bump_public_version()', t);
  END LOOP;
END
$$;

-- Party logos are public now, so their files and bytes follow the public cache too.
CREATE TRIGGER bump_public_version AFTER INSERT OR UPDATE OR DELETE ON app.files
  FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();
CREATE TRIGGER bump_public_version AFTER INSERT OR UPDATE OR DELETE ON app.file_blobs
  FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();

-- Grants and policies ---------------------------------------------------------------------------------------------

ALTER TABLE app.core_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.elections ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.methodologies ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.methodology_reviewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.criteria ENABLE ROW LEVEL SECURITY;

-- Core criteria: public; members read them; platform admins write them.
GRANT SELECT ON app.core_criteria TO aiontheballot_web;
CREATE POLICY public_read ON app.core_criteria FOR SELECT TO aiontheballot_web
  USING (true);
GRANT SELECT, INSERT (key, title, description), UPDATE (key, title, description), DELETE
  ON app.core_criteria TO aiontheballot_admin;
CREATE POLICY member_read ON app.core_criteria FOR SELECT TO aiontheballot_admin
  USING (EXISTS (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
         OR (SELECT private.is_platform_admin()));
CREATE POLICY platform_admin_insert ON app.core_criteria FOR INSERT TO aiontheballot_admin
  WITH CHECK ((SELECT private.is_platform_admin()));
CREATE POLICY platform_admin_update ON app.core_criteria FOR UPDATE TO aiontheballot_admin
  USING ((SELECT private.is_platform_admin())) WITH CHECK ((SELECT private.is_platform_admin()));
CREATE POLICY platform_admin_delete ON app.core_criteria FOR DELETE TO aiontheballot_admin
  USING ((SELECT private.is_platform_admin()));

-- Elections: the public reads live and archived ones of active tenants, without the settings columns.
GRANT SELECT (id, tenant_id, slug, type, territory_code, name, election_date, status, went_live_at, created_at)
  ON app.elections TO aiontheballot_web;
CREATE POLICY public_read ON app.elections FOR SELECT TO aiontheballot_web
  USING (status IN ('live', 'archived')
         AND EXISTS (SELECT 1 FROM app.tenants t WHERE t.id = elections.tenant_id AND t.active));
GRANT SELECT, DELETE,
      INSERT (tenant_id, slug, type, territory_code, name, election_date),
      UPDATE (slug, type, territory_code, name, election_date, status, require_second_reviewer, frozen_from,
              frozen_until)
  ON app.elections TO aiontheballot_admin;
CREATE POLICY member_read ON app.elections FOR SELECT TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
         OR (SELECT private.is_platform_admin()));
CREATE POLICY editor_insert ON app.elections FOR INSERT TO aiontheballot_admin
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor'))
              OR (SELECT private.is_platform_admin()));
CREATE POLICY editor_update ON app.elections FOR UPDATE TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor')) OR (SELECT private.is_platform_admin()))
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor'))
              OR (SELECT private.is_platform_admin()));
CREATE POLICY country_admin_delete ON app.elections FOR DELETE TO aiontheballot_admin
  USING ((tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()))
         AND status = 'draft');

-- Methodologies and their external reviewers: public with their election; country admins write them.
GRANT SELECT ON app.methodologies TO aiontheballot_web;
CREATE POLICY public_read ON app.methodologies FOR SELECT TO aiontheballot_web
  USING (EXISTS (SELECT 1 FROM app.elections e
                  WHERE e.id = methodologies.election_id AND e.status IN ('live', 'archived')));
GRANT SELECT, DELETE,
      INSERT (tenant_id, election_id, kind, demands_owner_id, body, admissible_source_kinds,
              not_mentioned_source_kinds),
      UPDATE (kind, demands_owner_id, body, admissible_source_kinds, not_mentioned_source_kinds)
  ON app.methodologies TO aiontheballot_admin;
CREATE POLICY member_read ON app.methodologies FOR SELECT TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
         OR (SELECT private.is_platform_admin()));
CREATE POLICY country_admin_insert ON app.methodologies FOR INSERT TO aiontheballot_admin
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()));
CREATE POLICY country_admin_update ON app.methodologies FOR UPDATE TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()))
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()));
CREATE POLICY country_admin_delete ON app.methodologies FOR DELETE TO aiontheballot_admin
  USING ((tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()))
         AND EXISTS (SELECT 1 FROM app.elections e WHERE e.id = methodologies.election_id AND e.status = 'draft'));

GRANT SELECT ON app.methodology_reviewers TO aiontheballot_web;
CREATE POLICY public_read ON app.methodology_reviewers FOR SELECT TO aiontheballot_web
  USING (EXISTS (SELECT 1 FROM app.methodologies m JOIN app.elections e ON e.id = m.election_id
                  WHERE m.id = methodology_reviewers.methodology_id AND e.status IN ('live', 'archived')));
GRANT SELECT, DELETE,
      INSERT (tenant_id, methodology_id, name, affiliation, display_order),
      UPDATE (name, affiliation, display_order, retired_at)
  ON app.methodology_reviewers TO aiontheballot_admin;
CREATE POLICY member_read ON app.methodology_reviewers FOR SELECT TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
         OR (SELECT private.is_platform_admin()));
CREATE POLICY country_admin_insert ON app.methodology_reviewers FOR INSERT TO aiontheballot_admin
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()));
CREATE POLICY country_admin_update ON app.methodology_reviewers FOR UPDATE TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()))
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()));
CREATE POLICY country_admin_delete ON app.methodology_reviewers FOR DELETE TO aiontheballot_admin
  USING ((tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()))
         AND EXISTS (SELECT 1 FROM app.methodologies m JOIN app.elections e ON e.id = m.election_id
                      WHERE m.id = methodology_reviewers.methodology_id AND e.status = 'draft'));

-- Parties and criteria: public with their election; editors and country admins write them.
GRANT SELECT ON app.parties, app.criteria TO aiontheballot_web;
CREATE POLICY public_read ON app.parties FOR SELECT TO aiontheballot_web
  USING (EXISTS (SELECT 1 FROM app.elections e WHERE e.id = parties.election_id AND e.status IN ('live', 'archived')));
CREATE POLICY public_read ON app.criteria FOR SELECT TO aiontheballot_web
  USING (EXISTS (SELECT 1 FROM app.elections e WHERE e.id = criteria.election_id AND e.status IN ('live', 'archived')));
GRANT SELECT, DELETE,
      INSERT (tenant_id, election_id, slug, name, short_name, logo_file_id, colour, display_order, website,
              territory_codes),
      UPDATE (slug, name, short_name, logo_file_id, colour, display_order, website, programme_status,
              programme_checked_at, territory_codes, retired_at)
  ON app.parties TO aiontheballot_admin;
GRANT SELECT, DELETE,
      INSERT (tenant_id, election_id, slug, title, description, display_order, core_criterion_id),
      UPDATE (slug, title, description, display_order, core_criterion_id, retired_at)
  ON app.criteria TO aiontheballot_admin;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['parties', 'criteria'] LOOP
    EXECUTE format($p$
      CREATE POLICY member_read ON app.%1$I FOR SELECT TO aiontheballot_admin
        USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
               OR (SELECT private.is_platform_admin()));
      CREATE POLICY editor_insert ON app.%1$I FOR INSERT TO aiontheballot_admin
        WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor'))
                    OR (SELECT private.is_platform_admin()));
      CREATE POLICY editor_update ON app.%1$I FOR UPDATE TO aiontheballot_admin
        USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor'))
               OR (SELECT private.is_platform_admin()))
        WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor'))
                    OR (SELECT private.is_platform_admin()));
      CREATE POLICY editor_delete ON app.%1$I FOR DELETE TO aiontheballot_admin
        USING ((tenant_id IN (SELECT private.my_tenants('country_admin', 'editor'))
                OR (SELECT private.is_platform_admin()))
               AND EXISTS (SELECT 1 FROM app.elections e WHERE e.id = %1$I.election_id AND e.status = 'draft'));
    $p$, t);
  END LOOP;
END
$$;

-- Party logos: the public reads an image of the public_assets bucket while a party of a live or archived election
-- shows it, and its bytes; never the uploader or the original file name.
GRANT SELECT (id, tenant_id, bucket, content_type, byte_size, sha256, created_at) ON app.files TO aiontheballot_web;
CREATE POLICY public_read ON app.files FOR SELECT TO aiontheballot_web
  USING (bucket = 'public_assets'
         AND EXISTS (SELECT 1 FROM app.parties p WHERE p.logo_file_id = files.id));
GRANT SELECT ON app.file_blobs TO aiontheballot_web;
CREATE POLICY public_read ON app.file_blobs FOR SELECT TO aiontheballot_web
  USING (EXISTS (SELECT 1 FROM app.files f WHERE f.id = file_blobs.file_id AND f.bucket = 'public_assets'));

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
