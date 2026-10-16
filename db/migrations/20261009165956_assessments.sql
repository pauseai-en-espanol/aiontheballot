-- migrate:up

-- Cells: the working copy of each party × criterion assessment (spec §3.5). All private: the public only ever sees
-- published revisions. Editors and country admins write the draft content (rating, summary, change kind and note,
-- quotes, checked documents); every member reads; reviewers may change only what reviewing needs (the cell's state;
-- attesting a quote). The workflow (states, the content lock, contributors) and the evidence rules (verbatim match,
-- attestation, citable sources) are the next two migrations.

CREATE TABLE app.assessments (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id          uuid NOT NULL,
  election_id        uuid NOT NULL,
  party_id           uuid NOT NULL,
  criterion_id       uuid NOT NULL,
  state              app.assessment_state NOT NULL DEFAULT 'draft',
  draft_rating       app.rating,                         -- null for a withdrawal
  draft_summary      app.localized,
  draft_change_kind  app.change_kind,                    -- null before the first publish (it will be 'initial')
  draft_public_note  app.localized,                      -- required for every change after the first
  generation         int NOT NULL DEFAULT 0,             -- publishes so far; contributions count per generation
  content_version    int NOT NULL DEFAULT 0,             -- bumped by every content change, by trigger
  recheck_reason     text,                               -- private flag, e.g. the party's programme appeared
  updated_by         uuid NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, election_id),
  UNIQUE (tenant_id, id, election_id, party_id, criterion_id),
  UNIQUE (party_id, criterion_id),
  FOREIGN KEY (tenant_id, election_id)               REFERENCES app.elections (tenant_id, id),
  FOREIGN KEY (tenant_id, election_id, party_id)     REFERENCES app.parties (tenant_id, election_id, id),
  FOREIGN KEY (tenant_id, election_id, criterion_id) REFERENCES app.criteria (tenant_id, election_id, id)
);
CREATE INDEX assessments_election_id_idx ON app.assessments (election_id);
CREATE INDEX assessments_criterion_id_idx ON app.assessments (criterion_id);

-- Who changed a cell's content in each generation. Rows are added by the content triggers (next migration); a member
-- may add only themselves, which can only stop them approving. Never updated; removed only with a never-published cell.
CREATE TABLE app.assessment_contributors (
  assessment_id  uuid NOT NULL,
  tenant_id      uuid NOT NULL,
  generation     int NOT NULL,
  user_id        uuid NOT NULL,
  first_edit_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assessment_id, generation, user_id),
  FOREIGN KEY (tenant_id, assessment_id) REFERENCES app.assessments (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE app.draft_evidence (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id            uuid NOT NULL,
  election_id          uuid NOT NULL,
  assessment_id        uuid NOT NULL,
  source_document_id   uuid NOT NULL,
  ordinal              int NOT NULL,
  quote                text NOT NULL CHECK (char_length(btrim(quote)) BETWEEN 15 AND 1000),
  unit_index           int,                                 -- the page or section the editor points at (a hint only)
  section_label        text,
  ts_start             numeric(10, 3) CHECK (ts_start >= 0),  -- video and audio, in seconds
  ts_end               numeric(10, 3),
  match_status         app.match_status NOT NULL DEFAULT 'unmatched',  -- computed by trigger, never the caller's
  matched_from_unit    int,
  matched_to_unit      int,
  attested_by          uuid,                                -- set by trigger to the attesting user
  attestation_file_id  uuid,                                -- a screenshot or clip in the sources bucket
  origin               app.evidence_origin NOT NULL DEFAULT 'manual',
  llm_suggestion_id    uuid,
  created_by           uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (assessment_id, ordinal),
  FOREIGN KEY (tenant_id, assessment_id, election_id)
    REFERENCES app.assessments (tenant_id, id, election_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, election_id, source_document_id)
    REFERENCES app.source_documents (tenant_id, election_id, id),
  FOREIGN KEY (tenant_id, attestation_file_id) REFERENCES app.files (tenant_id, id),
  FOREIGN KEY (tenant_id, llm_suggestion_id) REFERENCES app.llm_suggestions (tenant_id, id),
  CHECK ((origin = 'llm') = (llm_suggestion_id IS NOT NULL)),
  CHECK (ts_end IS NULL OR (ts_start IS NOT NULL AND ts_end > ts_start))
);
CREATE INDEX draft_evidence_source_document_id_idx ON app.draft_evidence (source_document_id);
CREATE INDEX draft_evidence_attestation_file_id_idx ON app.draft_evidence (attestation_file_id);
CREATE INDEX draft_evidence_llm_suggestion_id_idx ON app.draft_evidence (llm_suggestion_id);

-- Backs "not mentioned": the proof of an absence is which documents were checked, kept, and when.
CREATE TABLE app.draft_checked_documents (
  assessment_id       uuid NOT NULL,
  tenant_id           uuid NOT NULL,
  election_id         uuid NOT NULL,
  source_document_id  uuid NOT NULL,
  checked_at          timestamptz NOT NULL DEFAULT now(),
  checked_by          uuid NOT NULL,
  PRIMARY KEY (assessment_id, source_document_id),
  FOREIGN KEY (tenant_id, assessment_id, election_id)
    REFERENCES app.assessments (tenant_id, id, election_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, election_id, source_document_id)
    REFERENCES app.source_documents (tenant_id, election_id, id)
);
CREATE INDEX draft_checked_documents_source_document_id_idx ON app.draft_checked_documents (source_document_id);

-- The private review trail: append-only. Comments come from members; the other kinds from the workflow triggers.
CREATE TABLE app.review_events (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id      uuid NOT NULL,
  assessment_id  uuid NOT NULL,
  kind           app.review_event_kind NOT NULL,
  actor_id       uuid NOT NULL,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, assessment_id) REFERENCES app.assessments (tenant_id, id)
);
CREATE INDEX review_events_assessment_id_idx ON app.review_events (assessment_id);

-- Triggers --------------------------------------------------------------------------------------------------------

CREATE TRIGGER editor_columns BEFORE UPDATE ON app.assessments
  FOR EACH ROW EXECUTE FUNCTION private.restrict_columns('country_admin,editor', 'draft_rating', 'draft_summary',
                                                         'draft_change_kind', 'draft_public_note', 'recheck_reason');
CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.assessments
  FOR EACH ROW EXECUTE FUNCTION private.stamp('updated_by', 'updated_at');

CREATE TRIGGER forbid_update BEFORE UPDATE ON app.assessment_contributors
  FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation();
CREATE TRIGGER stamp BEFORE INSERT ON app.assessment_contributors
  FOR EACH ROW EXECUTE FUNCTION private.stamp('first_edit_at');

CREATE TRIGGER editor_columns BEFORE UPDATE ON app.draft_evidence
  FOR EACH ROW EXECUTE FUNCTION private.restrict_columns('country_admin,editor', 'source_document_id', 'ordinal',
                                                         'quote', 'unit_index', 'section_label', 'ts_start', 'ts_end',
                                                         'attestation_file_id');
CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.draft_evidence
  FOR EACH ROW EXECUTE FUNCTION private.stamp('created_by', 'created_at');

CREATE TRIGGER stamp BEFORE INSERT ON app.draft_checked_documents
  FOR EACH ROW EXECUTE FUNCTION private.stamp('checked_by', 'checked_at');

CREATE TRIGGER forbid_mutation BEFORE UPDATE OR DELETE ON app.review_events
  FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation();
CREATE TRIGGER forbid_truncate BEFORE TRUNCATE ON app.review_events
  FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_mutation();
CREATE TRIGGER stamp BEFORE INSERT ON app.review_events
  FOR EACH ROW EXECUTE FUNCTION private.stamp('actor_id', 'created_at');

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assessments', 'assessment_contributors', 'draft_evidence', 'draft_checked_documents',
                           'review_events'] LOOP
    EXECUTE format('CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.%I
                      FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change()', t);
    EXECUTE format('CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.%I
                      FOR EACH ROW EXECUTE FUNCTION private.audit()', t);
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY member_read ON app.%I FOR SELECT TO aiontheballot_admin
                        USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
                               OR (SELECT private.is_platform_admin()))$p$, t);
  END LOOP;
END
$$;

-- Grants and policies ---------------------------------------------------------------------------------------------

-- Cells: editors and country admins create them and delete never-published ones; every member may update (the
-- editor_columns guard keeps reviewers to the state).
GRANT SELECT, DELETE,
      INSERT (tenant_id, election_id, party_id, criterion_id, draft_rating, draft_summary, draft_change_kind,
              draft_public_note),
      UPDATE (state, draft_rating, draft_summary, draft_change_kind, draft_public_note, recheck_reason)
  ON app.assessments TO aiontheballot_admin;
CREATE POLICY editor_insert ON app.assessments FOR INSERT TO aiontheballot_admin
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor'))
              OR (SELECT private.is_platform_admin()));
CREATE POLICY member_update ON app.assessments FOR UPDATE TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
         OR (SELECT private.is_platform_admin()))
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
              OR (SELECT private.is_platform_admin()));
CREATE POLICY editor_delete ON app.assessments FOR DELETE TO aiontheballot_admin
  USING ((tenant_id IN (SELECT private.my_tenants('country_admin', 'editor')) OR (SELECT private.is_platform_admin()))
         AND generation = 0);

-- Contributors: a member adds only themselves.
GRANT SELECT, INSERT (assessment_id, tenant_id, generation, user_id) ON app.assessment_contributors
  TO aiontheballot_admin;
CREATE POLICY self_insert ON app.assessment_contributors FOR INSERT TO aiontheballot_admin
  WITH CHECK ((tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
               OR (SELECT private.is_platform_admin()))
              AND user_id = private.current_user_id());

-- Quotes: editors and country admins write them; any member may update (the guard keeps reviewers to attesting).
GRANT SELECT, DELETE,
      INSERT (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote, unit_index, section_label,
              ts_start, ts_end, attestation_file_id, origin, llm_suggestion_id),
      UPDATE (source_document_id, ordinal, quote, unit_index, section_label, ts_start, ts_end, attestation_file_id,
              attested_by)
  ON app.draft_evidence TO aiontheballot_admin;
CREATE POLICY editor_insert ON app.draft_evidence FOR INSERT TO aiontheballot_admin
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor'))
              OR (SELECT private.is_platform_admin()));
CREATE POLICY member_update ON app.draft_evidence FOR UPDATE TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
         OR (SELECT private.is_platform_admin()))
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
              OR (SELECT private.is_platform_admin()));
CREATE POLICY editor_delete ON app.draft_evidence FOR DELETE TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor')) OR (SELECT private.is_platform_admin()));

-- Checked documents: editors and country admins add and remove them (re-checking is a new row).
GRANT SELECT, DELETE, INSERT (assessment_id, tenant_id, election_id, source_document_id)
  ON app.draft_checked_documents TO aiontheballot_admin;
CREATE POLICY editor_insert ON app.draft_checked_documents FOR INSERT TO aiontheballot_admin
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor'))
              OR (SELECT private.is_platform_admin()));
CREATE POLICY editor_delete ON app.draft_checked_documents FOR DELETE TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor')) OR (SELECT private.is_platform_admin()));

-- Review events: any member comments.
GRANT SELECT, INSERT (tenant_id, assessment_id, kind, note) ON app.review_events TO aiontheballot_admin;
CREATE POLICY member_insert ON app.review_events FOR INSERT TO aiontheballot_admin
  WITH CHECK (tenant_id IN (SELECT private.my_tenants('country_admin', 'editor', 'reviewer'))
              OR (SELECT private.is_platform_admin()));

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
