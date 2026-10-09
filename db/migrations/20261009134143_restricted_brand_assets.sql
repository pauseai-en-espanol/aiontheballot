-- migrate:up

-- Restricted brand assets (BRIEF §3; ADR-0002, platform invariants), such as a PauseAI mark:
-- - a tenant may select one only if its operator is a PauseAI chapter and a platform admin granted the asset to it;
-- - an organization may use one as its logo only if it is a PauseAI chapter.
-- Every input is re-checked when it changes: selections, grants, the operator link, is_pauseai_chapter, organization
-- logos and an asset's restricted flag. Deferred, so a platform admin can replace an operator in one transaction.
-- The shared layout re-checks again when rendering (M3).
--
-- The check reads what the writer can see. That covers every write path: country admins only change their own
-- tenant's selections, and see its grants, operator and selected assets; everything else is written by platform
-- admins, who see all of it.
CREATE FUNCTION private.restricted_assets_are_eligible() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    offender text;
  BEGIN
    SELECT format('tenant %s may not use restricted asset %s', s.tenant_id, s.brand_asset_id) INTO offender
      FROM app.tenant_brand_selections s
      JOIN app.brand_assets a ON a.id = s.brand_asset_id
     WHERE a.restricted
       AND NOT (EXISTS (SELECT 1 FROM app.brand_asset_grants g
                         WHERE g.brand_asset_id = s.brand_asset_id AND g.tenant_id = s.tenant_id)
                AND EXISTS (SELECT 1 FROM app.tenant_organizations o
                              JOIN app.organizations org ON org.id = o.organization_id
                             WHERE o.tenant_id = s.tenant_id AND o.role = 'operator' AND org.is_pauseai_chapter))
     LIMIT 1;
    IF offender IS NULL THEN
      SELECT format('organization %s may not use restricted asset %s as its logo', org.id, org.logo_asset_id)
        INTO offender
        FROM app.organizations org
        JOIN app.brand_assets a ON a.id = org.logo_asset_id
       WHERE a.restricted AND NOT org.is_pauseai_chapter
       LIMIT 1;
    END IF;
    IF offender IS NOT NULL THEN
      RAISE EXCEPTION '%', offender USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END
  $$;

CREATE CONSTRAINT TRIGGER restricted_assets_are_eligible AFTER INSERT OR UPDATE ON app.tenant_brand_selections
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.restricted_assets_are_eligible();
CREATE CONSTRAINT TRIGGER restricted_assets_are_eligible AFTER UPDATE OR DELETE ON app.brand_asset_grants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.restricted_assets_are_eligible();
CREATE CONSTRAINT TRIGGER restricted_assets_are_eligible AFTER INSERT OR UPDATE OR DELETE ON app.tenant_organizations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.restricted_assets_are_eligible();
CREATE CONSTRAINT TRIGGER restricted_assets_are_eligible
  AFTER INSERT OR UPDATE OF is_pauseai_chapter, logo_asset_id ON app.organizations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.restricted_assets_are_eligible();
CREATE CONSTRAINT TRIGGER restricted_assets_are_eligible AFTER UPDATE OF restricted ON app.brand_assets
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.restricted_assets_are_eligible();

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
