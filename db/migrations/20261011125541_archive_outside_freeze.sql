-- migrate:up

-- No archiving inside a freeze window (PLAN D11, decided by Dani). An archived election can't change its freeze window
-- (it is read-only), and the window holds back corrections and withdrawals whatever the status, so an election
-- archived while a window is set and not over (open-ended, still running or still to come) would keep its corrections
-- frozen for good. Archiving now needs the window over or cleared, which the same statement may do; the admin already
-- asked for that (R107), and the database decides. Like the other freeze refusals, it is restrict_violation: someone
-- set the window after the page loaded, and a reload shows it.

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
    IF OLD.status = 'live' AND NEW.status = 'archived' AND NEW.frozen_from IS NOT NULL
       AND (NEW.frozen_until IS NULL OR NEW.frozen_until > now()) THEN
      RAISE EXCEPTION 'election % cannot be archived while its freeze window is set and not over', OLD.id
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
