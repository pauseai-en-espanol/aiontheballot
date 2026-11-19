-- migrate:up

-- A site's country admins change a published cell off the record too (PLAN R244, Dani's decision: "make the change so
-- that coordinators can see it"). The choice was a platform admin's alone (PLAN R243), but it is an editorial one, and
-- a site's editorial decisions are its country admins': they now mark a draft as off the record, and publish one so
-- marked, as a platform admin does. An editor still doesn't mark it, a reviewer still doesn't publish it, and a
-- member's token does neither. Every other limit stays: a live election, no kind or note of its own, never a
-- withdrawal nor after one, and the review rule.

-- 1. Who marks a draft: its site's country admins, and platform admins. Before `rules` (by name), which clears the
--    mark at publish as the table's owner.
DROP TRIGGER platform_admin_columns ON app.assessments;
CREATE TRIGGER country_admin_columns BEFORE UPDATE ON app.assessments
  FOR EACH ROW EXECUTE FUNCTION private.restrict_columns('country_admin', 'draft_unlogged');
COMMENT ON COLUMN app.assessments.draft_unlogged IS
  'A country admin''s or platform admin''s mark (PLAN R243, R244): published off the record, with no kind or note.';
COMMENT ON COLUMN app.assessment_revisions.unlogged IS
  'Published off the record by a country admin or platform admin (PLAN R243, R244): the corrections log leaves it out.';

-- 2. Who publishes one so marked: the same (body only below; the function stays on the definer allowlist).
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
    -- Off the record (PLAN R243): only a country admin of its site or a platform admin publishes it (PLAN R244), not
    -- a reviewer. (Its election is live and its last revision no withdrawal: marking it and submitting it were
    -- refused otherwise, and an archived election, above, takes no change without a kind.)
    IF cell.draft_unlogged
       AND NOT (cell.tenant_id IN (SELECT private.my_tenants('country_admin')) OR private.is_platform_admin()) THEN
      RAISE EXCEPTION 'cell %: only a country admin or a platform admin publishes a change off the record', cell.id
        USING ERRCODE = 'insufficient_privilege';
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
    -- Until the public sees the election, a later one needs no kind (an update) and no note (PLAN R233); nor
    -- does one off the record (PLAN R243).
    IF cell.generation = 0 AND cell.draft_change_kind IS NOT NULL
       OR cell.generation > 0 AND NOT coalesce(cell.draft_change_kind IN ('update', 'correction', 'withdrawal'),
                                               election.status = 'preview' OR cell.draft_unlogged)
       OR cell.generation > 0 AND election.status <> 'preview' AND NOT cell.draft_unlogged
          AND NOT coalesce(cell.draft_public_note ? tenant.default_locale, false) THEN
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
    NEW.change_kind := CASE WHEN cell.generation = 0 THEN 'initial'
                            ELSE coalesce(cell.draft_change_kind, 'update') END;
    NEW.public_note := cell.draft_public_note;
    NEW.published_at := now();
    NEW.published_in_preview := election.status = 'preview';
    NEW.unlogged := cell.draft_unlogged;
    RETURN NEW;
  END
  $$;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
