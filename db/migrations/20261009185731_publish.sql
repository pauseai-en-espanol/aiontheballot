-- migrate:up

-- Publishing (spec §3.6): `INSERT INTO app.assessment_revisions (assessment_id, reviewed_version)`. The
-- SECURITY DEFINER trigger private.publish_revision() (ADR-0002 §6 allowlist) does the rest in the same transaction:
--
-- Before the insert:
-- 3. The publisher holds reviewer or country_admin in the cell's tenant, or is a platform admin, at aal2. Checked
--    first, so nobody else learns anything about the cell.
-- 1. Locks the cell; it must be in review at the version reviewed.
-- 2. The election is live, or archived for a correction or withdrawal, and outside its freeze window.
-- 4. The contributors are the generation's, plus whoever uploaded a file the draft cites. If the election requires a
--    second reviewer, the publisher is not one of them; otherwise a self-review is recorded privately.
-- 5. The change kind is initial for the first revision only; every later one carries the draft's update, correction
--    or withdrawal, and a public note with default-locale text.
-- 6. Re-runs the verbatim match and the attestation rules (a no-op update of the quotes, which recomputes them).
-- 7. The evidence requirement: every quote matched or attested, from an admissible kind; a rating other than "not
--    mentioned" needs a quote, "not mentioned" a checked, stored copy of the party's own document of a kind listed
--    for it; a withdrawal has no rating; anything else has a rating on the scale and a default-locale summary.
-- 8. Fills in the revision from the cell.
-- After the insert:
-- 8. Copies the quotes (with the matched units' labels) and checked documents, and writes revision_internal.
-- 9. Sets the cell published, which starts its next generation and records the approval (the cell's own trigger).

-- Who counts as a contributor of a cell's current generation: whoever changed its content, and whoever uploaded a file
-- its draft cites (a source's uploaded copy, or an attestation file). Called only by the publish trigger.
CREATE FUNCTION private.revision_contributors(cell uuid) RETURNS uuid[]
  LANGUAGE sql STABLE
  SET search_path = ''
  AS $$
    SELECT coalesce(array_agg(DISTINCT u.user_id ORDER BY u.user_id), '{}')
      FROM (SELECT c.user_id
              FROM app.assessment_contributors c JOIN app.assessments a ON a.id = c.assessment_id
             WHERE c.assessment_id = cell AND c.generation = a.generation
            UNION ALL
            SELECT f.created_by
              FROM app.draft_evidence q
              JOIN app.source_documents s ON s.id = q.source_document_id
              JOIN app.files f ON f.id = s.file_id
             WHERE q.assessment_id = cell AND s.file_origin = 'uploaded'
            UNION ALL
            SELECT f.created_by
              FROM app.draft_checked_documents d
              JOIN app.source_documents s ON s.id = d.source_document_id
              JOIN app.files f ON f.id = s.file_id
             WHERE d.assessment_id = cell AND s.file_origin = 'uploaded'
            UNION ALL
            SELECT f.created_by
              FROM app.draft_evidence q JOIN app.files f ON f.id = q.attestation_file_id
             WHERE q.assessment_id = cell) u
  $$;

CREATE FUNCTION private.publish_revision() RETURNS trigger
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
      INSERT INTO app.revision_internal (revision_id, tenant_id, contributor_ids, reviewer_id, self_reviewed, provenance)
      VALUES (NEW.id, NEW.tenant_id, contributors, publisher, publisher = ANY (contributors),
              (SELECT coalesce(jsonb_agg(jsonb_build_object('ordinal', q.ordinal, 'author', q.created_by,
                                                            'origin', q.origin, 'llm_suggestion_id', q.llm_suggestion_id,
                                                            'attested_by', q.attested_by)
                                         ORDER BY q.ordinal), '[]')
                 FROM app.draft_evidence q WHERE q.assessment_id = NEW.assessment_id));
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

CREATE TRIGGER publish BEFORE INSERT ON app.assessment_revisions
  FOR EACH ROW EXECUTE FUNCTION private.publish_revision();
CREATE TRIGGER publish_copy AFTER INSERT ON app.assessment_revisions
  FOR EACH ROW EXECUTE FUNCTION private.publish_revision();

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
