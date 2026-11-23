-- migrate:up

-- Taking an entry made by mistake out of the public corrections log (PLAN R248). A change to a live election's structure
-- is recorded for good (`structural_changes`, immutable), and the public log lists it: so a slip put right a minute
-- later stayed in the log, and its text in what the public site's role can read.
--
-- - A row of `log_removals` takes one structural change out of the log. The change stays as it was recorded: members
--   read it, the public (and the preview) no longer do, values included.
-- - A country admin of its site or a platform admin removes it, and may put it back (the row is deleted), never through
--   a member's token (ADR-0008). Who and when are the audit log's: the public can read this table, so it holds neither.
-- - Only an update, and only once every field it changed was changed again by a later update of the same target. So the
--   last change of a field is never taken out, and the log always holds the change in force.
-- - Nothing inside the election's freeze window: neither a removal nor its undoing.

CREATE TABLE app.log_removals (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id             uuid NOT NULL REFERENCES app.tenants,
  election_id           uuid NOT NULL,
  structural_change_id  uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, structural_change_id),
  FOREIGN KEY (tenant_id, election_id) REFERENCES app.elections (tenant_id, id),
  FOREIGN KEY (tenant_id, structural_change_id) REFERENCES app.structural_changes (tenant_id, id)
);
CREATE INDEX log_removals_election_idx ON app.log_removals (election_id);

CREATE FUNCTION private.log_removal_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    subject app.log_removals := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    change app.structural_changes;
    election record;
    changed text[];
    replaced text[];
  BEGIN
    -- A purge deletes as the owner, whatever the window (the admin role may not call private.purging, so it is asked
    -- in a statement of its own, reached only as the owner).
    IF TG_OP = 'DELETE' THEN
      IF (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID)
         = (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
        IF private.purging(TG_RELID) THEN
          RETURN OLD;
        END IF;
      END IF;
    END IF;
    SELECT * INTO change FROM app.structural_changes s
     WHERE s.id = subject.structural_change_id AND s.tenant_id = subject.tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no structural change % of tenant % that the writer may see', subject.structural_change_id,
        subject.tenant_id USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT e.frozen_from, e.frozen_until INTO election FROM app.elections e WHERE e.id = change.election_id;
    IF election.frozen_from <= now() AND (election.frozen_until IS NULL OR now() < election.frozen_until) THEN
      RAISE EXCEPTION 'election % is frozen: nothing public changes until the window ends', change.election_id
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;

    IF change.action <> 'update' THEN
      RAISE EXCEPTION 'only an update is taken out of the corrections log, not % %', change.action, change.id
        USING ERRCODE = 'check_violation';
    END IF;
    -- Every field changed again by a later update of the same target.
    changed := CASE WHEN change.field IS NOT NULL THEN ARRAY[change.field]
                    ELSE ARRAY(SELECT jsonb_object_keys(change.new_value)) END;
    SELECT coalesce(array_agg(DISTINCT f), '{}') INTO replaced
      FROM app.structural_changes s
     CROSS JOIN LATERAL unnest(CASE WHEN s.field IS NOT NULL THEN ARRAY[s.field]
                                    WHEN jsonb_typeof(s.new_value) = 'object'
                                      THEN ARRAY(SELECT jsonb_object_keys(s.new_value)) END) f
     WHERE s.election_id = change.election_id AND s.target_kind = change.target_kind
       AND s.target_id = change.target_id AND s.action = 'update'
       AND (s.approved_at, s.id) > (change.approved_at, change.id);
    -- A set's fields, or its one field (PLAN R183).
    IF NOT changed <@ replaced THEN
      RAISE EXCEPTION 'structural change % is in force: the corrections log keeps it until a later one replaces it',
        change.id USING ERRCODE = 'check_violation';
    END IF;
    NEW.election_id := change.election_id;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.log_removals
  FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();
CREATE TRIGGER needs_a_person BEFORE INSERT OR UPDATE OR DELETE ON app.log_removals
  FOR EACH ROW EXECUTE FUNCTION private.needs_a_person('change log_removals');
CREATE TRIGGER rules BEFORE INSERT OR DELETE ON app.log_removals
  FOR EACH ROW EXECUTE FUNCTION private.log_removal_rules();
CREATE TRIGGER stamp BEFORE INSERT ON app.log_removals
  FOR EACH ROW EXECUTE FUNCTION private.stamp('created_at');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.log_removals
  FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER bump_public_version AFTER INSERT OR UPDATE OR DELETE ON app.log_removals
  FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();
ALTER TABLE app.log_removals ENABLE ROW LEVEL SECURITY;

-- Made and undone by the site's country admins and platform admins; every member reads them; the public and the preview
-- read which changes they take out (nothing else is in them), which their own read of the changes below needs.
GRANT SELECT ON app.log_removals TO aiontheballot_web, aiontheballot_admin, aiontheballot_preview;
GRANT INSERT (tenant_id, structural_change_id), DELETE ON app.log_removals TO aiontheballot_admin;
CREATE POLICY member_read ON app.log_removals FOR SELECT TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
         OR (SELECT private.is_platform_admin()));
CREATE POLICY admin_insert ON app.log_removals FOR INSERT TO aiontheballot_admin
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()));
CREATE POLICY admin_delete ON app.log_removals FOR DELETE TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()));
CREATE POLICY public_read ON app.log_removals FOR SELECT TO aiontheballot_web
  USING (EXISTS (SELECT 1 FROM app.elections e
                  WHERE e.id = log_removals.election_id AND e.status IN ('live', 'archived')));
CREATE POLICY preview_read ON app.log_removals FOR SELECT TO aiontheballot_preview
  USING (EXISTS (SELECT 1 FROM app.elections e
                  WHERE e.id = log_removals.election_id AND e.status IN ('preview', 'live', 'archived')));

-- The public record of a change, unless it was taken out of the log.
ALTER POLICY public_read ON app.structural_changes
  USING (EXISTS (SELECT 1 FROM app.elections e
                  WHERE e.id = structural_changes.election_id AND e.status IN ('live', 'archived'))
         AND NOT EXISTS (SELECT 1 FROM app.log_removals x
                          WHERE x.tenant_id = structural_changes.tenant_id
                            AND x.structural_change_id = structural_changes.id));
ALTER POLICY preview_read ON app.structural_changes
  USING (EXISTS (SELECT 1 FROM app.elections e
                  WHERE e.id = structural_changes.election_id AND e.status IN ('preview', 'live', 'archived'))
         AND NOT EXISTS (SELECT 1 FROM app.log_removals x
                          WHERE x.tenant_id = structural_changes.tenant_id
                            AND x.structural_change_id = structural_changes.id));

-- corrections_log as before (migration unlogged_changes), without the changes taken out of it, for every reader.
CREATE OR REPLACE VIEW app.corrections_log WITH (security_invoker='true') AS
 SELECT r.tenant_id,
    r.election_id,
    r.id AS entry_id,
    'revision'::text AS entry_kind,
    r.published_at AS at,
    (r.change_kind)::text AS change,
    r.assessment_id,
    NULL::text AS target_kind,
    NULL::uuid AS target_id,
    NULL::text AS field,
    NULL::jsonb AS previous_value,
    NULL::jsonb AS new_value,
    r.public_note
   FROM app.assessment_revisions r
  WHERE ((r.change_kind <> 'initial'::app.change_kind) AND (NOT r.published_in_preview) AND (NOT r.unlogged) AND (NOT (EXISTS ( SELECT 1
           FROM app.assessment_revisions p
          WHERE ((p.assessment_id = r.assessment_id) AND (p.revision_no = (r.revision_no - 1)) AND p.published_in_preview AND (p.change_kind = 'withdrawal'::app.change_kind))))))
UNION ALL
 SELECT s.tenant_id,
    s.election_id,
    s.id AS entry_id,
    'structural_change'::text AS entry_kind,
    s.approved_at AS at,
    (s.action)::text AS change,
    NULL::uuid AS assessment_id,
    s.target_kind,
    s.target_id,
    s.field,
    s.previous_value,
    s.new_value,
    s.public_note
   FROM app.structural_changes s
  WHERE (NOT (EXISTS ( SELECT 1
           FROM app.log_removals x
          WHERE ((x.tenant_id = s.tenant_id) AND (x.structural_change_id = s.id)))))
  ORDER BY 5 DESC;

-- The purges as before, with the removals, before the changes they name.
CREATE OR REPLACE FUNCTION private.purge_election(tenant uuid, election uuid, confirmation text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  DECLARE
    -- Children before parents, as private.purge_tenant, each with what picks the election's rows ($1 its tenant, $2
    -- the election). Cells take their drafts and contributors with them: counted, not deleted on their own.
    scopes text[] := ARRAY[
      'revision_internal',
      'r.revision_id IN (SELECT x.id FROM app.assessment_revisions x WHERE x.tenant_id = $1 AND x.election_id = $2)
       OR r.report_id IN (SELECT x.id FROM app.reports x WHERE x.tenant_id = $1 AND x.election_id = $2)',
      'revision_evidence', 'r.election_id = $2',
      'revision_checked_documents', 'r.election_id = $2',
      'log_removals', 'r.election_id = $2',
      'structural_changes', 'r.election_id = $2',
      'change_requests', 'r.election_id = $2',
      'assessment_revisions', 'r.election_id = $2',
      'review_events',
      'r.assessment_id IN (SELECT x.id FROM app.assessments x WHERE x.tenant_id = $1 AND x.election_id = $2)',
      'reports', 'r.election_id = $2',
      'assessment_contributors',
      'r.assessment_id IN (SELECT x.id FROM app.assessments x WHERE x.tenant_id = $1 AND x.election_id = $2)',
      'draft_checked_documents', 'r.election_id = $2',
      'draft_evidence', 'r.election_id = $2',
      'assessments', 'r.election_id = $2',
      'job_requests',
      'r.source_document_id IN (SELECT x.id FROM app.source_documents x WHERE x.tenant_id = $1 AND x.election_id = $2)',
      'llm_suggestions', 'r.election_id = $2',
      'llm_runs', 'r.election_id = $2',
      'source_texts',
      'r.source_document_id IN (SELECT x.id FROM app.source_documents x WHERE x.tenant_id = $1 AND x.election_id = $2)',
      'source_documents', 'r.election_id = $2',
      'methodology_reviewers',
      'r.methodology_id IN (SELECT x.id FROM app.methodologies x WHERE x.tenant_id = $1 AND x.election_id = $2)',
      'methodologies', 'r.election_id = $2',
      'criteria', 'r.election_id = $2',
      'parties', 'r.election_id = $2',
      'share_counts', 'r.election_id = $2',
      'elections', 'r.id = $2'];
    election_slug text;
    i int;
    t text;
    n bigint;
    key_columns text[];
    row_ids jsonb;
    -- For a table whose rows name only a parent: which column, and the parent's table.
    link jsonb;
    -- Per table, the audit's ids of the rows that go (private.audit names a row by its primary key).
    audited jsonb := '{}';
    counts jsonb := '{}';
    files uuid[];
    remaining text;
    logged bigint;
  BEGIN
    IF nullif(current_setting('app.token_id', true), '') IS NOT NULL OR NOT private.is_platform_admin() THEN
      RAISE EXCEPTION 'purging an election needs a platform admin, in person and with a second factor'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT e.slug INTO election_slug FROM app.elections e WHERE e.tenant_id = tenant AND e.id = election FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no election % in tenant %', election, tenant USING ERRCODE = 'no_data_found';
    END IF;
    IF confirmation IS DISTINCT FROM election_slug THEN
      RAISE EXCEPTION 'purging election % needs its short name typed as confirmation', election
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- What goes, before anything does: counts, and the audit's ids of those rows.
    FOR i IN 1 .. array_length(scopes, 1) / 2 LOOP
      t := scopes[2 * i - 1];
      SELECT array_agg(a.attname::text ORDER BY k.ord) INTO key_columns
        FROM pg_catalog.pg_index x
       CROSS JOIN LATERAL unnest(x.indkey::int2[]) WITH ORDINALITY k(attnum, ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum
       WHERE x.indrelid = format('app.%I', t)::regclass AND x.indisprimary;
      EXECUTE format(
        'SELECT count(*), coalesce(jsonb_agg(CASE WHEN cardinality($3) = 1 THEN to_jsonb(r) ->> $3[1]
                ELSE (SELECT jsonb_object_agg(c, to_jsonb(r) -> c) FROM unnest($3) c)::text END), ''[]'')
           FROM app.%I r WHERE r.tenant_id = $1 AND (%s)', t, scopes[2 * i])
        INTO n, row_ids USING tenant, election, key_columns;
      counts := counts || jsonb_build_object(t, n);
      audited := audited || jsonb_build_object(t, row_ids);
    END LOOP;

    -- Its audit trail is also that of its rows deleted before (a draft party, a replaced source): found in the audit
    -- itself, by the election their entries name, or by the parent they name for the tables that name only a parent.
    -- Parents first, so a child finds its deleted parents too.
    FOR i IN REVERSE array_length(scopes, 1) / 2 .. 1 LOOP
      t := scopes[2 * i - 1];
      link := CASE t
        WHEN 'elections' THEN '{}'
        WHEN 'review_events' THEN '{"assessment_id": "assessments"}'
        WHEN 'assessment_contributors' THEN '{"assessment_id": "assessments"}'
        WHEN 'job_requests' THEN '{"source_document_id": "source_documents"}'
        WHEN 'source_texts' THEN '{"source_document_id": "source_documents"}'
        WHEN 'methodology_reviewers' THEN '{"methodology_id": "methodologies"}'
        WHEN 'revision_internal' THEN '{"revision_id": "assessment_revisions", "report_id": "reports"}'
        ELSE '{"election_id": "elections"}'
      END::jsonb;
      SELECT coalesce(jsonb_agg(DISTINCT x.id), '[]') INTO row_ids
        FROM (SELECT jsonb_array_elements_text(audited -> t) AS id
              UNION
              SELECT a.row_id FROM app.audit_log a CROSS JOIN LATERAL jsonb_each_text(link) l(col, parent)
               WHERE a.tenant_id = tenant AND a.table_name = t
                 AND (a.diff -> 'new' ->> l.col IN (SELECT jsonb_array_elements_text(audited -> l.parent))
                      OR a.diff -> 'old' ->> l.col IN (SELECT jsonb_array_elements_text(audited -> l.parent)))) x;
      audited := audited || jsonb_build_object(t, row_ids);
    END LOOP;

    -- The files it names, a pending logo change of its own included (jsonb, so no foreign key says so), that nothing
    -- else will: another election's party or source, a brand selection, or another election's pending change keeps
    -- one.
    SELECT coalesce(array_agg(DISTINCT f.id), '{}') INTO files
      FROM app.files f
     WHERE f.tenant_id = tenant
       AND f.id::text IN (SELECT p.logo_file_id::text FROM app.parties p
                           WHERE p.tenant_id = tenant AND p.election_id = election
                          UNION ALL
                          SELECT s.file_id::text FROM app.source_documents s
                           WHERE s.tenant_id = tenant AND s.election_id = election
                          UNION ALL
                          SELECT d.attestation_file_id::text FROM app.draft_evidence d
                           WHERE d.tenant_id = tenant AND d.election_id = election
                          UNION ALL
                          SELECT coalesce(c.proposed_value ->> 'logo_file_id',
                                          CASE WHEN jsonb_typeof(c.proposed_value) = 'string'
                                               THEN c.proposed_value #>> '{}' END)
                            FROM app.change_requests c WHERE c.tenant_id = tenant AND c.election_id = election)
       AND NOT EXISTS (SELECT 1 FROM app.parties p WHERE p.logo_file_id = f.id AND p.election_id <> election)
       AND NOT EXISTS (SELECT 1 FROM app.source_documents s WHERE s.file_id = f.id AND s.election_id <> election)
       AND NOT EXISTS (SELECT 1 FROM app.draft_evidence d WHERE d.attestation_file_id = f.id
                                                              AND d.election_id <> election)
       AND NOT EXISTS (SELECT 1 FROM app.tenant_brand_selections b WHERE b.file_id = f.id)
       AND NOT EXISTS (SELECT 1 FROM app.change_requests c
                        WHERE c.election_id <> election AND c.state = 'pending'
                          AND (c.proposed_value = to_jsonb(f.id::text) OR c.proposed_value ->> 'logo_file_id' = f.id::text));
    counts := counts || jsonb_build_object('files', cardinality(files));

    -- The record, first: its transaction's id is what lets the owner's rights past the immutable tables below.
    INSERT INTO app.purge_log (purged_tenant_id, purged_tenant_slug, purged_by, counts, leftovers,
                               purged_election_id, purged_election_slug, purge_xact)
    SELECT tenant, s.slug, private.current_user_id()::text, counts, '{}', election, election_slug,
           pg_catalog.pg_current_xact_id()
      FROM app.tenants s WHERE s.id = tenant
    RETURNING id INTO logged;
    PERFORM set_config('app.purge_election', election::text, true);
    -- Reports and cells name each other (a report its cell, a draft the report it answers): the draft's link is
    -- checked at commit, when both are gone.
    SET CONSTRAINTS app.assessments_draft_report_fkey DEFERRED;

    FOR i IN 1 .. array_length(scopes, 1) / 2 LOOP
      t := scopes[2 * i - 1];
      IF t NOT IN ('assessment_contributors', 'draft_checked_documents', 'draft_evidence') THEN
        EXECUTE format('DELETE FROM app.%I r WHERE r.tenant_id = $1 AND (%s)', t, scopes[2 * i]) USING tenant, election;
      END IF;
      DELETE FROM app.audit_log a
       WHERE a.tenant_id = tenant AND a.table_name = t
         AND a.row_id IN (SELECT jsonb_array_elements_text(audited -> t));
    END LOOP;
    DELETE FROM app.files f WHERE f.tenant_id = tenant AND f.id = ANY (files);
    DELETE FROM app.audit_log a
     WHERE a.tenant_id = tenant AND a.table_name = 'files' AND a.row_id IN (SELECT unnest(files)::text);

    -- No table with an election_id may still hold a row of it, including any this function doesn't list yet.
    FOR t IN SELECT c.relname FROM pg_catalog.pg_attribute a
               JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
               JOIN pg_catalog.pg_namespace s ON s.oid = c.relnamespace
              WHERE s.nspname = 'app' AND c.relkind IN ('r', 'p') AND a.attname = 'election_id' AND NOT a.attisdropped LOOP
      EXECUTE format('SELECT count(*) FROM app.%I WHERE tenant_id = $1 AND election_id = $2', t)
        INTO n USING tenant, election;
      IF n > 0 THEN
        remaining := concat_ws(', ', remaining, t);
      END IF;
    END LOOP;
    IF remaining IS NOT NULL THEN
      RAISE EXCEPTION 'purging election % left rows in %', election, remaining USING ERRCODE = 'object_in_use';
    END IF;

    -- Done: the record finished (its own exemption lets this through, the last change it allows) and the flag cleared.
    UPDATE app.purge_log SET finished_at = clock_timestamp() WHERE id = logged;
    PERFORM set_config('app.purge_election', '', true);
    RETURN logged;
  END
  $_$;

CREATE OR REPLACE FUNCTION private.purge_tenant(tenant uuid) RETURNS bigint
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
  DECLARE
    -- Children before parents. Cells take their drafts and contributors with them.
    tables text[] := ARRAY[
      'revision_internal', 'revision_evidence', 'revision_checked_documents', 'log_removals', 'structural_changes',
      'change_requests',
      'assessment_revisions', 'review_events', 'reports', 'report_daily_counts', 'signups', 'signup_daily_counts',
      'share_counts', 'assessment_contributors',
      'draft_checked_documents', 'draft_evidence', 'assessments', 'job_requests', 'llm_suggestions', 'llm_runs',
      'source_texts', 'source_documents', 'methodology_reviewers', 'methodologies', 'criteria', 'parties', 'elections',
      'tenant_brand_selections', 'files', 'tenant_documents', 'invitations', 'memberships',
      'brand_asset_grants', 'tenant_organizations', 'public_versions', 'tenant_hostnames', 'audit_log'];
    tenant_slug text;
    leftovers jsonb;
    counts jsonb := '{}';
    t text;
    n bigint;
    remaining text;
    logged bigint;
  BEGIN
    PERFORM set_config('app.purge', 'on', true);
    -- Reports and cells name each other (a report its cell, a draft the report it answers): the draft's link is
    -- checked at commit, when both are gone.
    SET CONSTRAINTS app.assessments_draft_report_fkey DEFERRED;
    SELECT t.slug INTO tenant_slug FROM app.tenants t WHERE t.id = tenant FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no tenant %', tenant USING ERRCODE = 'no_data_found';
    END IF;

    leftovers := jsonb_build_object(
      'organizations', (SELECT coalesce(jsonb_agg(o.organization_id ORDER BY o.organization_id), '[]')
                          FROM app.tenant_organizations o
                         WHERE o.tenant_id = tenant
                           AND NOT EXISTS (SELECT 1 FROM app.tenant_organizations x
                                            WHERE x.organization_id = o.organization_id AND x.tenant_id <> tenant)),
      'users', (SELECT coalesce(jsonb_agg(DISTINCT m.user_id), '[]')
                  FROM app.memberships m
                 WHERE m.tenant_id = tenant
                   AND NOT EXISTS (SELECT 1 FROM app.memberships x WHERE x.user_id = m.user_id AND x.tenant_id <> tenant)));

    -- Its hostnames are printed on share images: they can never be claimed again.
    INSERT INTO app.hostname_tombstones (hostname)
    SELECT h.hostname FROM app.tenant_hostnames h WHERE h.tenant_id = tenant
    ON CONFLICT DO NOTHING;
    DELETE FROM app.hostname_verifications v
     WHERE v.hostname IN (SELECT h.hostname FROM app.tenant_hostnames h WHERE h.tenant_id = tenant);

    FOREACH t IN ARRAY tables LOOP
      -- Counted first: some rows go with their parents (drafts and contributors with their cells).
      EXECUTE format('SELECT count(*) FROM app.%I WHERE tenant_id = $1', t) INTO n USING tenant;
      IF t NOT IN ('assessment_contributors', 'draft_checked_documents', 'draft_evidence') THEN
        EXECUTE format('DELETE FROM app.%I WHERE tenant_id = $1', t) USING tenant;
      END IF;
      counts := counts || jsonb_build_object(t, n);
    END LOOP;

    -- Every table with a tenant_id must now be empty of it, including any this function doesn't list yet.
    FOR t IN SELECT c.relname FROM pg_catalog.pg_attribute a
               JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
               JOIN pg_catalog.pg_namespace s ON s.oid = c.relnamespace
              WHERE s.nspname = 'app' AND c.relkind IN ('r', 'p') AND a.attname = 'tenant_id' AND NOT a.attisdropped LOOP
      EXECUTE format('SELECT count(*) FROM app.%I WHERE tenant_id = $1', t) INTO n USING tenant;
      IF n > 0 THEN
        remaining := concat_ws(', ', remaining, t);
      END IF;
    END LOOP;
    IF remaining IS NOT NULL THEN
      RAISE EXCEPTION 'purging tenant % left rows in %', tenant, remaining USING ERRCODE = 'object_in_use';
    END IF;

    DELETE FROM app.tenants WHERE id = tenant;
    INSERT INTO app.purge_log (purged_tenant_id, purged_tenant_slug, purged_by, counts, leftovers)
    VALUES (tenant, tenant_slug, session_user, counts || jsonb_build_object('tenants', 1), leftovers)
    RETURNING id INTO logged;
    RETURN logged;
  END
  $_$;

-- migrate:down

-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
