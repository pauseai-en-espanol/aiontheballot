-- migrate:up

-- LLM assistance (spec §3.9; the feature is M4, the schema exists from M1). A member requests a run on one source;
-- the worker runs it and writes suggestions, which only ever suggest: an editor accepts or rejects each one, once, and
-- a human still writes the cell. A run is refused once the tenant's spend this month reaches its cap; a cap of 0 turns
-- LLM assistance off. The worker's access comes with the job tables.

CREATE TABLE app.llm_runs (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id           uuid NOT NULL,
  election_id         uuid NOT NULL,
  source_document_id  uuid NOT NULL,
  requested_by        uuid NOT NULL,
  model               text NOT NULL,
  prompt_version      text NOT NULL,
  status              text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  started_at          timestamptz,                        -- set when it starts running
  finished_at         timestamptz,                        -- set when it is done or failed
  input_tokens        int CHECK (input_tokens >= 0),
  output_tokens       int CHECK (output_tokens >= 0),
  cost_usd            numeric(10, 4) CHECK (cost_usd >= 0),
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now(),  -- the month a run's cost counts towards
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, election_id),
  UNIQUE (tenant_id, id, source_document_id),
  FOREIGN KEY (tenant_id, election_id, source_document_id)
    REFERENCES app.source_documents (tenant_id, election_id, id)
);
CREATE INDEX llm_runs_tenant_id_created_at_idx ON app.llm_runs (tenant_id, created_at);

CREATE TABLE app.llm_suggestions (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id         uuid NOT NULL,
  election_id       uuid NOT NULL,
  run_id            uuid NOT NULL,
  party_id          uuid NOT NULL,
  criterion_id      uuid NOT NULL,
  suggested_rating  app.rating NOT NULL,
  rationale         text NOT NULL,
  passages          jsonb NOT NULL CHECK (jsonb_typeof(passages) = 'array'),  -- [{quote, unit_index, matched}]
  state             app.suggestion_state NOT NULL DEFAULT 'open',
  decided_by        uuid,
  decided_at        timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, run_id, election_id)       REFERENCES app.llm_runs (tenant_id, id, election_id),
  FOREIGN KEY (tenant_id, election_id, party_id)     REFERENCES app.parties (tenant_id, election_id, id),
  FOREIGN KEY (tenant_id, election_id, criterion_id) REFERENCES app.criteria (tenant_id, election_id, id),
  CHECK ((state = 'open') = (decided_at IS NULL) AND (decided_at IS NULL) = (decided_by IS NULL))
);
CREATE INDEX llm_suggestions_run_id_idx ON app.llm_suggestions (run_id);

-- Rules ----------------------------------------------------------------------------------------------------------

-- A run starts queued, within the tenant's monthly cap (UTC months); it then moves queued → running → done or failed,
-- with its start and finish stamped. Only its progress changes: status, times, tokens, cost and error.
CREATE FUNCTION private.llm_run_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    progress text[] := ARRAY['status', 'started_at', 'finished_at', 'input_tokens', 'output_tokens', 'cost_usd',
                             'error'];
    cap numeric;
    spent numeric;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status <> 'queued' THEN
        RAISE EXCEPTION 'a new run is queued' USING ERRCODE = 'restrict_violation';
      END IF;
      -- Read as the writer: a tenant the writer can't see gets no run from them.
      SELECT t.llm_monthly_cap_usd INTO cap FROM app.tenants t WHERE t.id = NEW.tenant_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'tenant % is not visible to the writer', NEW.tenant_id USING ERRCODE = 'insufficient_privilege';
      END IF;
      SELECT coalesce(sum(r.cost_usd), 0) INTO spent
        FROM app.llm_runs r
       WHERE r.tenant_id = NEW.tenant_id AND r.created_at >= date_trunc('month', now(), 'UTC');
      IF coalesce(cap, 0) <= 0 OR spent >= cap THEN
        RAISE EXCEPTION 'LLM assistance is off or this month''s cap is reached for tenant %', NEW.tenant_id
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.started_at := NULL;
      NEW.finished_at := NULL;
      RETURN NEW;
    END IF;

    IF (to_jsonb(NEW) - progress) IS DISTINCT FROM (to_jsonb(OLD) - progress) THEN
      RAISE EXCEPTION 'run %: only its progress changes', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'queued' AND NEW.status = 'running'
                OR OLD.status = 'running' AND NEW.status IN ('done', 'failed')) THEN
      RAISE EXCEPTION 'run % cannot go from % to %', OLD.id, OLD.status, NEW.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    NEW.started_at := CASE WHEN OLD.status = 'queued' AND NEW.status = 'running' THEN now() ELSE OLD.started_at END;
    NEW.finished_at := CASE WHEN OLD.status = 'running' AND NEW.status IN ('done', 'failed') THEN now()
                            ELSE OLD.finished_at END;
    RETURN NEW;
  END
  $$;

-- A suggestion is open when written, with a rating of the tenant's scale; it is then accepted or rejected once, by
-- the actor, at the transaction time. Nothing else about it changes.
CREATE FUNCTION private.llm_suggestion_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    kind app.methodology_kind;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      SELECT t.methodology_kind INTO kind FROM app.tenants t WHERE t.id = NEW.tenant_id;
      IF NOT (CASE kind
                WHEN 'demands' THEN NEW.suggested_rating IN ('meets', 'partially_meets', 'does_not_meet', 'not_mentioned')
                ELSE NEW.suggested_rating IN ('green', 'yellow', 'red', 'not_mentioned')
              END) THEN
        RAISE EXCEPTION 'rating % is not on the % scale', NEW.suggested_rating, kind USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.state <> 'open' THEN
        RAISE EXCEPTION 'a new suggestion is open' USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.decided_by := NULL;
      NEW.decided_at := NULL;
      RETURN NEW;
    END IF;

    IF OLD.state <> 'open' THEN
      RAISE EXCEPTION 'suggestion % is already decided', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF (to_jsonb(NEW) - ARRAY['state', 'decided_by', 'decided_at'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state', 'decided_by', 'decided_at']) THEN
      RAISE EXCEPTION 'suggestion %: only the decision changes', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.state <> 'open' THEN
      NEW.decided_by := private.current_user_id();
      NEW.decided_at := now();
    END IF;
    RETURN NEW;
  END
  $$;

-- Triggers --------------------------------------------------------------------------------------------------------

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.llm_runs
  FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();
CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.llm_runs
  FOR EACH ROW EXECUTE FUNCTION private.llm_run_rules();
CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.llm_runs
  FOR EACH ROW EXECUTE FUNCTION private.stamp('requested_by', 'created_at');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.llm_runs
  FOR EACH ROW EXECUTE FUNCTION private.audit();

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.llm_suggestions
  FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();
CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.llm_suggestions
  FOR EACH ROW EXECUTE FUNCTION private.llm_suggestion_rules();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.llm_suggestions
  FOR EACH ROW EXECUTE FUNCTION private.audit();

-- Grants and policies ---------------------------------------------------------------------------------------------

-- Members read their tenants' runs and suggestions; editors and country admins request runs and decide suggestions.
ALTER TABLE app.llm_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.llm_suggestions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT (tenant_id, election_id, source_document_id, model, prompt_version)
  ON app.llm_runs TO aiontheballot_admin;
CREATE POLICY member_read ON app.llm_runs FOR SELECT TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
         OR (SELECT private.is_platform_admin()));
CREATE POLICY editor_insert ON app.llm_runs FOR INSERT TO aiontheballot_admin
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor'))
              OR (SELECT private.is_platform_admin()));

GRANT SELECT, UPDATE (state) ON app.llm_suggestions TO aiontheballot_admin;
CREATE POLICY member_read ON app.llm_suggestions FOR SELECT TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
         OR (SELECT private.is_platform_admin()));
CREATE POLICY editor_decide ON app.llm_suggestions FOR UPDATE TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor')) OR (SELECT private.is_platform_admin()))
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor'))
              OR (SELECT private.is_platform_admin()));

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
