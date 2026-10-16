-- migrate:up

-- Per-election curtains (PLAN R181; ADR-0002 §2, §7, §12, public-visibility rule). An election goes from draft to
-- preview, where its site's members see it through the admin's preview as the public will and edit it as a draft
-- (no change requests, nothing in the corrections log), and then live, once: public, and change-controlled from then
-- on. Going straight from draft to live stays possible. What the public sees doesn't change: its role still reads only
-- live and archived elections (and an announced one's own row, now in preview too). The preview reads as a role of its
-- own, aiontheballot_preview, which reads what the public role reads and the elections in preview, never a draft's
-- content; it writes nothing and executes nothing. The role is provisioned with the database (gitops), like the
-- other logins, before this migration runs (PLAN R181 has the order).

-- 1. The status moves (election_rules): draft → preview → live → archived, or draft → live. Entering preview needs
--    what going live needs, and going live checks it again; the slug, type, territory and announcement stay editable
--    in preview; went_live_at is when it went public, never set in preview.
CREATE OR REPLACE FUNCTION private.election_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    tenant record;
    missing text;
  BEGIN
    SELECT t.active, t.country_code, t.default_locale INTO tenant FROM app.tenants t WHERE t.id = NEW.tenant_id;
    IF NEW.territory_code IS NOT NULL AND NOT starts_with(NEW.territory_code, tenant.country_code || '-') THEN
      RAISE EXCEPTION 'territory % is outside the tenant''s country, %', NEW.territory_code, tenant.country_code
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.announced AND NOT NEW.name ? tenant.default_locale THEN
      RAISE EXCEPTION 'an announced election needs its name in the default locale, %', tenant.default_locale
        USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'INSERT' THEN
      IF NEW.status <> 'draft' THEN
        RAISE EXCEPTION 'a new election is a draft' USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.went_live_at := NULL;
      RETURN NEW;
    END IF;

    IF OLD.status = 'archived' THEN
      RAISE EXCEPTION 'election % is archived and read-only', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'draft' AND NEW.status IN ('preview', 'live')
                OR OLD.status = 'preview' AND NEW.status = 'live'
                OR OLD.status = 'live' AND NEW.status = 'archived') THEN
      RAISE EXCEPTION 'election % cannot go from % to %', OLD.id, OLD.status, NEW.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'live' AND NEW.status = 'archived' AND NEW.frozen_from IS NOT NULL
       AND (NEW.frozen_until IS NULL OR NEW.frozen_until > now()) THEN
      RAISE EXCEPTION 'election % cannot be archived while its freeze window is set and not over', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status NOT IN ('draft', 'preview')
       AND (NEW.slug, NEW.type, NEW.territory_code) IS DISTINCT FROM (OLD.slug, OLD.type, OLD.territory_code) THEN
      RAISE EXCEPTION 'election %: the slug, type and territory are fixed once it goes live', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status NOT IN ('draft', 'preview') AND NEW.announced IS DISTINCT FROM OLD.announced THEN
      RAISE EXCEPTION 'election %: the announcement is fixed once it goes live', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;

    -- Into preview or live, from draft or preview: complete in the default locale, which edits in preview may undo.
    IF NEW.status IN ('preview', 'live') AND NEW.status IS DISTINCT FROM OLD.status THEN
      missing := CASE
        WHEN NOT tenant.active THEN 'an active tenant'
        WHEN NOT EXISTS (SELECT 1 FROM app.tenant_organizations o
                          WHERE o.tenant_id = NEW.tenant_id AND o.role = 'operator') THEN 'an operator'
        WHEN NOT EXISTS (SELECT 1 FROM app.methodologies m WHERE m.election_id = NEW.id) THEN 'a methodology'
        WHEN NOT NEW.name ? tenant.default_locale THEN 'its name in the default locale'
        WHEN EXISTS (SELECT 1 FROM app.methodologies m
                      WHERE m.election_id = NEW.id AND NOT m.body ? tenant.default_locale)
          THEN 'the methodology in the default locale'
        WHEN EXISTS (SELECT 1 FROM app.parties p
                      WHERE p.election_id = NEW.id
                        AND NOT (p.name ? tenant.default_locale AND p.short_name ? tenant.default_locale))
          THEN 'every party name in the default locale'
        WHEN EXISTS (SELECT 1 FROM app.criteria c
                      WHERE c.election_id = NEW.id
                        AND NOT (c.title ? tenant.default_locale AND c.description ? tenant.default_locale))
          THEN 'every criterion in the default locale'
      END;
      IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'election % cannot go % without %', OLD.id,
          CASE NEW.status WHEN 'live' THEN 'live' ELSE 'to preview' END, missing USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    -- When it went public: never while in preview.
    NEW.went_live_at := CASE WHEN NEW.status = 'live' AND OLD.status IS DISTINCT FROM 'live' THEN now()
                             ELSE OLD.went_live_at END;
    RETURN NEW;
  END
  $$;

-- Every criterion's short title, on the way into preview or live (and, from then on, on each criterion's write).
CREATE OR REPLACE FUNCTION private.short_title_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
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
        RAISE EXCEPTION 'election % cannot go % without every criterion''s short title in the default locale',
          NEW.id, CASE NEW.status WHEN 'live' THEN 'live' ELSE 'to preview' END USING ERRCODE = 'check_violation';
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

DROP TRIGGER short_title_rules ON app.elections;
CREATE TRIGGER short_title_rules BEFORE UPDATE OF status ON app.elections
  FOR EACH ROW WHEN (OLD.status IN ('draft', 'preview') AND NEW.status IN ('preview', 'live')
                     AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION private.short_title_rules();

-- 2. Its structure is edited as a draft's: slugs change and rows are deleted until it goes live. (Change control
--    already applies to live elections only; a change request is still refused before then.)
CREATE OR REPLACE FUNCTION private.structure_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    fresh jsonb := to_jsonb(NEW);
    tenant uuid := (fresh ->> 'tenant_id')::uuid;
    election_status app.election_status;
    country text;
  BEGIN
    IF TG_TABLE_NAME = 'methodology_reviewers' THEN
      SELECT e.status INTO election_status
        FROM app.methodologies m JOIN app.elections e ON e.id = m.election_id
       WHERE m.id = (fresh ->> 'methodology_id')::uuid;
    ELSE
      SELECT e.status INTO election_status FROM app.elections e WHERE e.id = (fresh ->> 'election_id')::uuid;
    END IF;
    IF election_status IS NULL THEN
      RETURN NEW;
    END IF;

    IF election_status = 'archived' THEN
      RAISE EXCEPTION 'the election of this %.% row is archived and read-only', TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND election_status NOT IN ('draft', 'preview') AND fresh ? 'slug'
       AND fresh -> 'slug' IS DISTINCT FROM to_jsonb(OLD) -> 'slug' THEN
      RAISE EXCEPTION 'a %.% slug is fixed once its election goes live', TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
    END IF;

    IF jsonb_typeof(fresh -> 'territory_codes') = 'array' THEN
      SELECT t.country_code INTO country FROM app.tenants t WHERE t.id = tenant;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(fresh -> 'territory_codes') c
                  WHERE NOT starts_with(c, country || '-')) THEN
        RAISE EXCEPTION 'a party territory is outside the tenant''s country, %', country
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF TG_TABLE_NAME = 'methodologies' THEN
      IF fresh ->> 'kind' IS DISTINCT FROM (SELECT t.methodology_kind::text FROM app.tenants t WHERE t.id = tenant) THEN
        RAISE EXCEPTION 'a methodology uses its tenant''s kind' USING ERRCODE = 'check_violation';
      END IF;
      IF fresh ->> 'demands_owner_id' IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM app.tenant_organizations o
                          WHERE o.tenant_id = tenant AND o.organization_id = (fresh ->> 'demands_owner_id')::uuid) THEN
        RAISE EXCEPTION 'the demands belong to the tenant''s operator or an endorser' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END
  $$;

ALTER POLICY country_admin_delete ON app.methodologies
  USING (((tenant_id IN (SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role])))
          OR (SELECT private.is_platform_admin()))
         AND EXISTS (SELECT 1 FROM app.elections e
                      WHERE e.id = methodologies.election_id AND e.status IN ('draft', 'preview')));
ALTER POLICY country_admin_delete ON app.methodology_reviewers
  USING (((tenant_id IN (SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role])))
          OR (SELECT private.is_platform_admin()))
         AND EXISTS (SELECT 1 FROM app.methodologies m JOIN app.elections e ON e.id = m.election_id
                      WHERE m.id = methodology_reviewers.methodology_id AND e.status IN ('draft', 'preview')));
ALTER POLICY editor_delete ON app.criteria
  USING (((tenant_id IN (SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role,
                                                                   'editor'::app.tenant_role])))
          OR (SELECT private.is_platform_admin()))
         AND EXISTS (SELECT 1 FROM app.elections e
                      WHERE e.id = criteria.election_id AND e.status IN ('draft', 'preview')));
ALTER POLICY editor_delete ON app.parties
  USING (((tenant_id IN (SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role,
                                                                   'editor'::app.tenant_role])))
          OR (SELECT private.is_platform_admin()))
         AND EXISTS (SELECT 1 FROM app.elections e
                      WHERE e.id = parties.election_id AND e.status IN ('draft', 'preview')));

-- 3. Cells are published in preview, through the same review, and each revision records whether it was: the
--    corrections log starts when the election goes live, so what was republished in preview is no correction, and
--    nor is a cell's first version after a withdrawal in preview, the first the public sees of it (the public site's
--    history says the same, `publicHistory`). Set by the publish trigger alone, like the rest of the row.
ALTER TABLE app.assessment_revisions ADD COLUMN published_in_preview boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN app.assessment_revisions.published_in_preview IS
  'Published while its election was in preview (PLAN R181): before the public saw it, so never a correction.';
CREATE OR REPLACE FUNCTION private.publish_revision() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
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
    -- Shared, so a change of status (going live) waits for it, and it for one in flight: whether it was published in
    -- preview, and the freeze window, are what they are when it commits (PLAN R181).
    SELECT * INTO election FROM app.elections e WHERE e.id = cell.election_id FOR SHARE;
    SELECT * INTO tenant FROM app.tenants t WHERE t.id = cell.tenant_id;
    SELECT * INTO methodology FROM app.methodologies m WHERE m.election_id = cell.election_id;

    -- 2.
    IF NOT (election.status IN ('preview', 'live')
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
    NEW.published_in_preview := election.status = 'preview';
    RETURN NEW;
  END
  $$;

CREATE OR REPLACE VIEW app.corrections_log WITH (security_invoker = true) AS
  SELECT r.tenant_id, r.election_id, r.id AS entry_id, 'revision'::text AS entry_kind, r.published_at AS at,
         r.change_kind::text AS change, r.assessment_id, NULL::text AS target_kind, NULL::uuid AS target_id,
         NULL::text AS field, NULL::jsonb AS previous_value, NULL::jsonb AS new_value, r.public_note
    FROM app.assessment_revisions r
   WHERE r.change_kind <> 'initial' AND NOT r.published_in_preview
     AND NOT EXISTS (SELECT 1 FROM app.assessment_revisions p
                      WHERE p.assessment_id = r.assessment_id AND p.revision_no = r.revision_no - 1
                        AND p.published_in_preview AND p.change_kind = 'withdrawal')
  UNION ALL
  SELECT s.tenant_id, s.election_id, s.id AS entry_id, 'structural_change'::text AS entry_kind, s.approved_at AS at,
         s.action::text AS change, NULL::uuid AS assessment_id, s.target_kind, s.target_id, s.field,
         s.previous_value, s.new_value, s.public_note
    FROM app.structural_changes s
  ORDER BY 5 DESC;

-- 4. The public's election rows: an announcement carries on through preview.
ALTER POLICY public_read ON app.elections
  USING ((status IN ('live', 'archived') OR (status IN ('draft', 'preview') AND announced))
         AND EXISTS (SELECT 1 FROM app.tenants t WHERE t.id = elections.tenant_id AND t.active));

-- 5. The preview's role: USAGE on app, the very reads of aiontheballot_web (copied from its grants, so the two can't
--    drift; a catalog test checks they stay equal), and a read policy beside each of the public role's, admitting
--    elections in preview too. No EXECUTE: the preview has no forms. No write grant at all.
GRANT USAGE ON SCHEMA app TO aiontheballot_preview;
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT c.oid::regclass AS rel FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p', 'v', 'm')
              AND has_table_privilege('aiontheballot_web', c.oid, 'SELECT')
            ORDER BY c.relname LOOP
    EXECUTE format('GRANT SELECT ON TABLE %s TO aiontheballot_preview', r.rel);
  END LOOP;
  FOR r IN SELECT c.oid::regclass AS rel, string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) AS cols
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
            WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p', 'v', 'm')
              AND NOT has_table_privilege('aiontheballot_web', c.oid, 'SELECT')
              AND has_column_privilege('aiontheballot_web', c.oid, a.attnum, 'SELECT')
            GROUP BY c.oid, c.relname ORDER BY c.relname LOOP
    EXECUTE format('GRANT SELECT (%s) ON TABLE %s TO aiontheballot_preview', r.cols, r.rel);
  END LOOP;
END
$$;

-- An election's content: in preview, live or archived.
CREATE POLICY preview_read ON app.elections FOR SELECT TO aiontheballot_preview
  USING ((status IN ('preview', 'live', 'archived') OR (status = 'draft' AND announced))
         AND EXISTS (SELECT 1 FROM app.tenants t WHERE t.id = elections.tenant_id AND t.active));
CREATE POLICY preview_read ON app.methodologies FOR SELECT TO aiontheballot_preview
  USING (EXISTS (SELECT 1 FROM app.elections e
                  WHERE e.id = methodologies.election_id AND e.status IN ('preview', 'live', 'archived')));
CREATE POLICY preview_read ON app.methodology_reviewers FOR SELECT TO aiontheballot_preview
  USING (EXISTS (SELECT 1 FROM app.methodologies m JOIN app.elections e ON e.id = m.election_id
                  WHERE m.id = methodology_reviewers.methodology_id AND e.status IN ('preview', 'live', 'archived')));
CREATE POLICY preview_read ON app.parties FOR SELECT TO aiontheballot_preview
  USING (EXISTS (SELECT 1 FROM app.elections e
                  WHERE e.id = parties.election_id AND e.status IN ('preview', 'live', 'archived')));
CREATE POLICY preview_read ON app.criteria FOR SELECT TO aiontheballot_preview
  USING (EXISTS (SELECT 1 FROM app.elections e
                  WHERE e.id = criteria.election_id AND e.status IN ('preview', 'live', 'archived')));
CREATE POLICY preview_read ON app.assessment_revisions FOR SELECT TO aiontheballot_preview
  USING (EXISTS (SELECT 1 FROM app.elections e
                  WHERE e.id = assessment_revisions.election_id AND e.status IN ('preview', 'live', 'archived')));
CREATE POLICY preview_read ON app.revision_evidence FOR SELECT TO aiontheballot_preview
  USING (EXISTS (SELECT 1 FROM app.elections e
                  WHERE e.id = revision_evidence.election_id AND e.status IN ('preview', 'live', 'archived')));
CREATE POLICY preview_read ON app.revision_checked_documents FOR SELECT TO aiontheballot_preview
  USING (EXISTS (SELECT 1 FROM app.elections e
                  WHERE e.id = revision_checked_documents.election_id
                    AND e.status IN ('preview', 'live', 'archived')));
CREATE POLICY preview_read ON app.structural_changes FOR SELECT TO aiontheballot_preview
  USING (EXISTS (SELECT 1 FROM app.elections e
                  WHERE e.id = structural_changes.election_id AND e.status IN ('preview', 'live', 'archived')));
-- As the public role's: each reads through the rows above (RLS applies in the subqueries, as this role).
CREATE POLICY preview_read ON app.source_documents FOR SELECT TO aiontheballot_preview
  USING (EXISTS (SELECT 1 FROM app.revision_evidence r WHERE r.source_document_id = source_documents.id)
         OR EXISTS (SELECT 1 FROM app.revision_checked_documents r WHERE r.source_document_id = source_documents.id));
CREATE POLICY preview_read ON app.files FOR SELECT TO aiontheballot_preview
  USING (bucket = 'public_assets'
         AND (EXISTS (SELECT 1 FROM app.parties p WHERE p.logo_file_id = files.id)
              OR EXISTS (SELECT 1 FROM app.tenant_brand_selections s WHERE s.file_id = files.id)));
-- The site itself: exactly as the public sees it.
CREATE POLICY preview_read ON app.tenants FOR SELECT TO aiontheballot_preview USING (active);
CREATE POLICY preview_read ON app.tenant_hostnames FOR SELECT TO aiontheballot_preview
  USING (verified_at IS NOT NULL
         AND EXISTS (SELECT 1 FROM app.tenants t WHERE t.id = tenant_hostnames.tenant_id AND t.active));
CREATE POLICY preview_read ON app.tenant_documents FOR SELECT TO aiontheballot_preview
  USING (published_at IS NOT NULL
         AND EXISTS (SELECT 1 FROM app.tenants t WHERE t.id = tenant_documents.tenant_id AND t.active));
CREATE POLICY preview_read ON app.tenant_organizations FOR SELECT TO aiontheballot_preview
  USING (EXISTS (SELECT 1 FROM app.tenants t WHERE t.id = tenant_organizations.tenant_id AND t.active));
CREATE POLICY preview_read ON app.tenant_brand_selections FOR SELECT TO aiontheballot_preview
  USING (EXISTS (SELECT 1 FROM app.tenants t WHERE t.id = tenant_brand_selections.tenant_id AND t.active));
CREATE POLICY preview_read ON app.public_versions FOR SELECT TO aiontheballot_preview
  USING (EXISTS (SELECT 1 FROM app.tenants t WHERE t.id = public_versions.tenant_id AND t.active));
CREATE POLICY preview_read ON app.organizations FOR SELECT TO aiontheballot_preview
  USING (EXISTS (SELECT 1 FROM app.tenant_organizations o JOIN app.tenants t ON t.id = o.tenant_id
                  WHERE o.organization_id = organizations.id AND t.active));
CREATE POLICY preview_read ON app.brand_assets FOR SELECT TO aiontheballot_preview
  USING (NOT restricted
         OR EXISTS (SELECT 1 FROM app.tenant_brand_selections s JOIN app.tenants t ON t.id = s.tenant_id
                     WHERE s.brand_asset_id = brand_assets.id AND t.active));
CREATE POLICY preview_read ON app.core_criteria FOR SELECT TO aiontheballot_preview USING (true);

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
