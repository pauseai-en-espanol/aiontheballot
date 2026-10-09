-- migrate:up

-- The cell workflow (spec §3.5, §4). Content is a cell's draft columns (rating, summary, change kind, public note) and
-- any insert, update or delete of its quotes and checked documents. Submitting, recalling, rejecting and attesting are
-- not content.
--
-- - draft → in_review (submit): by editors and country admins, once the draft has what publishing will require.
-- - in_review → draft: recalled by a contributor of the generation, or rejected by a reviewer or country admin with a
--   note, written as a comment in the same transaction.
-- - in_review → published: only by the publish trigger, which runs as the table owner; the next generation starts.
-- - published → draft: by editing it.
--
-- Content changes only while the cell is a draft (or published, which the edit returns to draft), with the cell row
-- locked. Each one bumps content_version and adds the editor as a contributor of the generation. In an archived
-- election, only corrections and withdrawals are drafted (PLAN P16). The workflow writes the review trail; members
-- only comment.

-- Before an update of a cell: what changed, and whether the transition is allowed.
CREATE FUNCTION private.assessment_transition() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    content text[] := ARRAY['draft_rating', 'draft_summary', 'draft_change_kind', 'draft_public_note'];
    edited boolean;
  BEGIN
    -- Publishing: only the publish trigger (as the table owner), from review, changing nothing else. It starts the
    -- next generation, whose draft starts from the published content with no change kind or note.
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

-- After a cell is created or updated: the checks that change nothing (so RLS refuses a stranger first), then the
-- contributor and the review trail.
CREATE FUNCTION private.assessment_trail() RETURNS trigger
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
        WHEN NEW.generation > 0 AND NOT coalesce(NEW.draft_change_kind IN ('update', 'correction', 'withdrawal'), false)
          THEN 'a change kind: update, correction or withdrawal'
        WHEN NEW.generation > 0 AND NOT coalesce(NEW.draft_public_note ? tenant.default_locale, false)
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

-- After a change of a quote or checked document: lock its cell and touch it, which the cell's own trigger counts as an
-- edit (checking the lock, bumping the version, adding the contributor). TG_ARGV lists the columns that are not
-- content (attesting, and what the match trigger computes).
CREATE FUNCTION private.cell_content_changed() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    cell uuid := (to_jsonb(coalesce(NEW, OLD)) ->> 'assessment_id')::uuid;
  BEGIN
    IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - TG_ARGV) = (to_jsonb(OLD) - TG_ARGV) THEN
      RETURN NULL;
    END IF;
    PERFORM 1 FROM app.assessments a WHERE a.id = cell FOR UPDATE;
    IF NOT FOUND THEN
      IF TG_OP = 'DELETE' THEN
        RETURN NULL;  -- deleted with its cell
      END IF;
      RAISE EXCEPTION 'cell % is not visible to the writer', cell USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE app.assessments SET state = 'draft' WHERE id = cell;
    RETURN NULL;
  END
  $$;

-- Contributors are added for the current generation only (the policy makes them the current user).
CREATE FUNCTION private.contributor_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    current_generation int;
  BEGIN
    SELECT a.generation INTO current_generation FROM app.assessments a WHERE a.id = NEW.assessment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'cell % is not visible to the writer', NEW.assessment_id USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.generation <> current_generation THEN
      RAISE EXCEPTION 'contributors are added to the current generation of cell %, %', NEW.assessment_id,
        current_generation USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END
  $$;

CREATE TRIGGER rules BEFORE UPDATE ON app.assessments
  FOR EACH ROW EXECUTE FUNCTION private.assessment_transition();
CREATE TRIGGER trail AFTER INSERT OR UPDATE ON app.assessments
  FOR EACH ROW EXECUTE FUNCTION private.assessment_trail();
CREATE TRIGGER content AFTER INSERT OR UPDATE OR DELETE ON app.draft_evidence
  FOR EACH ROW EXECUTE FUNCTION private.cell_content_changed('attested_by', 'match_status', 'matched_from_unit',
                                                             'matched_to_unit');
CREATE TRIGGER content AFTER INSERT OR UPDATE OR DELETE ON app.draft_checked_documents
  FOR EACH ROW EXECUTE FUNCTION private.cell_content_changed();
CREATE TRIGGER rules AFTER INSERT ON app.assessment_contributors
  FOR EACH ROW EXECUTE FUNCTION private.contributor_rules();

-- Members only comment; the workflow trigger writes every other kind of review event.
DROP POLICY member_insert ON app.review_events;
CREATE POLICY member_insert ON app.review_events FOR INSERT TO aiontheballot_admin
  WITH CHECK ((tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
               OR (SELECT private.is_platform_admin()))
              AND (kind = 'commented' OR pg_trigger_depth() > 0));

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
