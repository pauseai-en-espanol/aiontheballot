-- migrate:up

-- How often a site's pages are shared, and how far they travel (PLAN R239): counts only, by day, never who.
--
-- - Three events, each by channel: `share`, a click in a page's share dialog (a network's link, copying the address, the
--   device's share sheet, downloading or sharing the data image); `arrival`, a visit that came through a network's
--   share link, which carries its channel in `utm_source`, forwarded or not (so reshares count where the link travels
--   with it); and `preview`, a network's crawler fetching the page to draw its link preview, the closest sign of a
--   link pasted in a chat or a post.
-- - A page by its path inside the site, the same in every language (`/29n/parties/partido-ejemplo-a`), and its
--   election when the path's first segment is one that is public (live or archived); a path into an election not yet
--   public counts nothing. Coming-soon and site pages count with no election.
-- - The public reaches it only through app.count_share, a SECURITY DEFINER function only aiontheballot_web may execute
--   (ADR-0002 §6, §7): it checks every value and adds one to the day's count. A site counts at most 100,000 a UTC day;
--   past that, nothing more that day (no error: the public never hears about counting).
-- - Every member of a site reads its counts (the admin's "Difusión" page); nobody writes them but the function.

CREATE TABLE app.share_counts (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants,
  election_id  uuid,
  path         text NOT NULL
               CHECK (char_length(path) <= 200 AND path ~ '^/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$'),
  event        text NOT NULL CHECK (event IN ('share', 'arrival', 'preview')),
  channel      text NOT NULL CHECK (channel IN (
                 'whatsapp', 'telegram', 'x', 'facebook', 'bluesky', 'linkedin', 'email',
                 'copy', 'native', 'download', 'image',
                 'slack', 'discord', 'other')),
  day          date NOT NULL,
  count        int NOT NULL CHECK (count > 0),
  UNIQUE (tenant_id, id),
  UNIQUE NULLS NOT DISTINCT (tenant_id, election_id, path, event, channel, day),
  FOREIGN KEY (tenant_id, election_id) REFERENCES app.elections (tenant_id, id)
);
CREATE INDEX share_counts_day_idx ON app.share_counts (tenant_id, day);

-- Which channels each event takes: a share is a network or one of the dialog's own actions; an arrival comes through a
-- network's link; a preview is drawn by a network's crawler, or another one's.
ALTER TABLE app.share_counts ADD CONSTRAINT share_counts_channel_of_event CHECK (
  (event = 'share' AND channel IN ('whatsapp', 'telegram', 'x', 'facebook', 'bluesky', 'linkedin', 'email',
                                   'copy', 'native', 'download', 'image'))
  OR (event = 'arrival' AND channel IN ('whatsapp', 'telegram', 'x', 'facebook', 'bluesky', 'linkedin', 'email'))
  OR (event = 'preview' AND channel IN ('whatsapp', 'telegram', 'x', 'facebook', 'bluesky', 'linkedin',
                                        'slack', 'discord', 'other')));

-- Adds one to today's count of an event on a site's page. Returns whether it counted: false past the site's daily cap,
-- for a site that isn't active, or for a page of an election not yet public. Invalid values are refused (a bug or a
-- forged request, never a visitor's doing).
CREATE FUNCTION app.count_share(tenant uuid, path text, event text, channel text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $$
  DECLARE
    daily_cap constant int := 100000;
    today date := (now() AT TIME ZONE 'UTC')::date;
    first_segment text := split_part(count_share.path, '/', 2);
    election_row record;
    counted int;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM app.tenants t WHERE t.id = tenant AND t.active) THEN
      RETURN false;
    END IF;
    SELECT e.id, e.status INTO election_row
      FROM app.elections e WHERE e.tenant_id = tenant AND e.slug::text = first_segment;
    IF FOUND AND election_row.status NOT IN ('live', 'archived') THEN
      RETURN false;
    END IF;
    SELECT coalesce(sum(c.count), 0) INTO counted
      FROM app.share_counts c WHERE c.tenant_id = tenant AND c.day = today;
    IF counted >= daily_cap THEN
      RETURN false;
    END IF;
    INSERT INTO app.share_counts AS c (tenant_id, election_id, path, event, channel, day, count)
    VALUES (tenant, election_row.id, count_share.path, count_share.event, count_share.channel, today, 1)
    ON CONFLICT ON CONSTRAINT share_counts_tenant_id_election_id_path_event_channel_day_key
      DO UPDATE SET count = c.count + 1;
    RETURN true;
  END
  $$;

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.share_counts
  FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();
-- Members' tokens (ADR-0008) never count anything: only app.count_share, as its owner, writes here.
CREATE TRIGGER needs_a_person BEFORE INSERT OR UPDATE OR DELETE ON app.share_counts
  FOR EACH ROW EXECUTE FUNCTION private.needs_a_person('change share_counts');
ALTER TABLE app.share_counts ENABLE ROW LEVEL SECURITY;

GRANT EXECUTE ON FUNCTION app.count_share(uuid, text, text, text) TO aiontheballot_web;

-- Every member of the site reads its counts; platform admins every site's.
GRANT SELECT ON app.share_counts TO aiontheballot_admin;
CREATE POLICY member_read ON app.share_counts FOR SELECT TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
         OR (SELECT private.is_platform_admin()));

-- purge_election as before (migration purge_election), with the election's share counts.
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

-- purge_tenant as before (migration draft_report_link), with the site's share counts.
CREATE OR REPLACE FUNCTION private.purge_tenant(tenant uuid) RETURNS bigint
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
  DECLARE
    -- Children before parents. Cells take their drafts and contributors with them.
    tables text[] := ARRAY[
      'revision_internal', 'revision_evidence', 'revision_checked_documents', 'structural_changes', 'change_requests',
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
