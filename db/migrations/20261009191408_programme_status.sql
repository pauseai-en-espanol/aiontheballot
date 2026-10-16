-- migrate:up

-- A party's programme status (spec §3.3): editors and country admins update it directly, even once the election is
-- live (no change request), audited, and the public sees it with its check date.
--
-- - A new party's programme is pending. 'published' needs a source of that party marked is_programme.
-- - Every update that sets the status, even to the same value, stamps programme_checked_at (the "checked on" date);
--   nobody writes that date otherwise. Not inside the election's freeze window.
-- - When the status becomes 'published', every cell of the party whose current rating is "not mentioned" gets a
--   recheck_reason, so the programme is checked against it.
--
-- These triggers are named after `rules`, so an archived election refuses the update first.

CREATE FUNCTION private.programme_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    election record;
  BEGIN
    -- Every write: the check date is the trigger's alone.
    IF TG_ARGV[0] = 'keep' THEN
      IF TG_OP = 'INSERT' THEN
        IF NEW.programme_status <> 'pending' THEN
          RAISE EXCEPTION 'a new party''s programme is pending' USING ERRCODE = 'restrict_violation';
        END IF;
        NEW.programme_checked_at := NULL;
      ELSE
        NEW.programme_checked_at := OLD.programme_checked_at;
      END IF;
      RETURN NEW;
    END IF;

    -- An update that sets the status: a check, now.
    SELECT e.frozen_from, e.frozen_until INTO election FROM app.elections e WHERE e.id = NEW.election_id;
    IF election.frozen_from <= now() AND (election.frozen_until IS NULL OR now() < election.frozen_until) THEN
      RAISE EXCEPTION 'the election of party % is frozen: nothing public changes until the window ends', NEW.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.programme_status = 'published'
       AND NOT EXISTS (SELECT 1 FROM app.source_documents s WHERE s.party_id = NEW.id AND s.is_programme) THEN
      RAISE EXCEPTION 'party %: a published programme needs a source of the party marked as its programme', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.programme_checked_at := now();
    RETURN NEW;
  END
  $$;

-- Once the programme is published, the party's "not mentioned" ratings are rechecked against it.
CREATE FUNCTION private.programme_recheck() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    UPDATE app.assessments a SET recheck_reason = 'programme_published'
     WHERE a.party_id = NEW.id
       AND a.recheck_reason IS DISTINCT FROM 'programme_published'
       AND EXISTS (SELECT 1 FROM app.current_revisions c WHERE c.assessment_id = a.id AND c.rating = 'not_mentioned');
    RETURN NULL;
  END
  $$;

CREATE TRIGGER rules_programme BEFORE INSERT OR UPDATE ON app.parties
  FOR EACH ROW EXECUTE FUNCTION private.programme_rules('keep');
CREATE TRIGGER rules_programme_checked BEFORE UPDATE OF programme_status ON app.parties
  FOR EACH ROW EXECUTE FUNCTION private.programme_rules('check');
CREATE TRIGGER programme_recheck AFTER UPDATE OF programme_status ON app.parties
  FOR EACH ROW WHEN (OLD.programme_status <> 'published' AND NEW.programme_status = 'published')
  EXECUTE FUNCTION private.programme_recheck();

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
