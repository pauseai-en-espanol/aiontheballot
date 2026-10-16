-- migrate:up

-- Exactly one operator per active tenant (BRIEF §3; ADR-0002, platform invariants). The partial unique index on
-- tenant_organizations allows at most one; this deferred check requires one whenever a tenant is active: when it is
-- created or made active, and whenever an operator link is removed or demoted. Deferred to the end of the transaction,
-- so a platform admin can create a tenant with its operator, or replace the operator, in one go.
-- The other half, "only platform admins change the operator or the methodology kind", is already enforced: RLS lets
-- only platform admins write organizations and their links, private.members_may_change() keeps the methodology kind
-- on app.tenants for them, and the audit trigger logs every change.

CREATE FUNCTION private.active_tenant_has_operator() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    tenant uuid := CASE WHEN TG_TABLE_NAME = 'tenants' THEN (to_jsonb(NEW) ->> 'id')::uuid
                        ELSE (to_jsonb(OLD) ->> 'tenant_id')::uuid END;
  BEGIN
    IF EXISTS (SELECT 1 FROM app.tenants t WHERE t.id = tenant AND t.active)
       AND NOT EXISTS (SELECT 1 FROM app.tenant_organizations o WHERE o.tenant_id = tenant AND o.role = 'operator') THEN
      RAISE EXCEPTION 'tenant % is active, so it needs an operator', tenant USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END
  $$;

CREATE CONSTRAINT TRIGGER active_tenant_has_operator AFTER INSERT OR UPDATE OF active ON app.tenants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.active_tenant_has_operator();
CREATE CONSTRAINT TRIGGER active_tenant_has_operator AFTER UPDATE OR DELETE ON app.tenant_organizations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.active_tenant_has_operator();

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
