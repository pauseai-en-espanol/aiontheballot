-- migrate:up

-- Change control for live elections (spec §3.7; ADR-0002 §12). Once an election is live, its public structure changes
-- only through an approved change request: the election's name and date; the methodology's demands owner, body and
-- source kinds; methodology reviewers, parties (all but the programme status) and criteria, which are also added and
-- retired that way, never deleted.
--
-- - Editors and country admins propose (target, action, field, value and a public note); the trigger checks the target
--   is in the request's tenant and election and reads its current value. Proposals are for live elections only.
-- - Reviewers and country admins decide, once: approved or rejected, stamped with who, when and (for an approval) the
--   transaction. The approver applies the change with their own rights, in the same transaction, and a public,
--   immutable structural_changes row records it. With the tenant's live_edits_need_second_approver on, the proposer
--   can't approve their own request. No approval inside the election's freeze window, none once the target has
--   changed since the proposal, and public text needs the default locale.
-- - A change-controlled write to a live election passes only if a request for exactly that target, action, field and
--   value was approved in the same transaction (decided_txid = pg_current_xact_id()). There is no session flag.
-- - The corrections log is a view over non-initial revisions and structural changes, newest first.
--
-- Proposed and recorded values can hold an external reviewer's name, so they are personal data: never audited (the
-- public record is structural_changes itself).

CREATE TABLE app.change_requests (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL,
  election_id     uuid NOT NULL,
  action          app.change_action NOT NULL,
  target_kind     text NOT NULL
    CHECK (target_kind IN ('election', 'methodology', 'methodology_reviewer', 'party', 'criterion')),
  target_id       uuid,                                -- null for 'add'; in this tenant and election (trigger)
  field           text,                                -- for 'update': the column
  previous_value  jsonb,                               -- read from the target by trigger, never from the caller
  proposed_value  jsonb,                               -- the new value ('update') or the new row's columns ('add')
  public_note     app.localized NOT NULL,              -- published with the change
  report_id       uuid,                                -- the right-of-reply report that prompted it, if any
  state           app.change_request_state NOT NULL DEFAULT 'pending',
  proposed_by     uuid NOT NULL,
  proposed_at     timestamptz NOT NULL DEFAULT now(),
  decided_by      uuid,
  decided_at      timestamptz,
  decided_txid    xid8,                                -- the approving transaction, set by trigger
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, election_id) REFERENCES app.elections (tenant_id, id),
  FOREIGN KEY (tenant_id, report_id) REFERENCES app.reports (tenant_id, id),
  CHECK ((action = 'update') = (field IS NOT NULL)),
  CHECK ((action = 'add') = (target_id IS NULL)),
  CHECK ((state = 'pending') = (decided_by IS NULL) AND (decided_by IS NULL) = (decided_at IS NULL)),
  CHECK ((state = 'approved') = (decided_txid IS NOT NULL))
);
CREATE INDEX change_requests_election_id_idx ON app.change_requests (election_id);
CREATE INDEX change_requests_report_id_idx ON app.change_requests (report_id);
CREATE INDEX change_requests_decided_txid_idx ON app.change_requests (decided_txid) WHERE decided_txid IS NOT NULL;

CREATE TABLE app.structural_changes (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id          uuid NOT NULL,
  election_id        uuid NOT NULL,
  change_request_id  uuid NOT NULL UNIQUE,
  action             app.change_action NOT NULL,
  target_kind        text NOT NULL,
  target_id          uuid NOT NULL,                    -- for 'add', the new row
  field              text,
  previous_value     jsonb,
  new_value          jsonb,
  public_note        app.localized NOT NULL,
  approved_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, election_id) REFERENCES app.elections (tenant_id, id),
  FOREIGN KEY (tenant_id, change_request_id) REFERENCES app.change_requests (tenant_id, id)
);
CREATE INDEX structural_changes_election_idx ON app.structural_changes (election_id, approved_at DESC);

COMMENT ON COLUMN app.change_requests.previous_value IS 'personal data';
COMMENT ON COLUMN app.change_requests.proposed_value IS 'personal data';
COMMENT ON COLUMN app.structural_changes.previous_value IS 'personal data';
COMMENT ON COLUMN app.structural_changes.new_value IS 'personal data';

-- Proposals and decisions. Before an insert: a proposal (target, field and value checked, values normalized, the
-- previous value read from the target). Before an update: the one decision. After an approval: the approver applies
-- the change with their own rights, and the public record is written.
CREATE FUNCTION private.change_request_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    tbl text := CASE NEW.target_kind
      WHEN 'election' THEN 'elections' WHEN 'methodology' THEN 'methodologies'
      WHEN 'methodology_reviewer' THEN 'methodology_reviewers' WHEN 'party' THEN 'parties' ELSE 'criteria' END;
    updatable text[] := CASE NEW.target_kind
      WHEN 'election' THEN ARRAY['name', 'election_date']
      WHEN 'methodology' THEN ARRAY['demands_owner_id', 'body', 'admissible_source_kinds', 'not_mentioned_source_kinds']
      WHEN 'methodology_reviewer' THEN ARRAY['name', 'affiliation', 'display_order']
      WHEN 'party' THEN ARRAY['name', 'short_name', 'logo_file_id', 'colour', 'display_order', 'website', 'territory_codes']
      ELSE ARRAY['title', 'description', 'display_order', 'core_criterion_id'] END;
    -- Elections and methodologies are never added or retired.
    addable text[] := CASE NEW.target_kind
      WHEN 'methodology_reviewer' THEN ARRAY['name', 'affiliation', 'display_order']
      WHEN 'party' THEN ARRAY['slug', 'name', 'short_name', 'logo_file_id', 'colour', 'display_order', 'website',
                              'territory_codes']
      WHEN 'criterion' THEN ARRAY['slug', 'title', 'description', 'display_order', 'core_criterion_id'] END;
    localized text[] := CASE NEW.target_kind
      WHEN 'election' THEN ARRAY['name'] WHEN 'methodology' THEN ARRAY['body'] WHEN 'party' THEN ARRAY['name', 'short_name']
      WHEN 'criterion' THEN ARRAY['title', 'description'] ELSE '{}' END;
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
  $$;

-- A change-controlled write to a live election passes only with a request approved in this transaction for exactly that
-- target, action, field and value (an addition: a request not yet recorded whose columns the new row has).
CREATE FUNCTION private.change_control() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
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
      ELSE ARRAY['title', 'description', 'display_order', 'core_criterion_id'] END;
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

CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.change_requests
  FOR EACH ROW EXECUTE FUNCTION private.change_request_rules();
CREATE TRIGGER apply AFTER UPDATE ON app.change_requests
  FOR EACH ROW EXECUTE FUNCTION private.change_request_rules();
CREATE TRIGGER stamp BEFORE INSERT ON app.change_requests
  FOR EACH ROW EXECUTE FUNCTION private.stamp('proposed_by', 'proposed_at');
CREATE TRIGGER forbid_mutation BEFORE UPDATE OR DELETE ON app.structural_changes
  FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation();
CREATE TRIGGER forbid_truncate BEFORE TRUNCATE ON app.structural_changes
  FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_mutation();
CREATE TRIGGER stamp BEFORE INSERT ON app.structural_changes
  FOR EACH ROW EXECUTE FUNCTION private.stamp('approved_at');
CREATE TRIGGER bump_public_version AFTER INSERT OR UPDATE OR DELETE ON app.structural_changes
  FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['elections', 'methodologies', 'methodology_reviewers', 'parties', 'criteria'] LOOP
    EXECUTE format('CREATE TRIGGER change_control AFTER INSERT OR UPDATE ON app.%I
                      FOR EACH ROW EXECUTE FUNCTION private.change_control()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['change_requests', 'structural_changes'] LOOP
    EXECUTE format('CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.%I
                      FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change()', t);
    EXECUTE format('CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.%I
                      FOR EACH ROW EXECUTE FUNCTION private.audit()', t);
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY member_read ON app.%I FOR SELECT TO aiontheballot_admin
                        USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
                               OR (SELECT private.is_platform_admin()))$p$, t);
  END LOOP;
END
$$;

-- The corrections log: every revision after a cell's first, and every structural change, newest first. Public through
-- the public tables it reads.
CREATE VIEW app.corrections_log WITH (security_invoker = true) AS
  SELECT r.tenant_id, r.election_id, r.id AS entry_id, 'revision' AS entry_kind, r.published_at AS at,
         r.change_kind::text AS change, r.assessment_id, NULL::text AS target_kind, NULL::uuid AS target_id,
         NULL::text AS field, NULL::jsonb AS previous_value, NULL::jsonb AS new_value, r.public_note
    FROM app.assessment_revisions r
   WHERE r.change_kind <> 'initial'
  UNION ALL
  SELECT s.tenant_id, s.election_id, s.id, 'structural_change', s.approved_at, s.action::text, NULL, s.target_kind,
         s.target_id, s.field, s.previous_value, s.new_value, s.public_note
    FROM app.structural_changes s
  ORDER BY at DESC;

-- Grants and policies ---------------------------------------------------------------------------------------------

-- Requests: editors and country admins propose, and withdraw pending ones; reviewers and country admins decide.
GRANT SELECT, DELETE,
      INSERT (tenant_id, election_id, action, target_kind, target_id, field, proposed_value, public_note, report_id),
      UPDATE (state)
  ON app.change_requests TO aiontheballot_admin;
CREATE POLICY proposer_insert ON app.change_requests FOR INSERT TO aiontheballot_admin
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor')) OR (SELECT private.is_platform_admin()));
CREATE POLICY decider_update ON app.change_requests FOR UPDATE TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'reviewer')) OR (SELECT private.is_platform_admin()))
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin', 'reviewer'))
              OR (SELECT private.is_platform_admin()));
CREATE POLICY proposer_delete ON app.change_requests FOR DELETE TO aiontheballot_admin
  USING ((tenant_id IN (SELECT private.my_tenants('country_admin', 'editor')) OR (SELECT private.is_platform_admin()))
         AND state = 'pending');

-- Structural changes: public in live and archived elections; written only by the approval trigger, as the approver
-- (the policy admits an insert only at trigger depth > 0).
GRANT SELECT ON app.structural_changes, app.corrections_log TO aiontheballot_web, aiontheballot_admin;
GRANT INSERT (tenant_id, election_id, change_request_id, action, target_kind, target_id, field, previous_value,
              new_value, public_note)
  ON app.structural_changes TO aiontheballot_admin;
CREATE POLICY public_read ON app.structural_changes FOR SELECT TO aiontheballot_web
  USING (EXISTS (SELECT 1 FROM app.elections e
                  WHERE e.id = structural_changes.election_id AND e.status IN ('live', 'archived')));
CREATE POLICY approval_insert ON app.structural_changes FOR INSERT TO aiontheballot_admin
  WITH CHECK ((tenant_id IN (SELECT private.my_tenants('country_admin', 'reviewer'))
               OR (SELECT private.is_platform_admin()))
              AND pg_trigger_depth() > 0);

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
