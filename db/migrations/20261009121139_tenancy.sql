-- migrate:up

-- Tenancy (ADR-0002 §4, §8, §9; spec §3.1–§3.2): tenants, platform admins and memberships, plus the policy helpers
-- every member policy uses. The admin shows each user only what is theirs: aiontheballot_admin sees what memberships
-- give it, platform admins see every tenant, and public-visibility policies are for aiontheballot_web only.

-- Tables ---------------------------------------------------------------------------------------------------------

CREATE TABLE app.tenants (
  id                               uuid PRIMARY KEY DEFAULT uuidv7(),
  slug                             app.slug NOT NULL UNIQUE,
  country_code                     text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),  -- ISO 3166-1; tests use XA–XZ
  default_locale                   app.locale NOT NULL,
  enabled_locales                  app.locale[] NOT NULL,                               -- public locales
  display_name                     app.localized NOT NULL,
  theme                            jsonb NOT NULL DEFAULT '{}',                         -- colours; logos are brand selections
  methodology_kind                 app.methodology_kind NOT NULL,                       -- platform admins only
  active                           boolean NOT NULL DEFAULT false,                      -- platform admins only
  live_edits_need_second_approver  boolean NOT NULL DEFAULT false,                      -- platform admins only
  report_retention_days            int NOT NULL CHECK (report_retention_days > 0),
  llm_monthly_cap_usd              numeric(10, 2) NOT NULL DEFAULT 0 CHECK (llm_monthly_cap_usd >= 0),  -- 0: no LLM
  created_at                       timestamptz NOT NULL DEFAULT now(),
  CHECK (default_locale = ANY (enabled_locales)),
  -- Named colours only ({"primary": "#0a0b0c"}), so the theme can never carry CSS. Contrast is checked by the admin.
  CONSTRAINT theme_is_colours CHECK (
    CASE WHEN jsonb_typeof(theme) = 'object' THEN
      NOT jsonb_path_exists(theme, '$.keyvalue() ? (!(@.key like_regex "^[a-z]+(_[a-z]+)*$")
                                                    || @.value.type() != "string"
                                                    || !(@.value like_regex "^#[0-9a-f]{6}$"))')
    ELSE false
    END
  )
);

-- Platform admins are not a tenant role (ADR-0002 §8). There is no write path from the app: rows are added and
-- removed by the owner, following the platform-admin runbook.
CREATE TABLE app.platform_admins (
  user_id     uuid PRIMARY KEY,                -- the Better Auth user; a foreign key comes with the auth schema
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.memberships (
  user_id     uuid NOT NULL,                   -- the Better Auth user; a foreign key comes with the auth schema
  tenant_id   uuid NOT NULL REFERENCES app.tenants,
  role        app.tenant_role NOT NULL,
  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id, role)
);
CREATE INDEX memberships_tenant_id_idx ON app.memberships (tenant_id);

-- Policy helpers (ADR-0002 §8–§9) ---------------------------------------------------------------------------------

-- SECURITY DEFINER so that policies on memberships and platform_admins can use them without recursing into their own
-- RLS. Both return nothing unless the session completed TOTP (app.aal = 2), so a stolen password alone reads nothing.
-- Policies call them as `tenant_id IN (SELECT private.my_tenants(...))` and `(SELECT private.is_platform_admin())`,
-- which Postgres evaluates once per statement.
CREATE FUNCTION private.my_tenants(VARIADIC roles app.tenant_role[]) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = ''
  AS $$
    SELECT m.tenant_id
      FROM app.memberships m
     WHERE private.current_aal() = 2
       AND m.user_id = private.current_user_id()
       AND m.role = ANY (roles)
  $$;

CREATE FUNCTION private.is_platform_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = ''
  AS $$
    SELECT private.current_aal() = 2
       AND EXISTS (SELECT 1 FROM app.platform_admins p WHERE p.user_id = private.current_user_id())
  $$;

GRANT EXECUTE ON FUNCTION private.my_tenants(app.tenant_role[]), private.is_platform_admin() TO aiontheballot_admin;

-- Unless the actor is a platform admin, an update may change only the columns given as arguments (plus updated_by
-- and updated_at, which private.stamp sets). Attached BEFORE UPDATE FOR EACH ROW. Listing what members may change,
-- rather than what they may not, keeps a new column closed until someone opens it.
CREATE FUNCTION private.members_may_change() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    open text[] := coalesce(TG_ARGV::text[], '{}') || ARRAY['updated_by', 'updated_at'];
    changed text;
  BEGIN
    SELECT string_agg(n.key, ', ' ORDER BY n.key) INTO changed
      FROM jsonb_each(to_jsonb(NEW) - open) n
     WHERE n.value IS DISTINCT FROM (to_jsonb(OLD) - open) -> n.key;
    IF changed IS NOT NULL AND NOT private.is_platform_admin() THEN
      RAISE EXCEPTION 'only platform admins may change % of %.%', changed, TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END
  $$;

-- Triggers --------------------------------------------------------------------------------------------------------

CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.tenants
  FOR EACH ROW EXECUTE FUNCTION private.stamp('created_at');
-- Country admins run their own tenant's theme, report retention and LLM cap (ADR-0002, capabilities by role).
CREATE TRIGGER members_may_change BEFORE UPDATE ON app.tenants
  FOR EACH ROW EXECUTE FUNCTION private.members_may_change('theme', 'report_retention_days', 'llm_monthly_cap_usd');

CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.platform_admins
  FOR EACH ROW EXECUTE FUNCTION private.stamp('created_at');

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.memberships
  FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();
CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.memberships
  FOR EACH ROW EXECUTE FUNCTION private.stamp('created_by', 'created_at');

-- Grants and policies ---------------------------------------------------------------------------------------------

ALTER TABLE app.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY;

-- The public reads active tenants, without the settings columns.
GRANT SELECT (id, slug, country_code, default_locale, enabled_locales, display_name, theme, methodology_kind, active,
              created_at)
  ON app.tenants TO aiontheballot_web;
CREATE POLICY public_read ON app.tenants FOR SELECT TO aiontheballot_web
  USING (active);

GRANT SELECT ON app.tenants TO aiontheballot_admin;
GRANT INSERT (slug, country_code, default_locale, enabled_locales, display_name, theme, methodology_kind, active,
              live_edits_need_second_approver, report_retention_days, llm_monthly_cap_usd),
      UPDATE (slug, country_code, default_locale, enabled_locales, display_name, theme, methodology_kind, active,
              live_edits_need_second_approver, report_retention_days, llm_monthly_cap_usd)
  ON app.tenants TO aiontheballot_admin;
CREATE POLICY member_read ON app.tenants FOR SELECT TO aiontheballot_admin
  USING (id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
         OR (SELECT private.is_platform_admin()));
CREATE POLICY platform_admin_insert ON app.tenants FOR INSERT TO aiontheballot_admin
  WITH CHECK ((SELECT private.is_platform_admin()));
CREATE POLICY country_admin_update ON app.tenants FOR UPDATE TO aiontheballot_admin
  USING (id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()))
  WITH CHECK (id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()));

-- A platform admin can see who the platform admins are; nobody can change them from the app.
GRANT SELECT ON app.platform_admins TO aiontheballot_admin;
CREATE POLICY platform_admin_read ON app.platform_admins FOR SELECT TO aiontheballot_admin
  USING ((SELECT private.is_platform_admin()));

-- Members see their tenants' members; country admins add and remove them. A role change is a delete and an insert.
GRANT SELECT, DELETE ON app.memberships TO aiontheballot_admin;
GRANT INSERT (user_id, tenant_id, role) ON app.memberships TO aiontheballot_admin;
CREATE POLICY member_read ON app.memberships FOR SELECT TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
         OR (SELECT private.is_platform_admin()));
CREATE POLICY country_admin_insert ON app.memberships FOR INSERT TO aiontheballot_admin
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()));
CREATE POLICY country_admin_delete ON app.memberships FOR DELETE TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()));

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
