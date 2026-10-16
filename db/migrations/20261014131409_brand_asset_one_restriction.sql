-- migrate:up

-- The same bytes are never both a restricted brand asset and an unrestricted one (PLAN R200; BRIEF invariant 5, T17;
-- the review of R195). `restricted_assets_are_eligible` lets only a PauseAI chapter use a restricted asset; an
-- unrestricted copy of its image would be the one way around that, and a restricted copy of an unrestricted image
-- would leave the original usable by anyone. So a transaction that leaves some bytes stored with both restrictions is
-- refused at commit, whoever writes it, the owner's scripts included: rows inserted so, changed to the other
-- restriction, or given another's bytes. Copies of the same restriction stay possible, and a group of copies can
-- change its restriction together.

-- Rows already stored first: while some bytes are stored both ways the rule can't hold, so this refuses to run until
-- the owner settles them (PLAN R200 has the query that lists them). Locked, so none arrives before the trigger.
LOCK TABLE app.brand_assets IN SHARE ROW EXCLUSIVE MODE;
DO $$
  DECLARE
    mixed bigint := (SELECT count(*) FROM (SELECT 1 FROM app.brand_assets
                                            GROUP BY sha256 HAVING count(DISTINCT restricted) > 1) m);
  BEGIN
    IF mixed > 0 THEN
      RAISE EXCEPTION 'brand_asset_one_restriction: % images are stored both restricted and not', mixed
        USING ERRCODE = 'check_violation';
    END IF;
  END
  $$;

CREATE FUNCTION private.brand_asset_restriction_is_one() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    -- The check reads what others committed only under read committed, where each statement sees it: under repeatable
    -- read a transaction would miss a row committed while it waited for the lock below, so it may not write these.
    IF current_setting('transaction_isolation') IN ('repeatable read', 'serializable') THEN
      RAISE EXCEPTION 'brand assets are written under read committed, not %',
        current_setting('transaction_isolation') USING ERRCODE = 'invalid_transaction_state';
    END IF;
    -- One check at a time for these bytes, so two transactions can't each pass with the other's row unseen. Taken
    -- when the check runs, at commit unless SET CONSTRAINTS runs it sooner, and held to the transaction's end.
    PERFORM pg_advisory_xact_lock(hashtextextended('brand_asset_restriction:' || NEW.sha256, 0));
    IF (SELECT count(DISTINCT a.restricted) FROM app.brand_assets a WHERE a.sha256 = NEW.sha256) > 1 THEN
      RAISE EXCEPTION 'brand asset %: the same bytes are stored with the other restriction', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END
  $$;

CREATE CONSTRAINT TRIGGER brand_asset_restriction_is_one
  AFTER INSERT OR UPDATE OF sha256, restricted ON app.brand_assets
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.brand_asset_restriction_is_one();

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
