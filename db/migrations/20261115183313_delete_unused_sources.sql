-- migrate:up

-- Deleting a source nothing rests on (PLAN R228; ADR-0002 §6 and §14 amended). A source whose copy was stored could
-- never go: its extracted text is never deleted (source_texts' guard lets only a purge through), and its job requests
-- and file row named it. A programme uploaded twice, or under the wrong party, stayed for good in an election nobody
-- sees yet. Now private.delete_source(tenant, election, source) deletes a source with its text, its job requests and
-- its file (when nothing else names it; its bytes go with the sweep, ADR-0004), when:
--
-- - the caller writes the site's sources (an editor or country admin, or a platform admin; my_tenants asks for the
--   second factor), in person: never a member's token;
-- - nothing rests on it: no quote or "not mentioned" check, draft or published, and no LLM run;
-- - once its copy is stored, its election is a draft or in preview; a source with no copy goes in any election, as a
--   plain delete did;
-- - it isn't the only source marked as the programme of a party whose programme is published.
--
-- It runs with the owner's rights (SECURITY DEFINER; aiontheballot_admin executes it), since no runtime role deletes
-- text or job requests. The text's guard (forbid_mutation) lets a deletion through only with the owner's rights, for
-- the source a transaction-local flag names, and only while that source may be deleted (private.source_deletable):
-- the flag alone exempts nothing, nor do the owner's rights alone. The function clears the flag before it deletes the
-- source. The deletion is audited as the caller's, as any other.

-- Whether a source may be deleted: nothing rests on it, and once its copy is stored, its election isn't public. Read
-- with the caller's rights (here, the owner's: inside delete_source, and in the text's guard).
CREATE FUNCTION private.source_deletable(source uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT NOT EXISTS (SELECT 1 FROM app.draft_evidence x WHERE x.source_document_id = source)
       AND NOT EXISTS (SELECT 1 FROM app.revision_evidence x WHERE x.source_document_id = source)
       AND NOT EXISTS (SELECT 1 FROM app.draft_checked_documents x WHERE x.source_document_id = source)
       AND NOT EXISTS (SELECT 1 FROM app.revision_checked_documents x WHERE x.source_document_id = source)
       AND NOT EXISTS (SELECT 1 FROM app.llm_runs x WHERE x.source_document_id = source)
       AND EXISTS (SELECT 1 FROM app.source_documents s JOIN app.elections e ON e.id = s.election_id
                    WHERE s.id = source AND (s.file_id IS NULL OR e.status IN ('draft', 'preview')))
  $$;

REVOKE ALL ON FUNCTION private.source_deletable(source uuid) FROM PUBLIC;

-- forbid_mutation as before (migration purge_election), and a source's text deleted with it, through delete_source.
CREATE OR REPLACE FUNCTION private.forbid_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  DECLARE
    table_owner oid := (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID);
  BEGIN
    IF table_owner = (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
      IF (current_setting('app.purge', true) = 'on' AND pg_catalog.pg_has_role(session_user, table_owner, 'MEMBER'))
         OR private.purging_election() THEN
        IF TG_LEVEL = 'ROW' THEN
          RETURN coalesce(NEW, OLD);
        END IF;
        RETURN NULL;
      END IF;
      -- A source's text goes with the source (private.delete_source): only the text of the source the flag names,
      -- and only while that source may be deleted.
      IF TG_TABLE_NAME = 'source_texts' AND TG_OP = 'DELETE' THEN
        IF OLD.source_document_id::text = current_setting('app.delete_source', true)
           AND private.source_deletable(OLD.source_document_id) THEN
          RETURN OLD;
        END IF;
      END IF;
    END IF;
    RAISE EXCEPTION '%.% is immutable: % is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
      USING ERRCODE = 'restrict_violation';
  END
  $$;

CREATE FUNCTION private.delete_source(tenant uuid, election uuid, source uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO ''
  AS $$
  DECLARE
    src record;
  BEGIN
    IF nullif(current_setting('app.token_id', true), '') IS NOT NULL
       OR NOT (tenant IN (SELECT private.my_tenants('country_admin', 'editor')) OR private.is_platform_admin()) THEN
      RAISE EXCEPTION 'deleting a source needs an editor or country admin of its site, in person'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT s.file_id, s.party_id, s.is_programme INTO src FROM app.source_documents s
     WHERE s.tenant_id = tenant AND s.election_id = election AND s.id = source
       FOR UPDATE;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    IF EXISTS (SELECT 1 FROM app.draft_evidence x WHERE x.source_document_id = source)
       OR EXISTS (SELECT 1 FROM app.revision_evidence x WHERE x.source_document_id = source)
       OR EXISTS (SELECT 1 FROM app.draft_checked_documents x WHERE x.source_document_id = source)
       OR EXISTS (SELECT 1 FROM app.revision_checked_documents x WHERE x.source_document_id = source)
       OR EXISTS (SELECT 1 FROM app.llm_runs x WHERE x.source_document_id = source) THEN
      RAISE EXCEPTION 'source % is cited, so it stays: replace it instead', source
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF src.file_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM app.elections e WHERE e.id = election AND e.status IN ('draft', 'preview')) THEN
      RAISE EXCEPTION 'source % has a stored copy and its election is public, so it stays: replace it instead', source
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF src.is_programme
       AND EXISTS (SELECT 1 FROM app.parties p WHERE p.id = src.party_id AND p.programme_status = 'published')
       AND NOT EXISTS (SELECT 1 FROM app.source_documents s
                        WHERE s.party_id = src.party_id AND s.is_programme AND s.id <> source) THEN
      RAISE EXCEPTION 'party %: its published programme needs a source marked as its programme: mark another first',
        src.party_id USING ERRCODE = 'check_violation';
    END IF;

    DELETE FROM app.job_requests j WHERE j.source_document_id = source;
    PERFORM pg_catalog.set_config('app.delete_source', source::text, true);
    DELETE FROM app.source_texts t WHERE t.source_document_id = source;
    PERFORM pg_catalog.set_config('app.delete_source', '', true);
    DELETE FROM app.source_documents s WHERE s.id = source;
    -- Its file, unless another row names it; its bytes go with the sweep (ADR-0004).
    IF src.file_id IS NOT NULL THEN
      DELETE FROM app.files f
       WHERE f.id = src.file_id
         AND NOT EXISTS (SELECT 1 FROM app.source_documents s WHERE s.file_id = f.id)
         AND NOT EXISTS (SELECT 1 FROM app.parties p WHERE p.logo_file_id = f.id)
         AND NOT EXISTS (SELECT 1 FROM app.draft_evidence d WHERE d.attestation_file_id = f.id)
         AND NOT EXISTS (SELECT 1 FROM app.tenant_brand_selections b WHERE b.file_id = f.id);
    END IF;
    RETURN true;
  END
  $$;

REVOKE ALL ON FUNCTION private.delete_source(tenant uuid, election uuid, source uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.delete_source(tenant uuid, election uuid, source uuid) TO aiontheballot_admin;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
