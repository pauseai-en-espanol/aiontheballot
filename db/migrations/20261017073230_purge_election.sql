-- migrate:up

-- Platform admins may delete an election for good from the admin, published or not, with everything in it and its
-- audit trail (PLAN R212, ADR-0002 §14). Until now only the owner could get past the immutable tables, through
-- private.purge_tenant and a login of its own (R165). private.purge_election lets the admin's role do it for one
-- election, in one transaction: it first writes the purge log, which no runtime role may write, with this
-- transaction's id and the election, and sets a flag naming the election; the immutable tables and the audit let the
-- owner's rights through only while both match and that record is not yet finished, so neither the flag nor a
-- SECURITY DEFINER function alone exempts anything. Before it returns, it marks the record finished and clears the
-- flag: nothing later in the transaction gets the exemption back.

ALTER TABLE app.purge_log
  ADD COLUMN purged_election_id uuid,
  ADD COLUMN purged_election_slug text,
  ADD COLUMN purge_xact xid8,
  ADD COLUMN finished_at timestamptz,
  ADD CONSTRAINT purge_log_election_check
    CHECK ((purged_election_id IS NULL) = (purged_election_slug IS NULL)
           AND (purged_election_id IS NULL) = (purge_xact IS NULL)
           AND (finished_at IS NULL OR purged_election_id IS NOT NULL));

-- Whether this transaction is purging an election: the flag names it, and the purge log holds its purge, written in
-- this transaction and not yet finished. Only the owner's rights reach it (the immutable tables ask after checking
-- whose rights run, the audit runs with them), and only they may read the log.
CREATE FUNCTION private.purging_election() RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = ''
  AS $$
    SELECT EXISTS (SELECT 1 FROM app.purge_log l
                    WHERE l.purge_xact = pg_catalog.pg_current_xact_id()
                      AND l.finished_at IS NULL
                      AND l.purged_election_id::text = current_setting('app.purge_election', true))
  $$;
REVOKE ALL ON FUNCTION private.purging_election() FROM PUBLIC;

-- As before (R165), plus an election's purge. Asked only with the owner's rights, so a runtime role never reads the
-- purge log, and gets the immutability error as before.
CREATE OR REPLACE FUNCTION private.forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    table_owner oid := (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID);
  BEGIN
    IF table_owner = (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
      IF (current_setting('app.purge', true) = 'on' AND pg_catalog.pg_has_role(session_user, table_owner, 'MEMBER'))
         OR private.purging_election() THEN
        IF TG_LEVEL = 'ROW' THEN
          RETURN coalesce(NEW, OLD);
        END IF;
        RETURN NULL;
      END IF;
    END IF;
    RAISE EXCEPTION '%.% is immutable: % is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
      USING ERRCODE = 'restrict_violation';
  END
  $$;

-- The audit and the public versions skip an election's purge too: its audit rows go with it, and the purge log is the
-- record. Their callers run with the owner's rights.
CREATE OR REPLACE FUNCTION private.purging(relation oid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = ''
  AS $$
    SELECT (current_setting('app.purge', true) = 'on'
            AND pg_catalog.pg_has_role(session_user, (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = relation),
                                       'MEMBER'))
        OR private.purging_election()
  $$;

-- Deletes an election of a tenant for good, whatever its status: everything in it, its audit trail, and the files
-- nothing else names (their bytes go with the sweep, ADR-0004 §5). A platform admin only, in person with a second
-- factor, who types the election's short name as `confirmation`. Returns the purge log's id.
CREATE FUNCTION private.purge_election(tenant uuid, election uuid, confirmation text) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
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
REVOKE ALL ON FUNCTION private.purge_election(tenant uuid, election uuid, confirmation text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.purge_election(tenant uuid, election uuid, confirmation text) TO aiontheballot_admin;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
