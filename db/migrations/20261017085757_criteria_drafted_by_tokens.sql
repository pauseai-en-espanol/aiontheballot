-- migrate:up

-- A member's token may now add and edit an election's criteria, in the words a person approved (PLAN R213, Dani's
-- decision; ADR-0008 amended). Criteria were refused to tokens outright, as the chapter's words; drafting them still is
-- a person's, and the MCP server carries only wording they gave it. A token still can't delete a criterion, nor link one
-- to a core criterion (the platform's list for comparing countries). A live election's criteria change only through an
-- approved change, for tokens as for anyone (change_control); RLS keeps editing to editors and country admins.

DROP TRIGGER needs_a_person ON app.criteria;
CREATE TRIGGER needs_a_person BEFORE DELETE ON app.criteria
  FOR EACH ROW EXECUTE FUNCTION private.needs_a_person('delete criteria');
CREATE TRIGGER needs_a_person_to_link BEFORE INSERT ON app.criteria
  FOR EACH ROW WHEN (NEW.core_criterion_id IS NOT NULL)
  EXECUTE FUNCTION private.needs_a_person('link a criterion to a core criterion');
CREATE TRIGGER needs_a_person_to_relink BEFORE UPDATE ON app.criteria
  FOR EACH ROW WHEN (OLD.core_criterion_id IS DISTINCT FROM NEW.core_criterion_id)
  EXECUTE FUNCTION private.needs_a_person('link a criterion to a core criterion');

-- A token proposes changes to a live election itself and to its parties only, as the MCP server always offered: a
-- live election's criteria and methodology change only through what a person proposes. The adversarial review found the
-- API took a token's proposal for them too.
CREATE TRIGGER needs_a_person_to_propose BEFORE INSERT ON app.change_requests
  FOR EACH ROW WHEN (NEW.target_kind IN ('criterion', 'methodology', 'methodology_reviewer'))
  EXECUTE FUNCTION private.needs_a_person('propose a change to criteria or the methodology');

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
