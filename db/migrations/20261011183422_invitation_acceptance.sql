-- migrate:up

-- Invitations for people with or without an account (editorial workflow A3; PLAN R114, D10; ADR-0002 §6, §7). The
-- API never sees an invitation it can't name by its token, and no runtime role reads auth.users' emails, so two narrow
-- SECURITY DEFINER functions do the reading, for aiontheballot_admin only. Both take the token's SHA-256 (hex), never
-- the token itself, which so stays out of the database's logs.
--
-- private.pending_invitation: the email and role of a pending, unexpired invitation, and nothing for any other token,
-- so the acceptance page can say what is offered and create the account with that email.
-- private.accept_invitation: accepts it for the actor (app.user_id), only if the actor's account has the invited
-- email, verified; it adds the membership (nothing until the account has TOTP: every policy helper wants aal2) and
-- marks the invitation accepted, through its transition trigger. It answers whether it did.

CREATE FUNCTION private.pending_invitation(token_hash text)
  RETURNS TABLE (email text, role app.tenant_role)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = ''
  AS $$
    SELECT i.email, i.role
      FROM app.invitations i
     WHERE i.token_hash = pending_invitation.token_hash
       AND i.accepted_at IS NULL
       AND i.revoked_at IS NULL
       AND i.expires_at > now()
  $$;

CREATE FUNCTION private.accept_invitation(token_hash text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $$
  DECLARE
    actor uuid := private.current_user_id();
    invitation app.invitations;
  BEGIN
    IF actor IS NULL OR accept_invitation.token_hash IS NULL THEN
      RETURN false;
    END IF;
    SELECT i.* INTO invitation
      FROM app.invitations i
     WHERE i.token_hash = accept_invitation.token_hash
       AND i.accepted_at IS NULL
       AND i.revoked_at IS NULL
       AND i.expires_at > now()
       FOR UPDATE;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users u
                    WHERE u.id = actor AND u.email_verified AND lower(u.email) = invitation.email) THEN
      RETURN false;
    END IF;
    -- Holding the role already is no reason to refuse: the invitation is still accepted, once.
    INSERT INTO app.memberships (user_id, tenant_id, role)
    VALUES (actor, invitation.tenant_id, invitation.role)
    ON CONFLICT DO NOTHING;
    UPDATE app.invitations i SET accepted_at = now(), accepted_by = actor WHERE i.id = invitation.id;
    RETURN true;
  END
  $$;

REVOKE ALL ON FUNCTION private.pending_invitation(text), private.accept_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.pending_invitation(text), private.accept_invitation(text) TO aiontheballot_admin;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
