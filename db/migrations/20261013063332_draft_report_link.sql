-- migrate:up

-- A cell's draft names the right-of-reply report it answers (editorial workflow C10.4, W14; PLAN D16, approved by
-- Dani; R22 left revision_internal.report_id empty). Change requests already have report_id (CR1.8).
-- - assessments.draft_report_id: a report of the cell's tenant (composite foreign key) and election, which the writer
--   can read; about the whole election or any of its cells, since a report about one cell may show another wrong too.
--   A platform admin reads no reports (PLAN P11), so neither sets nor clears one; editors and country admins write it,
--   as the rest of the draft (restrict_columns), and nobody inserts it: a new cell starts without one.
-- - It is content, reviewed with the draft: changing it bumps the version, adds its writer as a contributor, is locked
--   in review and returns a published cell to draft (assessment_transition).
-- - Publishing copies it into revision_internal.report_id (publish_revision, ADR-0002 §6's allowlisted SECURITY
--   DEFINER trigger, changed only here), and the next generation's draft starts without it, as without a change kind
--   or a note (assessment_transition).
-- - A new grant: UPDATE (draft_report_id) to aiontheballot_admin (ADR-0002 §6, amended).
-- - A report names its cell and now a cell its report, so the tenant purge defers the new foreign key (purge_tenant).

ALTER TABLE app.assessments
  ADD COLUMN draft_report_id uuid,
  ADD CONSTRAINT assessments_draft_report_fkey
    FOREIGN KEY (tenant_id, draft_report_id) REFERENCES app.reports (tenant_id, id)
    -- Checked at once, except in a tenant's purge, which deletes reports before the cells that name them.
    DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX assessments_draft_report_id_idx ON app.assessments (draft_report_id);
COMMENT ON COLUMN app.assessments.draft_report_id IS
  'The right-of-reply report the draft answers, copied into revision_internal.report_id on publish';

GRANT UPDATE (draft_report_id) ON app.assessments TO aiontheballot_admin;

-- Only editors and country admins (and platform admins, whom the link rule then refuses) change the draft's columns.
DROP TRIGGER editor_columns ON app.assessments;
CREATE TRIGGER editor_columns BEFORE UPDATE ON app.assessments
  FOR EACH ROW EXECUTE FUNCTION private.restrict_columns('country_admin,editor', 'draft_rating', 'draft_summary',
                                                         'draft_change_kind', 'draft_public_note', 'recheck_reason',
                                                         'draft_report_id');

-- The report, read as the writer (this runs as the caller, under RLS): changing the link, to another report or to none,
-- needs the writer to read the report it named and the one it names, so a platform admin, who reads none, neither
-- sets nor clears one (a permission error, as if it didn't exist); a report of another election is refused.
CREATE FUNCTION private.draft_report_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    IF NEW.draft_report_id IS DISTINCT FROM OLD.draft_report_id THEN
      IF NEW.draft_report_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM app.reports r WHERE r.id = NEW.draft_report_id)
         OR OLD.draft_report_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM app.reports r WHERE r.id = OLD.draft_report_id) THEN
        RAISE EXCEPTION 'cell %: a draft names only a report its writer can read', NEW.id
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NEW.draft_report_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM app.reports r
                          WHERE r.id = NEW.draft_report_id AND r.election_id = NEW.election_id) THEN
        RAISE EXCEPTION 'cell %: a draft answers only a report about its own election', NEW.id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END
  $$;
REVOKE ALL ON FUNCTION private.draft_report_rules() FROM PUBLIC;

-- Named to run after editor_columns (a reviewer is refused for the column first) and before rules (the content lock).
CREATE TRIGGER report_link BEFORE UPDATE OF draft_report_id ON app.assessments
  FOR EACH ROW EXECUTE FUNCTION private.draft_report_rules();

-- assessment_transition (migration assessment_workflow): the link is content, and publishing clears it.
CREATE OR REPLACE FUNCTION private.assessment_transition() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  DECLARE
    content text[] := ARRAY['draft_rating', 'draft_summary', 'draft_change_kind', 'draft_public_note',
                            'draft_report_id'];
    edited boolean;
  BEGIN
    -- Publishing: only the publish trigger (as the table owner), from review, changing nothing else. It starts the
    -- next generation, whose draft starts from the published content with no change kind, note or report.
    IF NEW.state = 'published' AND OLD.state <> 'published' THEN
      IF (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID)
           <> (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = current_user)
         OR OLD.state <> 'in_review'
         OR (to_jsonb(NEW) - 'state') IS DISTINCT FROM (to_jsonb(OLD) - 'state') THEN
        RAISE EXCEPTION 'cell %: only the publish trigger publishes a cell, from review', OLD.id
          USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.generation := OLD.generation + 1;
      NEW.draft_change_kind := NULL;
      NEW.draft_public_note := NULL;
      NEW.draft_report_id := NULL;
      RETURN NEW;
    END IF;

    -- The quote and checked-document triggers touch the cell with a nested `SET state = 'draft'` that changes nothing
    -- else: an edit of the cell.
    edited := EXISTS (SELECT 1 FROM unnest(content) c WHERE to_jsonb(NEW) -> c IS DISTINCT FROM to_jsonb(OLD) -> c)
              OR (pg_trigger_depth() > 1 AND NEW.state = 'draft'
                  AND (to_jsonb(NEW) - 'state') = (to_jsonb(OLD) - 'state'));
    NEW.generation := OLD.generation;
    NEW.content_version := OLD.content_version + CASE WHEN edited THEN 1 ELSE 0 END;

    IF edited THEN
      IF OLD.state = 'in_review' THEN
        RAISE EXCEPTION 'cell % is in review, so its content is locked: recall it first', OLD.id
          USING ERRCODE = 'restrict_violation';
      END IF;
      IF OLD.state = 'published' THEN
        IF NEW.state = 'in_review' THEN
          RAISE EXCEPTION 'cell %: an edit returns a published cell to draft', OLD.id
            USING ERRCODE = 'restrict_violation';
        END IF;
        NEW.state := 'draft';
      END IF;
    ELSIF NEW.state IS DISTINCT FROM OLD.state AND OLD.state = 'published' THEN
      RAISE EXCEPTION 'cell %: a published cell returns to draft only by editing it', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;

    IF OLD.state = 'draft' AND NEW.state = 'in_review'
       AND NOT (NEW.tenant_id IN (SELECT private.my_tenants('country_admin', 'editor'))
                OR private.is_platform_admin()) THEN
      RAISE EXCEPTION 'cell %: submitting needs an editor or country admin', OLD.id
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Back from review: a contributor recalls it; otherwise a reviewer or country admin rejects it, with a note.
    IF OLD.state = 'in_review' AND NEW.state = 'draft'
       AND NOT EXISTS (SELECT 1 FROM app.assessment_contributors c
                        WHERE c.assessment_id = OLD.id AND c.generation = OLD.generation
                          AND c.user_id = private.current_user_id()) THEN
      IF NOT (NEW.tenant_id IN (SELECT private.my_tenants('country_admin', 'reviewer'))
              OR private.is_platform_admin()) THEN
        RAISE EXCEPTION 'cell %: only its contributors recall it, and only reviewers and country admins reject it',
          OLD.id USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM app.review_events r
                      WHERE r.assessment_id = OLD.id AND r.kind = 'commented'
                        AND r.actor_id = private.current_user_id() AND r.created_at = now()) THEN
        RAISE EXCEPTION 'cell %: a rejection needs a note, written as a comment in the same transaction', OLD.id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END
  $$;

-- publish_revision (migration publish): revision_internal records the report the draft answered.
CREATE OR REPLACE FUNCTION private.publish_revision() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  DECLARE
    publisher uuid := private.current_user_id();
    cell app.assessments;
    election app.elections;
    tenant app.tenants;
    methodology app.methodologies;
    contributors uuid[];
    missing text;
  BEGIN
    IF TG_WHEN = 'AFTER' THEN
      contributors := private.revision_contributors(NEW.assessment_id);
      INSERT INTO app.revision_evidence (revision_id, tenant_id, election_id, ordinal, source_document_id, quote,
                                         location_label, ts_start, ts_end, match_status)
      SELECT NEW.id, NEW.tenant_id, NEW.election_id, q.ordinal, q.source_document_id, q.quote,
             CASE WHEN q.match_status = 'matched' THEN
               (SELECT CASE WHEN q.matched_from_unit = q.matched_to_unit THEN f.label ELSE f.label || '–' || t.label END
                  FROM app.source_texts f, app.source_texts t
                 WHERE f.source_document_id = q.source_document_id AND f.unit_index = q.matched_from_unit
                   AND t.source_document_id = q.source_document_id AND t.unit_index = q.matched_to_unit)
             ELSE q.section_label END,
             q.ts_start, q.ts_end, q.match_status
        FROM app.draft_evidence q
       WHERE q.assessment_id = NEW.assessment_id;
      INSERT INTO app.revision_checked_documents (revision_id, tenant_id, election_id, source_document_id, checked_at)
      SELECT NEW.id, NEW.tenant_id, NEW.election_id, d.source_document_id, d.checked_at
        FROM app.draft_checked_documents d
       WHERE d.assessment_id = NEW.assessment_id;
      INSERT INTO app.revision_internal (revision_id, tenant_id, contributor_ids, reviewer_id, self_reviewed, provenance,
                                         report_id)
      VALUES (NEW.id, NEW.tenant_id, contributors, publisher, publisher = ANY (contributors),
              (SELECT coalesce(jsonb_agg(jsonb_build_object('ordinal', q.ordinal, 'author', q.created_by,
                                                            'origin', q.origin, 'llm_suggestion_id', q.llm_suggestion_id,
                                                            'attested_by', q.attested_by)
                                         ORDER BY q.ordinal), '[]')
                 FROM app.draft_evidence q WHERE q.assessment_id = NEW.assessment_id),
              -- The report the draft answers, before publishing clears it from the cell (its transition trigger).
              (SELECT a.draft_report_id FROM app.assessments a WHERE a.id = NEW.assessment_id));
      UPDATE app.assessments SET state = 'published' WHERE id = NEW.assessment_id;
      RETURN NULL;
    END IF;

    -- 3, before anything about the cell is read or locked.
    IF NOT EXISTS (SELECT 1 FROM app.assessments a
                    WHERE a.id = NEW.assessment_id
                      AND (a.tenant_id IN (SELECT private.my_tenants('country_admin', 'reviewer'))
                           OR private.is_platform_admin())) THEN
      RAISE EXCEPTION 'publishing needs a reviewer or country admin of the cell''s tenant'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 1.
    SELECT * INTO cell FROM app.assessments a WHERE a.id = NEW.assessment_id FOR UPDATE;
    IF cell.state <> 'in_review' THEN
      RAISE EXCEPTION 'cell % is not in review', cell.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.reviewed_version IS DISTINCT FROM cell.content_version THEN
      RAISE EXCEPTION 'cell % changed after version % was reviewed', cell.id, NEW.reviewed_version
        USING ERRCODE = 'restrict_violation';
    END IF;
    SELECT * INTO election FROM app.elections e WHERE e.id = cell.election_id;
    SELECT * INTO tenant FROM app.tenants t WHERE t.id = cell.tenant_id;
    SELECT * INTO methodology FROM app.methodologies m WHERE m.election_id = cell.election_id;

    -- 2.
    IF NOT (election.status = 'live'
            OR election.status = 'archived' AND coalesce(cell.draft_change_kind IN ('correction', 'withdrawal'), false)) THEN
      RAISE EXCEPTION 'election % takes no such publish while %', election.id, election.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF election.frozen_from <= now() AND (election.frozen_until IS NULL OR now() < election.frozen_until) THEN
      RAISE EXCEPTION 'election % is frozen: nothing public changes until the window ends', election.id
        USING ERRCODE = 'restrict_violation';
    END IF;

    -- 4.
    contributors := private.revision_contributors(cell.id);
    IF cardinality(contributors) = 0 THEN
      RAISE EXCEPTION 'cell % has no contributor to its draft', cell.id USING ERRCODE = 'check_violation';
    END IF;
    IF election.require_second_reviewer AND publisher = ANY (contributors) THEN
      RAISE EXCEPTION 'cell %: its contributors never publish it while the election requires a second reviewer',
        cell.id USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 5.
    IF cell.generation = 0 AND cell.draft_change_kind IS NOT NULL
       OR cell.generation > 0 AND NOT coalesce(cell.draft_change_kind IN ('update', 'correction', 'withdrawal'), false)
       OR cell.generation > 0 AND NOT coalesce(cell.draft_public_note ? tenant.default_locale, false) THEN
      RAISE EXCEPTION 'cell %: only the first revision is initial; later ones need a kind and a default-locale note',
        cell.id USING ERRCODE = 'check_violation';
    END IF;

    -- 6.
    UPDATE app.draft_evidence q SET quote = q.quote WHERE q.assessment_id = cell.id;

    -- 7.
    missing := CASE
      WHEN EXISTS (SELECT 1 FROM app.draft_evidence q JOIN app.source_documents s ON s.id = q.source_document_id
                    WHERE q.assessment_id = cell.id
                      AND (q.match_status NOT IN ('matched', 'attested')
                           OR NOT coalesce(s.kind = ANY (methodology.admissible_source_kinds), false)))
        THEN 'every quote matched or attested, from a kind the methodology admits'
      WHEN cell.draft_change_kind = 'withdrawal'
        THEN CASE WHEN cell.draft_rating IS NOT NULL THEN 'no rating, since it is a withdrawal' END
      WHEN NOT coalesce(CASE tenant.methodology_kind
                          WHEN 'demands' THEN cell.draft_rating IN ('meets', 'partially_meets', 'does_not_meet',
                                                                    'not_mentioned')
                          ELSE cell.draft_rating IN ('green', 'yellow', 'red', 'not_mentioned')
                        END, false)
        THEN 'a rating on the methodology''s scale'
      WHEN NOT coalesce(cell.draft_summary ? tenant.default_locale, false) THEN 'a summary in the default locale'
      WHEN cell.draft_rating = 'not_mentioned'
           AND NOT EXISTS (SELECT 1 FROM app.draft_checked_documents d
                             JOIN app.source_documents s ON s.id = d.source_document_id
                            WHERE d.assessment_id = cell.id AND s.party_id = cell.party_id AND s.file_id IS NOT NULL
                              AND s.kind = ANY (methodology.not_mentioned_source_kinds))
        THEN 'a checked, stored copy of one of the party''s own documents, of a kind listed for "not mentioned"'
      WHEN cell.draft_rating <> 'not_mentioned'
           AND NOT EXISTS (SELECT 1 FROM app.draft_evidence q WHERE q.assessment_id = cell.id)
        THEN 'a quote'
    END;
    IF missing IS NOT NULL THEN
      RAISE EXCEPTION 'cell % cannot be published without %', cell.id, missing USING ERRCODE = 'check_violation';
    END IF;

    -- 8.
    NEW.tenant_id := cell.tenant_id;
    NEW.election_id := cell.election_id;
    NEW.party_id := cell.party_id;
    NEW.criterion_id := cell.criterion_id;
    NEW.revision_no := cell.generation + 1;
    NEW.rating := cell.draft_rating;
    NEW.summary := cell.draft_summary;
    NEW.change_kind := CASE WHEN cell.generation = 0 THEN 'initial' ELSE cell.draft_change_kind END;
    NEW.public_note := cell.draft_public_note;
    NEW.published_at := now();
    RETURN NEW;
  END
  $$;

-- purge_tenant (migration signups): as before, with the draft's link to its report checked at commit.
CREATE OR REPLACE FUNCTION private.purge_tenant(tenant uuid) RETURNS bigint
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
  DECLARE
    -- Children before parents. Cells take their drafts and contributors with them.
    tables text[] := ARRAY[
      'revision_internal', 'revision_evidence', 'revision_checked_documents', 'structural_changes', 'change_requests',
      'assessment_revisions', 'review_events', 'reports', 'report_daily_counts', 'signups', 'signup_daily_counts',
      'assessment_contributors',
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
