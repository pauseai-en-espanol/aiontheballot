-- migrate:up

-- Hostnames (ADR-0002, Hostnames; spec §3.1): how tenants are reachable. Only platform admins write them, a
-- hostname is never deleted or moved to another tenant, reserved platform hostnames and those of purged tenants
-- (tombstones) can never be claimed, and a tenant has at most one canonical hostname, verified and not retired.
-- The public reads the verified hostnames of active tenants, retired ones included (they redirect forever).

-- A hostname as stored and as resolve() normalizes it (packages/domain/src/routing.ts): lowercase ASCII, IDNs in
-- punycode, no port, no trailing dot, at least two labels, and a last label starting with a letter, so it can never
-- be read as an IPv4 address.
CREATE DOMAIN app.hostname AS text
  CHECK (
    length(VALUE) <= 253
    AND VALUE ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'
  );

-- Tables ---------------------------------------------------------------------------------------------------------

-- Exact names reserved for the platform: the admin host and the platform domain. Subdomains of the platform domain
-- can still be assigned to tenants.
CREATE TABLE app.platform_hostnames (
  hostname  app.hostname PRIMARY KEY
);

CREATE TABLE app.tenant_hostnames (
  hostname      app.hostname PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES app.tenants,
  is_canonical  boolean NOT NULL DEFAULT false,
  verified_at   timestamptz,                   -- set once, at the transaction time
  retired_at    timestamptz,                   -- set once; a retired hostname still redirects
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT is_canonical OR verified_at IS NOT NULL),
  CHECK (NOT (is_canonical AND retired_at IS NOT NULL))
);
CREATE UNIQUE INDEX tenant_hostnames_one_canonical_idx ON app.tenant_hostnames (tenant_id) WHERE is_canonical;
CREATE INDEX tenant_hostnames_tenant_id_idx ON app.tenant_hostnames (tenant_id);

-- Hostnames of purged tenants: share images printed them, so nobody may ever claim them again. Written only by the
-- purge; never changed or removed.
CREATE TABLE app.hostname_tombstones (
  hostname   app.hostname PRIMARY KEY,
  purged_at  timestamptz NOT NULL DEFAULT now()
);

-- DNS TXT verification, private to platform admins. Only the token's SHA-256 is stored.
CREATE TABLE app.hostname_verifications (
  hostname         app.hostname PRIMARY KEY REFERENCES app.tenant_hostnames,
  token_hash       text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  last_checked_at  timestamptz,
  last_result      text
);

-- Rules ----------------------------------------------------------------------------------------------------------

-- A tenant hostname is free when claimed; it never changes name; verified_at and retired_at are each set once, at
-- the transaction time, and a hostname is never claimed already retired.
CREATE FUNCTION private.tenant_hostname_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF EXISTS (SELECT 1 FROM app.platform_hostnames p WHERE p.hostname = NEW.hostname)
         OR EXISTS (SELECT 1 FROM app.hostname_tombstones t WHERE t.hostname = NEW.hostname) THEN
        RAISE EXCEPTION 'hostname % is reserved and can never be claimed', NEW.hostname
          USING ERRCODE = 'restrict_violation';
      END IF;
      IF NEW.retired_at IS NOT NULL THEN
        RAISE EXCEPTION 'hostname % cannot be claimed already retired', NEW.hostname
          USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.verified_at := CASE WHEN NEW.verified_at IS NOT NULL THEN now() END;
      RETURN NEW;
    END IF;

    IF NEW.hostname IS DISTINCT FROM OLD.hostname THEN
      RAISE EXCEPTION 'hostname % cannot be renamed', OLD.hostname USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.verified_at IS NOT NULL AND NEW.verified_at IS DISTINCT FROM OLD.verified_at
       OR OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at THEN
      RAISE EXCEPTION 'hostname %: verification and retirement are set once', OLD.hostname
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.verified_at IS NULL AND NEW.verified_at IS NOT NULL THEN
      NEW.verified_at := now();
    END IF;
    IF OLD.retired_at IS NULL AND NEW.retired_at IS NOT NULL THEN
      NEW.retired_at := now();
    END IF;
    RETURN NEW;
  END
  $$;

CREATE FUNCTION private.platform_hostname_is_free() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM app.tenant_hostnames t WHERE t.hostname = NEW.hostname) THEN
      RAISE EXCEPTION 'hostname % already belongs to a tenant', NEW.hostname USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;

-- Triggers --------------------------------------------------------------------------------------------------------

CREATE TRIGGER is_free BEFORE INSERT ON app.platform_hostnames
  FOR EACH ROW EXECUTE FUNCTION private.platform_hostname_is_free();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.platform_hostnames
  FOR EACH ROW EXECUTE FUNCTION private.audit();

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.tenant_hostnames
  FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();
CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.tenant_hostnames
  FOR EACH ROW EXECUTE FUNCTION private.tenant_hostname_rules();
CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.tenant_hostnames
  FOR EACH ROW EXECUTE FUNCTION private.stamp('created_at');
-- Never deleted: only a purge removes them, after copying them to hostname_tombstones.
CREATE TRIGGER forbid_delete BEFORE DELETE ON app.tenant_hostnames
  FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation();
CREATE TRIGGER forbid_truncate BEFORE TRUNCATE ON app.tenant_hostnames
  FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_mutation();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.tenant_hostnames
  FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER bump_public_version AFTER INSERT OR UPDATE OR DELETE ON app.tenant_hostnames
  FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();

CREATE TRIGGER forbid_mutation BEFORE UPDATE OR DELETE ON app.hostname_tombstones
  FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation();
CREATE TRIGGER forbid_truncate BEFORE TRUNCATE ON app.hostname_tombstones
  FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_mutation();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.hostname_tombstones
  FOR EACH ROW EXECUTE FUNCTION private.audit();

CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.hostname_verifications
  FOR EACH ROW EXECUTE FUNCTION private.audit();

-- Grants and policies ---------------------------------------------------------------------------------------------

ALTER TABLE app.platform_hostnames ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenant_hostnames ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.hostname_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.hostname_verifications ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT (hostname) ON app.platform_hostnames TO aiontheballot_admin;
CREATE POLICY platform_admin_read ON app.platform_hostnames FOR SELECT TO aiontheballot_admin
  USING ((SELECT private.is_platform_admin()));
CREATE POLICY platform_admin_insert ON app.platform_hostnames FOR INSERT TO aiontheballot_admin
  WITH CHECK ((SELECT private.is_platform_admin()));

GRANT SELECT ON app.tenant_hostnames TO aiontheballot_web;
CREATE POLICY public_read ON app.tenant_hostnames FOR SELECT TO aiontheballot_web
  USING (verified_at IS NOT NULL AND EXISTS (SELECT 1 FROM app.tenants t WHERE t.id = tenant_id AND t.active));
GRANT SELECT, INSERT (hostname, tenant_id, is_canonical, verified_at),
      UPDATE (is_canonical, verified_at, retired_at)
  ON app.tenant_hostnames TO aiontheballot_admin;
CREATE POLICY member_read ON app.tenant_hostnames FOR SELECT TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
         OR (SELECT private.is_platform_admin()));
CREATE POLICY platform_admin_insert ON app.tenant_hostnames FOR INSERT TO aiontheballot_admin
  WITH CHECK ((SELECT private.is_platform_admin()));
CREATE POLICY platform_admin_update ON app.tenant_hostnames FOR UPDATE TO aiontheballot_admin
  USING ((SELECT private.is_platform_admin()))
  WITH CHECK ((SELECT private.is_platform_admin()));

GRANT SELECT ON app.hostname_tombstones TO aiontheballot_web, aiontheballot_admin;
CREATE POLICY public_read ON app.hostname_tombstones FOR SELECT TO aiontheballot_web
  USING (true);
CREATE POLICY platform_admin_read ON app.hostname_tombstones FOR SELECT TO aiontheballot_admin
  USING ((SELECT private.is_platform_admin()));

GRANT SELECT, INSERT (hostname, token_hash), UPDATE (token_hash, last_checked_at, last_result)
  ON app.hostname_verifications TO aiontheballot_admin;
CREATE POLICY platform_admin_read ON app.hostname_verifications FOR SELECT TO aiontheballot_admin
  USING ((SELECT private.is_platform_admin()));
CREATE POLICY platform_admin_insert ON app.hostname_verifications FOR INSERT TO aiontheballot_admin
  WITH CHECK ((SELECT private.is_platform_admin()));
CREATE POLICY platform_admin_update ON app.hostname_verifications FOR UPDATE TO aiontheballot_admin
  USING ((SELECT private.is_platform_admin()))
  WITH CHECK ((SELECT private.is_platform_admin()));

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
