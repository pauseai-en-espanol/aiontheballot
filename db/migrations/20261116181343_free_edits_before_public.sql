-- migrate:up

-- Free edits until the public sees an election (PLAN R233, Dani's decision: "we can make edits freely until the
-- election is published"). A change of a cell published before needed a change kind and a public note even while its
-- election was in preview, though the public never sees them: the public history shows only the last version published
-- in preview, as the first, with no note, and the corrections log lists nothing published in preview (PLAN R181). Now,
-- while the election is a draft or in preview, such a change is submitted and published with no kind, recorded as an
-- update, and no note; a kind given is still update, correction or withdrawal, and a withdrawal still takes no rating.
-- Once the election is live or archived, every change needs its kind and its note, as before, at submission and again
-- at publish: a change submitted in preview and published once live needs them then.

CREATE OR REPLACE FUNCTION private.assessment_trail() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    edited boolean := TG_OP = 'INSERT' OR NEW.content_version <> OLD.content_version;
    election_status app.election_status;
    tenant record;
    missing text;
  BEGIN
    SELECT e.status INTO election_status FROM app.elections e WHERE e.id = NEW.election_id;
    SELECT t.methodology_kind, t.default_locale INTO tenant FROM app.tenants t WHERE t.id = NEW.tenant_id;

    IF TG_OP = 'INSERT' THEN
      IF NEW.state <> 'draft' OR NEW.generation <> 0 OR NEW.content_version <> 0 THEN
        RAISE EXCEPTION 'a new cell is a draft of generation 0' USING ERRCODE = 'restrict_violation';
      END IF;
      IF election_status = 'archived' THEN
        RAISE EXCEPTION 'election % is archived: it takes corrections and withdrawals of published cells only',
          NEW.election_id USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
    IF edited AND election_status = 'archived'
       AND NOT coalesce(NEW.draft_change_kind IN ('correction', 'withdrawal'), false) THEN
      RAISE EXCEPTION 'election % is archived: a cell''s draft must be a correction or a withdrawal', NEW.election_id
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF (TG_OP = 'INSERT' OR NEW.draft_rating IS DISTINCT FROM OLD.draft_rating)
       AND NOT (CASE tenant.methodology_kind
                  WHEN 'demands' THEN NEW.draft_rating IN ('meets', 'partially_meets', 'does_not_meet', 'not_mentioned')
                  ELSE NEW.draft_rating IN ('green', 'yellow', 'red', 'not_mentioned')
                END) THEN
      RAISE EXCEPTION 'rating % is not on the % scale', NEW.draft_rating, tenant.methodology_kind
        USING ERRCODE = 'check_violation';
    END IF;

    -- Submitting: the draft must have what publishing will require (spec §3.6).
    IF TG_OP = 'UPDATE' AND OLD.state = 'draft' AND NEW.state = 'in_review' THEN
      IF election_status = 'archived' AND NOT coalesce(NEW.draft_change_kind IN ('correction', 'withdrawal'), false) THEN
        RAISE EXCEPTION 'election % is archived: only corrections and withdrawals are submitted', NEW.election_id
          USING ERRCODE = 'restrict_violation';
      END IF;
      missing := CASE
        WHEN NEW.generation = 0 AND NEW.draft_change_kind IS NOT NULL
          THEN 'no change kind, since its first publish is the initial one'
        -- Until the public sees the election, a change needs no kind (an update) and no note (PLAN R233).
        WHEN NEW.generation > 0 AND NOT coalesce(NEW.draft_change_kind IN ('update', 'correction', 'withdrawal'),
                                                 election_status IN ('draft', 'preview'))
          THEN 'a change kind: update, correction or withdrawal'
        WHEN NEW.generation > 0 AND election_status IN ('live', 'archived')
             AND NOT coalesce(NEW.draft_public_note ? tenant.default_locale, false)
          THEN 'a public note in the default locale'
        WHEN NEW.draft_change_kind = 'withdrawal'
          THEN CASE WHEN NEW.draft_rating IS NOT NULL THEN 'no rating, since it is a withdrawal' END
        WHEN NEW.draft_rating IS NULL THEN 'a rating'
        WHEN NOT coalesce(NEW.draft_summary ? tenant.default_locale, false) THEN 'a summary in the default locale'
        WHEN NEW.draft_rating = 'not_mentioned'
             AND NOT EXISTS (SELECT 1 FROM app.draft_checked_documents d
                               JOIN app.source_documents s ON s.id = d.source_document_id
                               JOIN app.methodologies m ON m.election_id = NEW.election_id
                              WHERE d.assessment_id = NEW.id AND s.party_id = NEW.party_id
                                AND s.file_id IS NOT NULL AND s.kind = ANY (m.not_mentioned_source_kinds))
          THEN 'a checked, stored copy of one of the party''s own documents, of a kind the methodology lists'
        WHEN NEW.draft_rating <> 'not_mentioned'
             AND NOT EXISTS (SELECT 1 FROM app.draft_evidence q WHERE q.assessment_id = NEW.id)
          THEN 'a quote'
      END;
      IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'cell % cannot be submitted without %', NEW.id, missing USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF edited THEN
      INSERT INTO app.assessment_contributors (assessment_id, tenant_id, generation, user_id)
      VALUES (NEW.id, NEW.tenant_id, NEW.generation, private.current_user_id())
      ON CONFLICT DO NOTHING;
    END IF;
    -- Every transition but an edit returning a published cell to draft.
    IF TG_OP = 'UPDATE' AND NEW.state IS DISTINCT FROM OLD.state
       AND NOT (OLD.state = 'published' AND NEW.state = 'draft') THEN
      INSERT INTO app.review_events (tenant_id, assessment_id, kind, note)
      SELECT NEW.tenant_id, NEW.id, t.kind,
             CASE WHEN t.kind = 'rejected' THEN
               (SELECT r.note FROM app.review_events r
                 WHERE r.assessment_id = NEW.id AND r.kind = 'commented'
                   AND r.actor_id = private.current_user_id() AND r.created_at = now()
                 ORDER BY r.id DESC LIMIT 1)
             END
        FROM (SELECT CASE
                WHEN NEW.state = 'in_review' THEN 'submitted'
                WHEN NEW.state = 'published' THEN 'approved'
                WHEN EXISTS (SELECT 1 FROM app.assessment_contributors c
                              WHERE c.assessment_id = NEW.id AND c.generation = NEW.generation
                                AND c.user_id = private.current_user_id()) THEN 'recalled'
                ELSE 'rejected'
              END::app.review_event_kind AS kind) t;
    END IF;
    RETURN NULL;
  END
  $$;

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
    -- Until the public sees the election, a later one needs no kind (an update) and no note (PLAN R233).
    IF cell.generation = 0 AND cell.draft_change_kind IS NOT NULL
       OR cell.generation > 0 AND NOT coalesce(cell.draft_change_kind IN ('update', 'correction', 'withdrawal'),
                                               election.status = 'preview')
       OR cell.generation > 0 AND election.status <> 'preview'
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
    RETURN NEW;
  END
  $$;

ALTER TABLE app.assessment_revisions
  DROP CONSTRAINT assessment_revisions_check3,
  ADD CONSTRAINT assessment_revisions_check3
    CHECK (change_kind = 'initial' OR public_note IS NOT NULL OR published_in_preview);

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
