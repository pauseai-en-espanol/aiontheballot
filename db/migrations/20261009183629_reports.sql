-- migrate:up

-- Right of reply (spec §3.8): reports from the public, with personal data, private to the tenant's members.
--
-- - The only way in is app.submit_report(), which only aiontheballot_web may execute (ADR-0002 §7): the tenant must be
--   active, the election (if any) public and the tenant's, the cell (if any) the election's; a per-tenant cap per UTC
--   day backs up the gateway's per-IP rate limit.
-- - Editors, reviewers and country admins read and triage their tenant's reports: new → triaged → accepted, rejected
--   or spam, once each, with triaged_by and triaged_at set at triage. Only the status and the resolution note change.
--   Platform admins never read reports (PLAN P11). Reports stay triageable once their election is archived.
-- - Reports are never deleted (corrections cite them), only anonymized: every personal-data column set to null at once,
--   with anonymized_at, by a country admin (an erasure request) or by the worker's daily
--   private.anonymize_expired_reports() at anonymize_after.

CREATE TABLE app.reports (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id                uuid NOT NULL REFERENCES app.tenants,
  election_id              uuid,
  assessment_id            uuid,
  kind                     app.report_kind NOT NULL,
  name                     text CHECK (char_length(name) BETWEEN 1 AND 200),
  email                    text CHECK (email = lower(email) AND char_length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+$'),
  organization             text CHECK (char_length(organization) BETWEEN 1 AND 200),
  is_party_representative  boolean NOT NULL DEFAULT false,
  message                  text CHECK (char_length(btrim(message)) BETWEEN 1 AND 5000),
  status                   app.report_status NOT NULL DEFAULT 'new',
  created_at               timestamptz NOT NULL DEFAULT now(),
  triaged_by               uuid,
  triaged_at               timestamptz,
  resolution_note          text CHECK (char_length(resolution_note) <= 5000),
  anonymize_after          date NOT NULL,                      -- the day it was sent (UTC) + report_retention_days
  anonymized_at            timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, election_id) REFERENCES app.elections (tenant_id, id),
  FOREIGN KEY (tenant_id, assessment_id, election_id) REFERENCES app.assessments (tenant_id, id, election_id),
  CHECK (assessment_id IS NULL OR election_id IS NOT NULL),
  CHECK (message IS NOT NULL OR anonymized_at IS NOT NULL),
  CHECK (anonymized_at IS NULL
         OR (name IS NULL AND email IS NULL AND organization IS NULL AND message IS NULL AND resolution_note IS NULL)),
  CHECK ((triaged_at IS NULL) = (status = 'new'))
);
CREATE INDEX reports_election_id_idx ON app.reports (election_id);
CREATE INDEX reports_assessment_id_idx ON app.reports (assessment_id);
CREATE INDEX reports_anonymize_after_idx ON app.reports (anonymize_after) WHERE anonymized_at IS NULL;

COMMENT ON COLUMN app.reports.name IS 'personal data';
COMMENT ON COLUMN app.reports.email IS 'personal data';
COMMENT ON COLUMN app.reports.organization IS 'personal data';
COMMENT ON COLUMN app.reports.message IS 'personal data';
COMMENT ON COLUMN app.reports.resolution_note IS 'personal data';

-- The per-tenant daily cap's counter, written only by app.submit_report().
CREATE TABLE app.report_daily_counts (
  tenant_id  uuid NOT NULL REFERENCES app.tenants,
  day        date NOT NULL,
  count      int NOT NULL CHECK (count > 0),
  PRIMARY KEY (tenant_id, day)
);

CREATE FUNCTION private.report_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    personal text[] := ARRAY['name', 'email', 'organization', 'message', 'resolution_note'];
    triage text[] := ARRAY['status', 'resolution_note', 'triaged_by', 'triaged_at'];
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status <> 'new' OR NEW.anonymized_at IS NOT NULL THEN
        RAISE EXCEPTION 'a new report is new and not anonymized' USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.triaged_by := NULL;
      NEW.triaged_at := NULL;
      RETURN NEW;
    END IF;

    -- Anonymizing: every personal-data column set to null at once, nothing else; by a country admin or the daily run
    -- (which runs as the table owner).
    IF OLD.anonymized_at IS NULL AND NEW.anonymized_at IS NOT NULL THEN
      IF (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID)
           <> (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = current_user)
         AND NEW.tenant_id NOT IN (SELECT private.my_tenants('country_admin')) THEN
        RAISE EXCEPTION 'anonymizing report % needs a country admin', OLD.id USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF (to_jsonb(NEW) - personal - 'anonymized_at') IS DISTINCT FROM (to_jsonb(OLD) - personal - 'anonymized_at')
         OR EXISTS (SELECT 1 FROM jsonb_each(to_jsonb(NEW)) n WHERE n.key = ANY (personal) AND n.value <> 'null') THEN
        RAISE EXCEPTION 'anonymizing report % sets every personal-data column to null and changes nothing else', OLD.id
          USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.anonymized_at := now();
      RETURN NEW;
    END IF;

    -- Triage: only the status, forward, and the resolution note (so anonymized_at is set once, for good).
    IF (to_jsonb(NEW) - triage) IS DISTINCT FROM (to_jsonb(OLD) - triage) THEN
      RAISE EXCEPTION 'report %: only its status and resolution note change', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.anonymized_at IS NOT NULL AND NEW.resolution_note IS NOT NULL THEN
      RAISE EXCEPTION 'report % is anonymized: it takes no personal data again', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'new' AND NEW.status = 'triaged'
                OR OLD.status = 'triaged' AND NEW.status IN ('accepted', 'rejected', 'spam')) THEN
      RAISE EXCEPTION 'report % cannot go from % to %', OLD.id, OLD.status, NEW.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'new' AND NEW.status = 'triaged' THEN
      NEW.triaged_by := private.current_user_id();
      NEW.triaged_at := now();
    ELSE
      NEW.triaged_by := OLD.triaged_by;
      NEW.triaged_at := OLD.triaged_at;
    END IF;
    RETURN NEW;
  END
  $$;

-- The public's only write (ADR-0002 §7). Returns the new report's id.
CREATE FUNCTION app.submit_report(tenant uuid, kind app.report_kind, message text, election uuid DEFAULT NULL,
                                  assessment uuid DEFAULT NULL, name text DEFAULT NULL, email text DEFAULT NULL,
                                  organization text DEFAULT NULL, is_party_representative boolean DEFAULT false)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $$
  DECLARE
    daily_cap constant int := 200;  -- per tenant and UTC day; far above normal use (spec §3.8)
    today date := (now() AT TIME ZONE 'UTC')::date;
    retention int;
    sent int;
    report uuid;
  BEGIN
    SELECT t.report_retention_days INTO retention FROM app.tenants t WHERE t.id = tenant AND t.active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no such tenant' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF election IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM app.elections e
                        WHERE e.id = election AND e.tenant_id = tenant AND e.status IN ('live', 'archived')) THEN
      RAISE EXCEPTION 'no such election' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF assessment IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM app.assessments a WHERE a.id = assessment AND a.election_id = election) THEN
      RAISE EXCEPTION 'no such cell' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    INSERT INTO app.report_daily_counts AS c (tenant_id, day, count) VALUES (tenant, today, 1)
      ON CONFLICT ON CONSTRAINT report_daily_counts_pkey DO UPDATE SET count = c.count + 1
      RETURNING c.count INTO sent;
    IF sent > daily_cap THEN
      RAISE EXCEPTION 'this site takes no more reports today' USING ERRCODE = 'program_limit_exceeded';
    END IF;

    INSERT INTO app.reports (tenant_id, election_id, assessment_id, kind, name, email, organization,
                             is_party_representative, message, anonymize_after)
    VALUES (tenant, election, assessment, kind, nullif(btrim(name), ''), lower(nullif(btrim(email), '')),
            nullif(btrim(organization), ''), coalesce(is_party_representative, false), message, today + retention)
    RETURNING id INTO report;
    RETURN report;
  END
  $$;

-- The daily run (spec §3.8): anonymizes every report past its anonymize_after. Returns how many.
CREATE FUNCTION private.anonymize_expired_reports() RETURNS integer
  LANGUAGE sql SECURITY DEFINER
  SET search_path = ''
  AS $$
    WITH anonymized AS (
      UPDATE app.reports r
         SET name = NULL, email = NULL, organization = NULL, message = NULL, resolution_note = NULL,
             anonymized_at = now()
       WHERE r.anonymized_at IS NULL AND r.anonymize_after <= (now() AT TIME ZONE 'UTC')::date
      RETURNING 1
    )
    SELECT count(*)::integer FROM anonymized
  $$;

GRANT EXECUTE ON FUNCTION app.submit_report(uuid, app.report_kind, text, uuid, uuid, text, text, text, boolean)
  TO aiontheballot_web;
GRANT EXECUTE ON FUNCTION private.anonymize_expired_reports() TO aiontheballot_worker;

CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.reports
  FOR EACH ROW EXECUTE FUNCTION private.report_rules();
CREATE TRIGGER stamp BEFORE INSERT ON app.reports
  FOR EACH ROW EXECUTE FUNCTION private.stamp('created_at');

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['reports', 'report_daily_counts'] LOOP
    EXECUTE format('CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.%I
                      FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change()', t);
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;
-- Audited by id and status: the audit trigger never copies personal-data columns. The counter isn't audited.
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.reports
  FOR EACH ROW EXECUTE FUNCTION private.audit();

-- Members read and triage their tenant's reports; platform admins never do. The counter has no policy at all.
GRANT SELECT, UPDATE (status, resolution_note, name, email, organization, message, anonymized_at)
  ON app.reports TO aiontheballot_admin;
CREATE POLICY member_read ON app.reports FOR SELECT TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer')));
CREATE POLICY member_update ON app.reports FOR UPDATE TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer')))
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer')));

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
