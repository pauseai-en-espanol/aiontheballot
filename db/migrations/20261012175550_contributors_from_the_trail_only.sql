-- migrate:up

-- A cell's contributors are added only by its trail (private.assessment_trail), as the member whose edit it records,
-- never by a direct insert (PLAN R165, from an RLS review). The policy let any member add themselves to any cell, and
-- a contributor may recall a cell from review with no note (private.assessment_transition): an editor could send
-- someone else's cell back to draft, and a reviewer reject one without the note a rejection needs. The trail inserts
-- from inside its trigger, as the editor, so the policy now asks for that; a member can't create a trigger, so no
-- other path reaches it.
ALTER POLICY self_insert ON app.assessment_contributors
  WITH CHECK (pg_catalog.pg_trigger_depth() > 0
              AND (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
                   OR (SELECT private.is_platform_admin()))
              AND user_id = private.current_user_id());

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
