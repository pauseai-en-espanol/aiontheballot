-- migrate:up

-- Invitations (ADR-0002 §10, spec §3.2): accounts are invite-only. Country admins (and platform admins) invite
-- people into their tenant with a role; the email carries a random token, of which only the SHA-256 is stored.
-- Accepting is private.accept_invitation(token), which comes in M2 with Better Auth's tables, because it checks the
-- invited email against the signed-in user's verified email (PLAN, M2).

CREATE TABLE app.invitations (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants,
  email        text NOT NULL CHECK (email = lower(email) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  role         app.tenant_role NOT NULL,
  token_hash   text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),  -- hex SHA-256; the token is never stored
  expires_at   timestamptz NOT NULL,
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  accepted_by  uuid,
  revoked_at   timestamptz,
  UNIQUE (tenant_id, id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days'),
  CHECK ((accepted_at IS NULL) = (accepted_by IS NULL)),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);
COMMENT ON COLUMN app.invitations.email IS 'personal data';

-- A pending invitation changes once: it is revoked, or accepted before it expires. Nothing else about it changes, and
-- a decided one never changes again. The time (and, on acceptance, the actor) come from the session.
CREATE FUNCTION private.invitation_transition() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    decision text[] := ARRAY['accepted_at', 'accepted_by', 'revoked_at'];
  BEGIN
    IF OLD.accepted_at IS NOT NULL OR OLD.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'invitation % is already decided', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF (to_jsonb(NEW) - decision) IS DISTINCT FROM (to_jsonb(OLD) - decision) THEN
      RAISE EXCEPTION 'invitation %: only revoking or accepting it is allowed', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.revoked_at IS NOT NULL AND NEW.accepted_at IS NULL AND NEW.accepted_by IS NULL THEN
      NEW.revoked_at := now();
    ELSIF NEW.revoked_at IS NULL AND (NEW.accepted_at IS NOT NULL OR NEW.accepted_by IS NOT NULL) THEN
      IF OLD.expires_at <= now() THEN
        RAISE EXCEPTION 'invitation % has expired', OLD.id USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.accepted_at := now();
      NEW.accepted_by := private.current_user_id();
    ELSE
      RAISE EXCEPTION 'invitation %: revoke it or accept it', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.invitations
  FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();
CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.invitations
  FOR EACH ROW EXECUTE FUNCTION private.stamp('created_by', 'created_at');
CREATE TRIGGER transition BEFORE UPDATE ON app.invitations
  FOR EACH ROW EXECUTE FUNCTION private.invitation_transition();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.invitations
  FOR EACH ROW EXECUTE FUNCTION private.audit();

-- Only country admins and platform admins see invitations (they hold emails). They invite, revoke pending
-- invitations, and delete the ones no longer pending, so an email is kept only while it is needed; the audit log
-- keeps the invitation's id, never its email.
ALTER TABLE app.invitations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, DELETE ON app.invitations TO aiontheballot_admin;
GRANT INSERT (tenant_id, email, role, token_hash, expires_at), UPDATE (revoked_at)
  ON app.invitations TO aiontheballot_admin;
CREATE POLICY country_admin_read ON app.invitations FOR SELECT TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()));
CREATE POLICY country_admin_insert ON app.invitations FOR INSERT TO aiontheballot_admin
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()));
CREATE POLICY country_admin_revoke ON app.invitations FOR UPDATE TO aiontheballot_admin
  USING ((tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()))
         AND accepted_at IS NULL AND revoked_at IS NULL)
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()));
CREATE POLICY country_admin_delete ON app.invitations FOR DELETE TO aiontheballot_admin
  USING ((tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()))
         AND (accepted_at IS NOT NULL OR revoked_at IS NOT NULL OR expires_at <= now()));

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
