-- migrate:up

-- Sessions last while they are used, up to a week (PLAN D22; ADR-0003 §2). Each starts with 48 hours, and the API
-- moves its end on as it is used, never past a week from sign-in (apps/api/src/auth/auth.ts); then the password and
-- a second factor, or a passkey, again. Whatever writes a session, its end can't be later than that week.
CREATE FUNCTION private.session_within_a_week() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    IF NEW.expires_at > NEW.created_at + interval '7 days' THEN
      RAISE EXCEPTION 'a session lasts at most a week' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;
REVOKE ALL ON FUNCTION private.session_within_a_week() FROM PUBLIC;

CREATE TRIGGER session_within_a_week BEFORE INSERT OR UPDATE OF expires_at, created_at ON auth.sessions
  FOR EACH ROW EXECUTE FUNCTION private.session_within_a_week();

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
