-- migrate:up

-- A member's token may now draft cells (PLAN R232, Dani's decision; ADR-0008 amended): start one, set its draft's
-- rating and summary, add and remove its quotes and the documents checked for "not mentioned". Each one a person
-- accepted in their conversation with the tool, which the database can't tell from one the tool chose alone: the MCP
-- server is told so, and a person still submits every draft for review in the admin, and another publishes it.
--
-- A token never takes a cell through review (submit, recall, reject; publishing stays refused by its own tables),
-- never deletes one, and never decides its recheck flag, the report it answers, or a cell's change kind and public
-- note, which the public reads in its history, whether set on an edit or as the cell is started. An edit of a published
-- cell returns it to draft, as for anyone (assessment_trail): that is drafting too. Its quotes are added and removed,
-- never edited or attested, which is a second person's confirmation (C4), and are recorded as the MCP server's
-- (origin 'mcp', which the revision's provenance keeps), not as typed by a person. The contributors the trail records
-- for an edit are written for a token too, so its member counts for four-eyes, as they would in the admin.

DROP TRIGGER needs_a_person ON app.assessments;
CREATE TRIGGER needs_a_person BEFORE DELETE ON app.assessments
  FOR EACH ROW EXECUTE FUNCTION private.needs_a_person('delete a cell');
CREATE TRIGGER needs_a_person_to_review BEFORE UPDATE ON app.assessments
  FOR EACH ROW WHEN (NEW.state IS DISTINCT FROM OLD.state AND NOT (OLD.state = 'published' AND NEW.state = 'draft'))
  EXECUTE FUNCTION private.needs_a_person('take a cell through review');
CREATE TRIGGER needs_a_person_to_decide BEFORE UPDATE ON app.assessments
  FOR EACH ROW WHEN (NEW.recheck_reason IS DISTINCT FROM OLD.recheck_reason
                     OR NEW.draft_report_id IS DISTINCT FROM OLD.draft_report_id
                     OR NEW.draft_change_kind IS DISTINCT FROM OLD.draft_change_kind
                     OR NEW.draft_public_note IS DISTINCT FROM OLD.draft_public_note)
  EXECUTE FUNCTION private.needs_a_person('decide a cell''s recheck, report or change');
CREATE TRIGGER needs_a_person_to_decide_first BEFORE INSERT ON app.assessments
  FOR EACH ROW WHEN (NEW.recheck_reason IS NOT NULL OR NEW.draft_report_id IS NOT NULL
                     OR NEW.draft_change_kind IS NOT NULL OR NEW.draft_public_note IS NOT NULL)
  EXECUTE FUNCTION private.needs_a_person('decide a cell''s recheck, report or change');

DROP TRIGGER needs_a_person ON app.assessment_contributors;
CREATE TRIGGER needs_a_person BEFORE DELETE OR UPDATE ON app.assessment_contributors
  FOR EACH ROW EXECUTE FUNCTION private.needs_a_person('change assessment_contributors');

DROP TRIGGER needs_a_person ON app.draft_evidence;
CREATE TRIGGER needs_a_person BEFORE UPDATE ON app.draft_evidence
  FOR EACH ROW EXECUTE FUNCTION private.needs_a_person('edit or attest a quote');
CREATE TRIGGER needs_a_person_to_attest BEFORE INSERT ON app.draft_evidence
  FOR EACH ROW WHEN (NEW.attested_by IS NOT NULL OR NEW.attestation_file_id IS NOT NULL
                     OR NEW.llm_suggestion_id IS NOT NULL)
  EXECUTE FUNCTION private.needs_a_person('edit or attest a quote');

CREATE FUNCTION private.quote_by_token() RETURNS trigger
  LANGUAGE plpgsql SET search_path = ''
  AS $$
  BEGIN
    IF coalesce(current_setting('app.token_id', true), '') <> '' THEN
      NEW.origin := 'mcp';
    END IF;
    RETURN NEW;
  END $$;
REVOKE ALL ON FUNCTION private.quote_by_token() FROM PUBLIC;
CREATE TRIGGER origin BEFORE INSERT ON app.draft_evidence
  FOR EACH ROW EXECUTE FUNCTION private.quote_by_token();

DROP TRIGGER needs_a_person ON app.draft_checked_documents;
CREATE TRIGGER needs_a_person BEFORE UPDATE ON app.draft_checked_documents
  FOR EACH ROW EXECUTE FUNCTION private.needs_a_person('change draft_checked_documents');

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
