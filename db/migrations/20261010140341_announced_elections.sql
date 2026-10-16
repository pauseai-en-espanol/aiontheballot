-- migrate:up

-- Announced elections (PLAN R51; ADR-0002, public-visibility rule). A country admin may announce a draft election,
-- so the tenant's coming-soon page can name it and give its date before anything about it is published:
--
-- - The public sees an announced draft's row (name, date, type, territory, slug) and nothing under it. The
--   methodology, its reviewers, parties, criteria, cells and sources stay private until the election goes live:
--   each of their policies checks the election's status itself, not the election's visibility.
-- - Only a country admin (or a platform admin) announces or withdraws the announcement, as for the status; nobody
--   creates an election already announced (no INSERT grant). Audited, and it bumps the public version.
-- - An announced election has its name in the tenant's default locale, the language the public sees first.
-- - The flag only changes while the election is a draft: once live, the election is public anyway.

ALTER TABLE app.elections ADD COLUMN announced boolean NOT NULL DEFAULT false;

-- No SELECT grant to aiontheballot_web: a draft the public can see is announced by definition.
GRANT UPDATE (announced) ON app.elections TO aiontheballot_admin;

DROP TRIGGER country_admin_columns ON app.elections;
CREATE TRIGGER country_admin_columns BEFORE UPDATE ON app.elections
  FOR EACH ROW EXECUTE FUNCTION private.restrict_columns('country_admin', 'status', 'frozen_from', 'frozen_until', 'announced');

ALTER POLICY public_read ON app.elections
  USING ((status IN ('live', 'archived') OR (status = 'draft' AND announced))
         AND EXISTS (SELECT 1 FROM app.tenants t WHERE t.id = elections.tenant_id AND t.active));

-- election_rules as before (migration election_lifecycle), plus the two announcement rules.
CREATE OR REPLACE FUNCTION private.election_rules() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
  DECLARE
    tenant record;
    missing text;
  BEGIN
    SELECT t.active, t.country_code, t.default_locale INTO tenant FROM app.tenants t WHERE t.id = NEW.tenant_id;
    IF NEW.territory_code IS NOT NULL AND NOT starts_with(NEW.territory_code, tenant.country_code || '-') THEN
      RAISE EXCEPTION 'territory % is outside the tenant''s country, %', NEW.territory_code, tenant.country_code
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.announced AND NOT NEW.name ? tenant.default_locale THEN
      RAISE EXCEPTION 'an announced election needs its name in the default locale, %', tenant.default_locale
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
    IF OLD.status <> 'draft' AND NEW.announced IS DISTINCT FROM OLD.announced THEN
      RAISE EXCEPTION 'election %: the announcement is fixed once it leaves draft', OLD.id
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

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
