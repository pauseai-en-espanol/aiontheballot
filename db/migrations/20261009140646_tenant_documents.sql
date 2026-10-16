-- migrate:up

-- Policy texts the operator writes (spec §3.1): the privacy policy, the right-of-reply policy and the text about the
-- operator. The legal notice is generated, not stored. Each kind is versioned per tenant; a draft can be edited or
-- deleted, and publishing it freezes it. The public reads the published versions of active tenants (the latest is
-- current; older ones stay as history).

CREATE TABLE app.tenant_documents (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants,
  kind          app.tenant_document_kind NOT NULL,
  version       int NOT NULL,                      -- the next number per tenant and kind, set by trigger
  body          app.localized NOT NULL,            -- Markdown, sanitized on render
  published_at  timestamptz,                       -- null while a draft; set once, at the transaction time
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, kind, version)
);

-- Numbers each new version; keeps a published version as it is, even for the owner; publishing needs text in the
-- tenant's default locale (spec §1, localized text) and takes the transaction time.
CREATE FUNCTION private.tenant_document_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      NEW.version := (SELECT coalesce(max(d.version), 0) + 1 FROM app.tenant_documents d
                       WHERE d.tenant_id = NEW.tenant_id AND d.kind = NEW.kind);
    ELSE
      IF OLD.published_at IS NOT NULL THEN
        RAISE EXCEPTION '% version % is published and never changes', OLD.kind, OLD.version
          USING ERRCODE = 'restrict_violation';
      END IF;
      IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.version IS DISTINCT FROM OLD.version THEN
        RAISE EXCEPTION 'a document keeps its kind and version' USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
    IF NEW.published_at IS NOT NULL THEN
      IF NOT NEW.body ? (SELECT t.default_locale FROM app.tenants t WHERE t.id = NEW.tenant_id) THEN
        RAISE EXCEPTION '% needs text in the tenant''s default locale before it is published', NEW.kind
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.published_at := now();
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.tenant_documents
  FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();
CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.tenant_documents
  FOR EACH ROW EXECUTE FUNCTION private.tenant_document_rules();
CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.tenant_documents
  FOR EACH ROW EXECUTE FUNCTION private.stamp('created_by', 'created_at');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.tenant_documents
  FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER bump_public_version AFTER INSERT OR UPDATE OR DELETE ON app.tenant_documents
  FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();

-- The public reads published versions of active tenants. Members read their tenants' documents; country admins write
-- drafts, publish them, and delete drafts.
ALTER TABLE app.tenant_documents ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON app.tenant_documents TO aiontheballot_web;
CREATE POLICY public_read ON app.tenant_documents FOR SELECT TO aiontheballot_web
  USING (published_at IS NOT NULL AND EXISTS (SELECT 1 FROM app.tenants t WHERE t.id = tenant_id AND t.active));
GRANT SELECT, DELETE, INSERT (tenant_id, kind, body, published_at), UPDATE (body, published_at)
  ON app.tenant_documents TO aiontheballot_admin;
CREATE POLICY member_read ON app.tenant_documents FOR SELECT TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
         OR (SELECT private.is_platform_admin()));
CREATE POLICY country_admin_insert ON app.tenant_documents FOR INSERT TO aiontheballot_admin
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()));
CREATE POLICY country_admin_update ON app.tenant_documents FOR UPDATE TO aiontheballot_admin
  USING ((tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()))
         AND published_at IS NULL)
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()));
CREATE POLICY country_admin_delete ON app.tenant_documents FOR DELETE TO aiontheballot_admin
  USING ((tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()))
         AND published_at IS NULL);

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
