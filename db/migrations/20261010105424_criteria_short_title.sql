-- migrate:up

-- A criterion's short title (PLAN, Answered: scorecard orientation; M2 spec W22). The public table always puts parties
-- down the side and criteria across the top, and a criterion's full title is too long for a column header. Localized,
-- like the title.
--
-- - Nullable, so existing drafts stay valid; editors fill it in while the election is a draft.
-- - A public election's criteria have one in the default locale: going live needs it for every criterion, and a
--   criterion of a live or archived election can't be written without it.
-- - Once live it is change-controlled like the title, and a change request that adds a criterion or changes it needs
--   it in the default locale.
--
-- The go-live check is its own trigger, not another clause in election_rules, so this migration leaves that function
-- alone.

ALTER TABLE app.criteria ADD COLUMN short_title app.localized;

GRANT INSERT (short_title), UPDATE (short_title) ON app.criteria TO aiontheballot_admin;

CREATE FUNCTION private.short_title_rules() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
  DECLARE
    -- As jsonb: a record has no field the other table lacks, even in a branch that isn't taken.
    election_id uuid := (to_jsonb(NEW) ->> CASE TG_TABLE_NAME WHEN 'elections' THEN 'id' ELSE 'election_id' END)::uuid;
    default_locale text;
    status app.election_status;
  BEGIN
    SELECT t.default_locale, e.status INTO default_locale, status
      FROM app.elections e JOIN app.tenants t ON t.id = e.tenant_id
     WHERE e.id = election_id;
    IF TG_TABLE_NAME = 'elections' THEN
      IF EXISTS (SELECT 1 FROM app.criteria c
                  WHERE c.election_id = NEW.id AND NOT coalesce(c.short_title ? default_locale, false)) THEN
        RAISE EXCEPTION 'election % cannot go live without every criterion''s short title in the default locale',
          NEW.id USING ERRCODE = 'check_violation';
      END IF;
    -- An election the writer can't see leaves status null and passes here: RLS refuses that write itself, with the
    -- permission error the isolation matrix expects.
    ELSIF status <> 'draft' AND NOT coalesce(NEW.short_title ? default_locale, false) THEN
      RAISE EXCEPTION 'a criterion of % election % needs its short title in the default locale, %', status,
        election_id, default_locale USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER short_title_rules BEFORE UPDATE OF status ON app.elections
  FOR EACH ROW WHEN (OLD.status = 'draft' AND NEW.status = 'live')
  EXECUTE FUNCTION private.short_title_rules();
CREATE TRIGGER short_title_rules BEFORE INSERT OR UPDATE ON app.criteria
  FOR EACH ROW EXECUTE FUNCTION private.short_title_rules();

-- change_control and change_request_rules as before (migration change_control), with short_title among a
-- criterion's change-controlled, addable and localized columns.
CREATE OR REPLACE FUNCTION private.change_control() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  DECLARE
    fresh jsonb := to_jsonb(NEW);
    stale jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
    kind text := CASE TG_TABLE_NAME
      WHEN 'elections' THEN 'election' WHEN 'methodologies' THEN 'methodology'
      WHEN 'methodology_reviewers' THEN 'methodology_reviewer' WHEN 'parties' THEN 'party' ELSE 'criterion' END;
    controlled text[] := CASE kind
      WHEN 'election' THEN ARRAY['name', 'election_date']
      WHEN 'methodology' THEN ARRAY['demands_owner_id', 'body', 'admissible_source_kinds', 'not_mentioned_source_kinds']
      WHEN 'methodology_reviewer' THEN ARRAY['name', 'affiliation', 'display_order']
      WHEN 'party' THEN ARRAY['name', 'short_name', 'logo_file_id', 'colour', 'display_order', 'website', 'territory_codes']
      ELSE ARRAY['title', 'short_title', 'description', 'display_order', 'core_criterion_id'] END;
    target_election uuid;
    status app.election_status;
    col text;
  BEGIN
    IF kind = 'election' THEN
      target_election := (fresh ->> 'id')::uuid;
      status := (stale ->> 'status')::app.election_status;  -- what it was before this write; a new one is a draft
    ELSE
      target_election := CASE WHEN kind = 'methodology_reviewer'
        THEN (SELECT m.election_id FROM app.methodologies m WHERE m.id = (fresh ->> 'methodology_id')::uuid)
        ELSE (fresh ->> 'election_id')::uuid END;
      SELECT e.status INTO status FROM app.elections e WHERE e.id = target_election;
    END IF;
    IF status IS DISTINCT FROM 'live' THEN
      RETURN NULL;
    END IF;

    IF TG_OP = 'INSERT' THEN
      IF NOT EXISTS (SELECT 1 FROM app.change_requests r
                      WHERE r.election_id = target_election AND r.target_kind = kind AND r.action = 'add'
                        AND r.state = 'approved' AND r.decided_txid = pg_current_xact_id()
                        AND fresh @> r.proposed_value
                        AND NOT EXISTS (SELECT 1 FROM app.structural_changes s WHERE s.change_request_id = r.id)) THEN
        RAISE EXCEPTION 'adding a % to live election % needs a change request approved in this transaction', kind,
          target_election USING ERRCODE = 'restrict_violation';
      END IF;
      RETURN NULL;
    END IF;
    FOREACH col IN ARRAY controlled || ARRAY['retired_at'] LOOP
      CONTINUE WHEN fresh -> col IS NOT DISTINCT FROM stale -> col;
      IF NOT EXISTS (SELECT 1 FROM app.change_requests r
                      WHERE r.target_id = (fresh ->> 'id')::uuid AND r.target_kind = kind
                        AND r.state = 'approved' AND r.decided_txid = pg_current_xact_id()
                        AND CASE WHEN col = 'retired_at' THEN r.action = 'retire'
                                 ELSE r.action = 'update' AND r.field = col AND r.proposed_value = fresh -> col END) THEN
        RAISE EXCEPTION 'changing % of a % in live election % needs a change request approved in this transaction',
          col, kind, target_election USING ERRCODE = 'restrict_violation';
      END IF;
    END LOOP;
    RETURN NULL;
  END
  $$;

CREATE OR REPLACE FUNCTION private.change_request_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
  DECLARE
    tbl text := CASE NEW.target_kind
      WHEN 'election' THEN 'elections' WHEN 'methodology' THEN 'methodologies'
      WHEN 'methodology_reviewer' THEN 'methodology_reviewers' WHEN 'party' THEN 'parties' ELSE 'criteria' END;
    updatable text[] := CASE NEW.target_kind
      WHEN 'election' THEN ARRAY['name', 'election_date']
      WHEN 'methodology' THEN ARRAY['demands_owner_id', 'body', 'admissible_source_kinds', 'not_mentioned_source_kinds']
      WHEN 'methodology_reviewer' THEN ARRAY['name', 'affiliation', 'display_order']
      WHEN 'party' THEN ARRAY['name', 'short_name', 'logo_file_id', 'colour', 'display_order', 'website', 'territory_codes']
      ELSE ARRAY['title', 'short_title', 'description', 'display_order', 'core_criterion_id'] END;
    -- Elections and methodologies are never added or retired.
    addable text[] := CASE NEW.target_kind
      WHEN 'methodology_reviewer' THEN ARRAY['name', 'affiliation', 'display_order']
      WHEN 'party' THEN ARRAY['slug', 'name', 'short_name', 'logo_file_id', 'colour', 'display_order', 'website',
                              'territory_codes']
      WHEN 'criterion' THEN ARRAY['slug', 'title', 'short_title', 'description', 'display_order', 'core_criterion_id']
        END;
    localized text[] := CASE NEW.target_kind
      WHEN 'election' THEN ARRAY['name'] WHEN 'methodology' THEN ARRAY['body'] WHEN 'party' THEN ARRAY['name', 'short_name']
      WHEN 'criterion' THEN ARRAY['title', 'short_title', 'description'] ELSE '{}' END;
    -- The target, read as the writer: it must be in the request's election.
    find_target text := format('SELECT to_jsonb(x) FROM app.%I x WHERE x.id = $1 AND %s', tbl, CASE NEW.target_kind
      WHEN 'election' THEN 'x.id = $2'
      WHEN 'methodology_reviewer'
        THEN 'EXISTS (SELECT 1 FROM app.methodologies m WHERE m.id = x.methodology_id AND m.election_id = $2)'
      ELSE 'x.election_id = $2' END);
    election record;
    target jsonb;
    proposed jsonb;
    created uuid;
    changed int;
  BEGIN
    IF TG_WHEN = 'AFTER' THEN
      IF NOT (OLD.state = 'pending' AND NEW.state = 'approved') THEN
        RETURN NULL;
      END IF;
      IF NEW.action = 'update' THEN
        EXECUTE format('UPDATE app.%1$I t SET %2$I = r.%2$I FROM jsonb_populate_record(NULL::app.%1$I, $1) r
                         WHERE t.id = $2', tbl, NEW.field)
          USING jsonb_build_object(NEW.field, NEW.proposed_value), NEW.target_id;
      ELSIF NEW.action = 'retire' THEN
        EXECUTE format('UPDATE app.%I SET retired_at = now() WHERE id = $1', tbl) USING NEW.target_id;
      ELSE
        proposed := NEW.proposed_value || CASE NEW.target_kind
          WHEN 'methodology_reviewer' THEN jsonb_build_object('tenant_id', NEW.tenant_id, 'methodology_id',
            (SELECT m.id FROM app.methodologies m WHERE m.election_id = NEW.election_id))
          ELSE jsonb_build_object('tenant_id', NEW.tenant_id, 'election_id', NEW.election_id) END;
        EXECUTE format('INSERT INTO app.%1$I (%2$s) SELECT %2$s FROM jsonb_populate_record(NULL::app.%1$I, $1)
                        RETURNING id', tbl,
                       (SELECT string_agg(format('%I', k), ', ') FROM jsonb_object_keys(proposed) k))
          INTO created USING proposed;
      END IF;
      GET DIAGNOSTICS changed = ROW_COUNT;
      IF changed <> 1 THEN
        RAISE EXCEPTION 'approving change request % needs the right to make the change', NEW.id
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      INSERT INTO app.structural_changes (tenant_id, election_id, change_request_id, action, target_kind, target_id,
                                          field, previous_value, new_value, public_note)
      VALUES (NEW.tenant_id, NEW.election_id, NEW.id, NEW.action, NEW.target_kind, coalesce(NEW.target_id, created),
              NEW.field, NEW.previous_value, NEW.proposed_value, NEW.public_note);
      RETURN NULL;
    END IF;

    SELECT e.status, e.frozen_from, e.frozen_until, t.default_locale, t.live_edits_need_second_approver INTO election
      FROM app.elections e JOIN app.tenants t ON t.id = e.tenant_id
     WHERE e.id = NEW.election_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'election % is not visible to the writer', NEW.election_id USING ERRCODE = 'insufficient_privilege';
    END IF;
    EXECUTE find_target INTO target USING NEW.target_id, NEW.election_id;

    IF TG_OP = 'INSERT' THEN
      IF election.status <> 'live' THEN
        RAISE EXCEPTION 'election % is %: change requests are for live elections', NEW.election_id, election.status
          USING ERRCODE = 'restrict_violation';
      END IF;
      IF NEW.state <> 'pending' THEN
        RAISE EXCEPTION 'a change request starts pending' USING ERRCODE = 'restrict_violation';
      END IF;
      IF NEW.action <> 'add' AND target IS NULL THEN
        RAISE EXCEPTION 'the % to change is not in election %', NEW.target_kind, NEW.election_id
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.action = 'update' AND NOT (NEW.field = ANY (updatable) AND NEW.proposed_value IS NOT NULL)
         OR NEW.action <> 'update' AND addable IS NULL
         OR NEW.action = 'retire' AND (NEW.proposed_value IS NOT NULL OR target ->> 'retired_at' IS NOT NULL)
         OR NEW.action = 'add' AND (jsonb_typeof(NEW.proposed_value) IS DISTINCT FROM 'object'
                                   OR EXISTS (SELECT 1 FROM jsonb_object_keys(NEW.proposed_value) k
                                               WHERE NOT k = ANY (addable))) THEN
        RAISE EXCEPTION 'a % change request cannot % that', NEW.target_kind, NEW.action USING ERRCODE = 'check_violation';
      END IF;
      -- Values as the column will store them, so the approved write can be matched exactly.
      IF NEW.action <> 'retire' THEN
        EXECUTE format('SELECT jsonb_object_agg(k, to_jsonb(r) -> k) FROM jsonb_populate_record(NULL::app.%I, $1) r,
                               jsonb_object_keys($1) k', tbl)
          INTO proposed
          USING CASE WHEN NEW.action = 'add' THEN NEW.proposed_value
                     ELSE jsonb_build_object(NEW.field, NEW.proposed_value) END;
        NEW.proposed_value := CASE WHEN NEW.action = 'add' THEN proposed ELSE proposed -> NEW.field END;
      END IF;
      NEW.previous_value := CASE WHEN NEW.action = 'update' THEN target -> NEW.field END;
      NEW.decided_by := NULL;
      NEW.decided_at := NULL;
      NEW.decided_txid := NULL;
      RETURN NEW;
    END IF;

    -- A decision, once: only the state changes; who, when and the approving transaction come from the session.
    IF OLD.state <> 'pending' THEN
      RAISE EXCEPTION 'change request % is decided and never changes', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF (to_jsonb(NEW) - ARRAY['state', 'decided_by', 'decided_at', 'decided_txid'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state', 'decided_by', 'decided_at', 'decided_txid']) THEN
      RAISE EXCEPTION 'change request %: only the decision changes', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.state = 'pending' THEN
      NEW.decided_by := NULL;
      NEW.decided_at := NULL;
      NEW.decided_txid := NULL;
      RETURN NEW;
    END IF;
    NEW.decided_by := private.current_user_id();
    NEW.decided_at := now();
    NEW.decided_txid := CASE WHEN NEW.state = 'approved' THEN pg_current_xact_id() END;
    IF NEW.state = 'approved' THEN
      IF election.live_edits_need_second_approver AND NEW.decided_by = OLD.proposed_by THEN
        RAISE EXCEPTION 'change request %: this tenant needs someone other than the proposer to approve it', OLD.id
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF election.status <> 'live' THEN
        RAISE EXCEPTION 'election % is %: nothing is approved for it', OLD.election_id, election.status
          USING ERRCODE = 'restrict_violation';
      END IF;
      IF election.frozen_from <= now() AND (election.frozen_until IS NULL OR now() < election.frozen_until) THEN
        RAISE EXCEPTION 'election % is frozen: nothing public changes until the window ends', OLD.election_id
          USING ERRCODE = 'restrict_violation';
      END IF;
      IF OLD.action <> 'add' AND (target IS NULL
                                  OR OLD.action = 'update' AND target -> OLD.field IS DISTINCT FROM OLD.previous_value
                                  OR OLD.action = 'retire' AND target ->> 'retired_at' IS NOT NULL) THEN
        RAISE EXCEPTION 'change request %: its target changed after it was proposed; propose it again', OLD.id
          USING ERRCODE = 'restrict_violation';
      END IF;
      IF NOT OLD.public_note ? election.default_locale
         OR EXISTS (SELECT 1 FROM unnest(localized) c
                     WHERE CASE WHEN OLD.action = 'update' THEN c = OLD.field ELSE OLD.proposed_value ? c END
                       AND NOT coalesce((CASE WHEN OLD.action = 'update' THEN OLD.proposed_value
                                              ELSE OLD.proposed_value -> c END) ? election.default_locale, false)) THEN
        RAISE EXCEPTION 'change request %: its public note and texts need the default locale, %', OLD.id,
          election.default_locale USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END
  $_$;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
