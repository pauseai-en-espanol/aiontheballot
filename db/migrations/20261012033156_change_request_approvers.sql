-- migrate:up

-- Approving a change request (editorial workflow CR1; PLAN R144), two rules the API kept but the database didn't:
-- - Only country admins and platform admins approve (CR1.4). Reviewers decide too, to reject; an approval applies the
--   change with the approver's own rights (R24), so a user who is both an editor (who may write parties, criteria and
--   the election) and a reviewer (who may decide) could approve alone. Now refused, whatever else they hold.
-- - The target is locked while it is approved, so two approvals of one target at once run one after the other and
--   the second is checked against the first's value: it is refused as stale instead of overwriting it with a public
--   "before" value that was no longer true (R25). The approver may write the target (R24), so may lock it. The lock
--   is FOR NO KEY UPDATE, the one the approved write takes anyway: unlike FOR UPDATE, it lets rows that point at the
--   target be added meanwhile (their foreign keys take KEY SHARE), so it neither holds up other writes nor deadlocks
--   with a request proposed at the same time.
-- Everything else is change_request_rules as before (migration criteria_short_title).

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
      -- Country admins and platform admins approve (CR1.4), whatever else the approver may write: an editor who is
      -- also a reviewer can decide (as a reviewer) and write parties (as an editor), but approves nothing.
      IF NOT (NEW.tenant_id IN (SELECT private.my_tenants(VARIADIC ARRAY['country_admin']::app.tenant_role[]))
              OR private.is_platform_admin()) THEN
        RAISE EXCEPTION 'change request %: only country admins and platform admins approve', OLD.id
          USING ERRCODE = 'insufficient_privilege';
      END IF;
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
      -- The target again, locked: two approvals of one target run one after the other, and the second reads the
      -- first's value, so its previous value is checked against what is really there (R25). NO KEY, as the write.
      IF OLD.action <> 'add' THEN
        EXECUTE find_target || ' FOR NO KEY UPDATE OF x' INTO target USING OLD.target_id, OLD.election_id;
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
