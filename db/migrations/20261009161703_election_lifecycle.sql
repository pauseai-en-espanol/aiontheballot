-- migrate:up

-- The election lifecycle (spec §3.3, §4): draft → live → archived, never back.
-- - Going live needs an active tenant with its operator, a methodology, and text in the tenant's default locale for
--   the election's name, the methodology, every party name and every criterion; went_live_at is stamped then.
-- - Once live, slugs (printed on share images), the type and the territory are fixed. Other structural edits to a
--   live election go through change requests (a later migration).
-- - An archived election and its structure are read-only (corrections and reports live in other tables).
-- - Territory codes start with the tenant's country code. A methodology uses the tenant's kind, and a demands
--   methodology is owned by the tenant's operator or an endorser. A tenant's kind is fixed once it has a methodology,
--   and its country code while its territories use it.
-- The triggers are named `rules` so they fire after the permission guards (BEFORE triggers fire in name order): a
-- writer without the right is refused as such before any data rule runs.

CREATE FUNCTION private.election_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    tenant record;
    missing text;
  BEGIN
    SELECT t.active, t.country_code, t.default_locale INTO tenant FROM app.tenants t WHERE t.id = NEW.tenant_id;
    IF NEW.territory_code IS NOT NULL AND NOT starts_with(NEW.territory_code, tenant.country_code || '-') THEN
      RAISE EXCEPTION 'territory % is outside the tenant''s country, %', NEW.territory_code, tenant.country_code
        USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'INSERT' THEN
      IF NEW.status <> 'draft' THEN
        RAISE EXCEPTION 'a new election is a draft' USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.went_live_at := NULL;
      RETURN NEW;
    END IF;

    IF OLD.status = 'archived' THEN
      RAISE EXCEPTION 'election % is archived and read-only', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'draft' AND NEW.status = 'live' OR OLD.status = 'live' AND NEW.status = 'archived') THEN
      RAISE EXCEPTION 'election % cannot go from % to %', OLD.id, OLD.status, NEW.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status <> 'draft'
       AND (NEW.slug, NEW.type, NEW.territory_code) IS DISTINCT FROM (OLD.slug, OLD.type, OLD.territory_code) THEN
      RAISE EXCEPTION 'election %: the slug, type and territory are fixed once it leaves draft', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;

    IF OLD.status = 'draft' AND NEW.status = 'live' THEN
      missing := CASE
        WHEN NOT tenant.active THEN 'an active tenant'
        WHEN NOT EXISTS (SELECT 1 FROM app.tenant_organizations o
                          WHERE o.tenant_id = NEW.tenant_id AND o.role = 'operator') THEN 'an operator'
        WHEN NOT EXISTS (SELECT 1 FROM app.methodologies m WHERE m.election_id = NEW.id) THEN 'a methodology'
        WHEN NOT NEW.name ? tenant.default_locale THEN 'its name in the default locale'
        WHEN EXISTS (SELECT 1 FROM app.methodologies m
                      WHERE m.election_id = NEW.id AND NOT m.body ? tenant.default_locale)
          THEN 'the methodology in the default locale'
        WHEN EXISTS (SELECT 1 FROM app.parties p
                      WHERE p.election_id = NEW.id
                        AND NOT (p.name ? tenant.default_locale AND p.short_name ? tenant.default_locale))
          THEN 'every party name in the default locale'
        WHEN EXISTS (SELECT 1 FROM app.criteria c
                      WHERE c.election_id = NEW.id
                        AND NOT (c.title ? tenant.default_locale AND c.description ? tenant.default_locale))
          THEN 'every criterion in the default locale'
      END;
      IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'election % cannot go live without %', OLD.id, missing USING ERRCODE = 'check_violation';
      END IF;
      NEW.went_live_at := now();
    ELSE
      NEW.went_live_at := OLD.went_live_at;
    END IF;
    RETURN NEW;
  END
  $$;

-- For methodologies, external reviewers, parties and criteria. The election is read as the writer: a writer who can't
-- see it is refused by RLS right after.
CREATE FUNCTION private.structure_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    fresh jsonb := to_jsonb(NEW);
    tenant uuid := (fresh ->> 'tenant_id')::uuid;
    election_status app.election_status;
    country text;
  BEGIN
    IF TG_TABLE_NAME = 'methodology_reviewers' THEN
      SELECT e.status INTO election_status
        FROM app.methodologies m JOIN app.elections e ON e.id = m.election_id
       WHERE m.id = (fresh ->> 'methodology_id')::uuid;
    ELSE
      SELECT e.status INTO election_status FROM app.elections e WHERE e.id = (fresh ->> 'election_id')::uuid;
    END IF;
    IF election_status IS NULL THEN
      RETURN NEW;
    END IF;

    IF election_status = 'archived' THEN
      RAISE EXCEPTION 'the election of this %.% row is archived and read-only', TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND election_status <> 'draft' AND fresh ? 'slug'
       AND fresh -> 'slug' IS DISTINCT FROM to_jsonb(OLD) -> 'slug' THEN
      RAISE EXCEPTION 'a %.% slug is fixed once its election leaves draft', TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
    END IF;

    IF jsonb_typeof(fresh -> 'territory_codes') = 'array' THEN
      SELECT t.country_code INTO country FROM app.tenants t WHERE t.id = tenant;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(fresh -> 'territory_codes') c
                  WHERE NOT starts_with(c, country || '-')) THEN
        RAISE EXCEPTION 'a party territory is outside the tenant''s country, %', country
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF TG_TABLE_NAME = 'methodologies' THEN
      IF fresh ->> 'kind' IS DISTINCT FROM (SELECT t.methodology_kind::text FROM app.tenants t WHERE t.id = tenant) THEN
        RAISE EXCEPTION 'a methodology uses its tenant''s kind' USING ERRCODE = 'check_violation';
      END IF;
      IF fresh ->> 'demands_owner_id' IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM app.tenant_organizations o
                          WHERE o.tenant_id = tenant AND o.organization_id = (fresh ->> 'demands_owner_id')::uuid) THEN
        RAISE EXCEPTION 'the demands belong to the tenant''s operator or an endorser' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END
  $$;

-- A tenant's methodology kind is fixed once it has a methodology (published ratings use its scale), and its country
-- code while any territory of its elections or parties uses it.
CREATE FUNCTION private.tenant_dependent_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    IF NEW.methodology_kind IS DISTINCT FROM OLD.methodology_kind
       AND EXISTS (SELECT 1 FROM app.methodologies m WHERE m.tenant_id = NEW.id) THEN
      RAISE EXCEPTION 'tenant %: the methodology kind is fixed once a methodology exists', NEW.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.country_code IS DISTINCT FROM OLD.country_code
       AND (EXISTS (SELECT 1 FROM app.elections e
                     WHERE e.tenant_id = NEW.id AND NOT starts_with(e.territory_code, NEW.country_code || '-'))
            OR EXISTS (SELECT 1 FROM app.parties p CROSS JOIN LATERAL unnest(p.territory_codes) c
                        WHERE p.tenant_id = NEW.id AND NOT starts_with(c, NEW.country_code || '-'))) THEN
      RAISE EXCEPTION 'tenant %: its territories use the country code %', NEW.id, OLD.country_code
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.elections
  FOR EACH ROW EXECUTE FUNCTION private.election_rules();
CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.methodologies
  FOR EACH ROW EXECUTE FUNCTION private.structure_rules();
CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.methodology_reviewers
  FOR EACH ROW EXECUTE FUNCTION private.structure_rules();
CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.parties
  FOR EACH ROW EXECUTE FUNCTION private.structure_rules();
CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.criteria
  FOR EACH ROW EXECUTE FUNCTION private.structure_rules();
CREATE TRIGGER rules BEFORE UPDATE OF methodology_kind, country_code ON app.tenants
  FOR EACH ROW EXECUTE FUNCTION private.tenant_dependent_rules();

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
