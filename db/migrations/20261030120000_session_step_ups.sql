-- migrate:up

-- Confirming it's you again (PLAN D23; ADR-0003 §2). A session can last a week (D22), so the riskiest actions (who
-- has access to a site, a site's settings and who runs it, going live and the review rules, deciding a change,
-- erasure, the audit log, minting a member's token, adding a passkey) want a second factor of the last 12 hours: the
-- session's own, when a code or a passkey created it, or a later one, a code typed again ("Confirm it's you"),
-- recorded here. A passkey confirms by signing in afresh, which makes a new session. Our table beside Better Auth's,
-- for aiontheballot_auth alone (ADR-0002 §2): no tenant data, gone with its session.
--
-- `failures`: wrong codes typed while confirming. Better Auth counts wrong codes only while signing in, so the API
-- counts these, and ends the session at the fifth: then only the password and a code, with the account's own lock,
-- open another.
CREATE TABLE auth.session_step_ups (
  session_id        uuid PRIMARY KEY REFERENCES auth.sessions (id) ON DELETE CASCADE,
  second_factor_at  timestamptz,
  failures          integer NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 5)
);

-- Only a session that passed a second factor (aal2) can confirm again: one a password alone opened never becomes
-- recent. The session's row is locked as a foreign key would (KEY SHARE), so a reset deleting it waits, then takes this
-- with it. Runs as the caller (aiontheballot_auth); no grant, no definer.
CREATE FUNCTION private.step_up_needs_aal2() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    PERFORM 1 FROM auth.sessions s WHERE s.id = NEW.session_id AND s.aal = 2 FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'only a second-factor session confirms again' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END
  $$;
REVOKE ALL ON FUNCTION private.step_up_needs_aal2() FROM PUBLIC;

CREATE TRIGGER step_up_needs_aal2 BEFORE INSERT OR UPDATE ON auth.session_step_ups
  FOR EACH ROW EXECUTE FUNCTION private.step_up_needs_aal2();

GRANT SELECT, INSERT, UPDATE, DELETE ON auth.session_step_ups TO aiontheballot_auth;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
