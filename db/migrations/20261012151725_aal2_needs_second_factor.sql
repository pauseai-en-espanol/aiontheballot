-- migrate:up

-- An aal2 session exists only for an account that has a second factor (ADR-0002 §9, PLAN R84, R156). Better Auth
-- writes aal 2 when a TOTP or backup code creates the session, and the owner's reset of a lost authenticator deletes
-- the account's factor and its sessions in one transaction. A code checked a moment before the reset could otherwise
-- still insert its session after the reset's delete had run, an aal2 session for an account with no factor, which
-- becomes fully signed in once the account enrols again. Now the insert locks the account's factor row (KEY SHARE, as
-- a foreign key would): it waits for a reset deleting it, then finds it gone and is refused; and a reset waits for an
-- insert already holding it, then deletes its session with the others.
-- Only existence is checked, not `verified`: enrolment's own code creates its aal2 session before Better Auth marks the
-- factor verified. Runs as the caller (aiontheballot_auth, which may lock the table it updates); no grant, no definer.

CREATE FUNCTION private.session_needs_second_factor() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    PERFORM 1 FROM auth.two_factors f WHERE f.user_id = NEW.user_id FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'an aal2 session needs its account''s second factor' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END
  $$;
REVOKE ALL ON FUNCTION private.session_needs_second_factor() FROM PUBLIC;

CREATE TRIGGER aal2_needs_second_factor BEFORE INSERT OR UPDATE OF aal ON auth.sessions
  FOR EACH ROW WHEN (NEW.aal = 2) EXECUTE FUNCTION private.session_needs_second_factor();

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
