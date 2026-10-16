-- migrate:up

-- A pending invitation names the site it invites to (PLAN R199; admin forms §2, members and invitations; ADR-0002 §10,
-- amended): the site's display name and its main language, the one its name is shown in when the page's isn't among
-- them, so the page that accepts it can say where its holder is joining. Nothing else of the site, and only the
-- invitation's own: its email, which went to the same holder, named the site already. The function keeps its argument,
-- owner, search path and grant; only its result grows, which takes dropping it and creating it again.

DROP FUNCTION private.pending_invitation(text);

CREATE FUNCTION private.pending_invitation(token_hash text)
  RETURNS TABLE(email text, role app.tenant_role, site_name app.localized, site_locale text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = ''
  AS $$
    SELECT i.email, i.role, t.display_name, t.default_locale::text
      FROM app.invitations i
      JOIN app.tenants t ON t.id = i.tenant_id
     WHERE i.token_hash = pending_invitation.token_hash
       AND i.accepted_at IS NULL
       AND i.revoked_at IS NULL
       AND i.expires_at > now()
  $$;

REVOKE ALL ON FUNCTION private.pending_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.pending_invitation(text) TO aiontheballot_admin;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
