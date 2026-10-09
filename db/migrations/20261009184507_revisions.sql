-- migrate:up

-- Published revisions (spec §3.6): immutable snapshots of reviewed cells, public in live and archived elections of
-- active tenants, with their full history.
--
-- - Publishing is one INSERT naming the cell and the version reviewed: runtime roles may insert only those two
--   columns of assessment_revisions, and nothing at all into the child tables. The publish trigger (next migration)
--   checks the rules, fills in the revision and copies the reviewed draft; until it exists, no insert can pass.
-- - Nothing here is ever updated or deleted, except by purge_tenant (forbid_mutation).
-- - revision_internal is private: who contributed, who published, whether it was self-reviewed (never shown).
-- - The public reads the sources a public revision cites, only their public columns (spec §5): never the stored copy,
--   its extraction or who added it.

CREATE TABLE app.assessment_revisions (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id         uuid NOT NULL,
  assessment_id     uuid NOT NULL,
  election_id       uuid NOT NULL,
  party_id          uuid NOT NULL,
  criterion_id      uuid NOT NULL,
  reviewed_version  int NOT NULL,
  revision_no       int NOT NULL CHECK (revision_no > 0),
  rating            app.rating,                          -- null only for a withdrawal
  summary           app.localized,                       -- null only for a withdrawal
  change_kind       app.change_kind NOT NULL,
  public_note       app.localized,                       -- required unless change_kind = 'initial'
  published_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, election_id),
  UNIQUE (assessment_id, revision_no),
  CHECK ((change_kind = 'withdrawal') = (rating IS NULL)),
  CHECK (change_kind = 'withdrawal' OR summary IS NOT NULL),
  CHECK ((change_kind = 'initial') = (revision_no = 1)),
  CHECK (change_kind = 'initial' OR public_note IS NOT NULL),
  -- The copied election, party and criterion are the cell's own: public visibility follows election_id.
  FOREIGN KEY (tenant_id, assessment_id, election_id, party_id, criterion_id)
    REFERENCES app.assessments (tenant_id, id, election_id, party_id, criterion_id)
);
CREATE INDEX assessment_revisions_current_idx ON app.assessment_revisions (assessment_id, revision_no DESC);
CREATE INDEX assessment_revisions_election_id_idx ON app.assessment_revisions (election_id);

CREATE TABLE app.revision_evidence (
  revision_id         uuid NOT NULL,
  tenant_id           uuid NOT NULL,
  election_id         uuid NOT NULL,
  ordinal             int NOT NULL,
  source_document_id  uuid NOT NULL,
  quote               text NOT NULL,
  location_label      text,                              -- the matched units' labels, a section, or nothing
  ts_start            numeric(10, 3),                    -- seconds
  ts_end              numeric(10, 3),
  match_status        app.match_status NOT NULL CHECK (match_status IN ('matched', 'attested')),
  PRIMARY KEY (revision_id, ordinal),
  FOREIGN KEY (tenant_id, revision_id, election_id) REFERENCES app.assessment_revisions (tenant_id, id, election_id),
  FOREIGN KEY (tenant_id, election_id, source_document_id)
    REFERENCES app.source_documents (tenant_id, election_id, id)
);
CREATE INDEX revision_evidence_source_document_id_idx ON app.revision_evidence (source_document_id);

CREATE TABLE app.revision_checked_documents (
  revision_id         uuid NOT NULL,
  tenant_id           uuid NOT NULL,
  election_id         uuid NOT NULL,
  source_document_id  uuid NOT NULL,
  checked_at          timestamptz NOT NULL,              -- copied from the draft's check
  PRIMARY KEY (revision_id, source_document_id),
  FOREIGN KEY (tenant_id, revision_id, election_id) REFERENCES app.assessment_revisions (tenant_id, id, election_id),
  FOREIGN KEY (tenant_id, election_id, source_document_id)
    REFERENCES app.source_documents (tenant_id, election_id, id)
);
CREATE INDEX revision_checked_documents_source_document_id_idx ON app.revision_checked_documents (source_document_id);

CREATE TABLE app.revision_internal (
  revision_id      uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL,
  contributor_ids  uuid[] NOT NULL CHECK (cardinality(contributor_ids) > 0),
  reviewer_id      uuid NOT NULL,                        -- the publisher, set by the publish trigger
  self_reviewed    boolean NOT NULL,                     -- private, never shown publicly
  provenance       jsonb NOT NULL,                       -- per quote: author, origin, LLM suggestion, attester
  report_id        uuid,                                 -- the right-of-reply report that prompted it, if any
  CHECK (self_reviewed = (reviewer_id = ANY (contributor_ids))),
  FOREIGN KEY (tenant_id, revision_id) REFERENCES app.assessment_revisions (tenant_id, id),
  FOREIGN KEY (tenant_id, report_id) REFERENCES app.reports (tenant_id, id)
);
CREATE INDEX revision_internal_report_id_idx ON app.revision_internal (report_id);

-- What the public sees of each cell: its latest revision. A cell with none is pending; one whose latest is a
-- withdrawal is withdrawn.
CREATE VIEW app.current_revisions WITH (security_invoker = true) AS
  SELECT DISTINCT ON (r.assessment_id) r.*
    FROM app.assessment_revisions r
   ORDER BY r.assessment_id, r.revision_no DESC;

-- Triggers --------------------------------------------------------------------------------------------------------

CREATE TRIGGER stamp BEFORE INSERT ON app.assessment_revisions
  FOR EACH ROW EXECUTE FUNCTION private.stamp('published_at');

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assessment_revisions', 'revision_evidence', 'revision_checked_documents',
                           'revision_internal'] LOOP
    EXECUTE format('CREATE TRIGGER forbid_mutation BEFORE UPDATE OR DELETE ON app.%I
                      FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation()', t);
    EXECUTE format('CREATE TRIGGER forbid_truncate BEFORE TRUNCATE ON app.%I
                      FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_mutation()', t);
    EXECUTE format('CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.%I
                      FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change()', t);
    EXECUTE format('CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.%I
                      FOR EACH ROW EXECUTE FUNCTION private.audit()', t);
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY member_read ON app.%I FOR SELECT TO aiontheballot_admin
                        USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
                               OR (SELECT private.is_platform_admin()))$p$, t);
  END LOOP;
  -- Public tables, and sources now that revisions cite them, move the public cache key.
  FOREACH t IN ARRAY ARRAY['assessment_revisions', 'revision_evidence', 'revision_checked_documents',
                           'source_documents'] LOOP
    EXECUTE format('CREATE TRIGGER bump_public_version AFTER INSERT OR UPDATE OR DELETE ON app.%I
                      FOR EACH ROW EXECUTE FUNCTION private.bump_public_version()', t);
  END LOOP;
  -- The public reads revisions, and their quotes and checked documents, in live and archived elections (the
  -- elections' own policy adds that the tenant is active).
  FOREACH t IN ARRAY ARRAY['assessment_revisions', 'revision_evidence', 'revision_checked_documents'] LOOP
    EXECUTE format($p$CREATE POLICY public_read ON app.%1$I FOR SELECT TO aiontheballot_web
                        USING (EXISTS (SELECT 1 FROM app.elections e
                                        WHERE e.id = %1$I.election_id AND e.status IN ('live', 'archived')))$p$, t);
  END LOOP;
END
$$;

-- Grants and policies ---------------------------------------------------------------------------------------------

GRANT SELECT ON app.assessment_revisions, app.revision_evidence, app.revision_checked_documents,
                app.current_revisions
  TO aiontheballot_web;
GRANT SELECT ON app.assessment_revisions, app.revision_evidence, app.revision_checked_documents,
                app.revision_internal, app.current_revisions
  TO aiontheballot_admin;

-- Publishing: reviewers and country admins (and platform admins) name the cell and the version they reviewed.
GRANT INSERT (assessment_id, reviewed_version) ON app.assessment_revisions TO aiontheballot_admin;
CREATE POLICY publisher_insert ON app.assessment_revisions FOR INSERT TO aiontheballot_admin
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin', 'reviewer'))
              OR (SELECT private.is_platform_admin()));

-- Sources cited by a public revision: their public columns only.
GRANT SELECT (id, election_id, party_id, kind, title, url, language, is_programme, sha256, retrieved_at, archive_url)
  ON app.source_documents TO aiontheballot_web;
CREATE POLICY public_read ON app.source_documents FOR SELECT TO aiontheballot_web
  USING (EXISTS (SELECT 1 FROM app.revision_evidence r WHERE r.source_document_id = source_documents.id)
         OR EXISTS (SELECT 1 FROM app.revision_checked_documents r WHERE r.source_document_id = source_documents.id));

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
