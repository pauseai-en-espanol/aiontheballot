--
-- PostgreSQL database dump
--

\restrict schema

-- Dumped from database version 18.6 (Debian 18.6-1.pgdg13+2)
-- Dumped by pg_dump version 18.6 (Debian 18.6-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: app; Type: SCHEMA; Schema: -; Owner: aiontheballot_owner
--

CREATE SCHEMA app;


ALTER SCHEMA app OWNER TO aiontheballot_owner;

--
-- Name: private; Type: SCHEMA; Schema: -; Owner: aiontheballot_owner
--

CREATE SCHEMA private;


ALTER SCHEMA private OWNER TO aiontheballot_owner;

--
-- Name: assessment_state; Type: TYPE; Schema: app; Owner: aiontheballot_owner
--

CREATE TYPE app.assessment_state AS ENUM (
    'draft',
    'in_review',
    'published'
);


ALTER TYPE app.assessment_state OWNER TO aiontheballot_owner;

--
-- Name: change_action; Type: TYPE; Schema: app; Owner: aiontheballot_owner
--

CREATE TYPE app.change_action AS ENUM (
    'update',
    'add',
    'retire'
);


ALTER TYPE app.change_action OWNER TO aiontheballot_owner;

--
-- Name: change_kind; Type: TYPE; Schema: app; Owner: aiontheballot_owner
--

CREATE TYPE app.change_kind AS ENUM (
    'initial',
    'update',
    'correction',
    'withdrawal'
);


ALTER TYPE app.change_kind OWNER TO aiontheballot_owner;

--
-- Name: change_request_state; Type: TYPE; Schema: app; Owner: aiontheballot_owner
--

CREATE TYPE app.change_request_state AS ENUM (
    'pending',
    'approved',
    'rejected'
);


ALTER TYPE app.change_request_state OWNER TO aiontheballot_owner;

--
-- Name: election_status; Type: TYPE; Schema: app; Owner: aiontheballot_owner
--

CREATE TYPE app.election_status AS ENUM (
    'draft',
    'live',
    'archived'
);


ALTER TYPE app.election_status OWNER TO aiontheballot_owner;

--
-- Name: election_type; Type: TYPE; Schema: app; Owner: aiontheballot_owner
--

CREATE TYPE app.election_type AS ENUM (
    'general',
    'european',
    'regional',
    'municipal',
    'other'
);


ALTER TYPE app.election_type OWNER TO aiontheballot_owner;

--
-- Name: evidence_origin; Type: TYPE; Schema: app; Owner: aiontheballot_owner
--

CREATE TYPE app.evidence_origin AS ENUM (
    'manual',
    'llm',
    'mcp'
);


ALTER TYPE app.evidence_origin OWNER TO aiontheballot_owner;

--
-- Name: extraction_status; Type: TYPE; Schema: app; Owner: aiontheballot_owner
--

CREATE TYPE app.extraction_status AS ENUM (
    'pending',
    'done',
    'failed',
    'not_applicable'
);


ALTER TYPE app.extraction_status OWNER TO aiontheballot_owner;

--
-- Name: file_bucket; Type: TYPE; Schema: app; Owner: aiontheballot_owner
--

CREATE TYPE app.file_bucket AS ENUM (
    'public_assets',
    'sources'
);


ALTER TYPE app.file_bucket OWNER TO aiontheballot_owner;

--
-- Name: hostname; Type: DOMAIN; Schema: app; Owner: aiontheballot_owner
--

CREATE DOMAIN app.hostname AS text
	CONSTRAINT hostname_check CHECK (((length(VALUE) <= 253) AND (VALUE ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'::text)));


ALTER DOMAIN app.hostname OWNER TO aiontheballot_owner;

--
-- Name: job_kind; Type: TYPE; Schema: app; Owner: aiontheballot_owner
--

CREATE TYPE app.job_kind AS ENUM (
    'fetch_source',
    'extract_source',
    'archive_source',
    'llm_run'
);


ALTER TYPE app.job_kind OWNER TO aiontheballot_owner;

--
-- Name: locale; Type: DOMAIN; Schema: app; Owner: aiontheballot_owner
--

CREATE DOMAIN app.locale AS text
	CONSTRAINT locale_check CHECK ((VALUE ~ '^[a-z]{2}(-[a-z]{2})?$'::text));


ALTER DOMAIN app.locale OWNER TO aiontheballot_owner;

--
-- Name: localized; Type: DOMAIN; Schema: app; Owner: aiontheballot_owner
--

CREATE DOMAIN app.localized AS jsonb
	CONSTRAINT localized_check CHECK (((VALUE IS NULL) OR
CASE
    WHEN (jsonb_typeof(VALUE) = 'object'::text) THEN ((VALUE <> '{}'::jsonb) AND (NOT jsonb_path_exists(VALUE, '$.keyvalue()?(!(@."key" like_regex "^[a-z]{2}(-[a-z]{2})?$"))'::jsonpath)) AND (NOT jsonb_path_exists(VALUE, '$.*?(@.type() != "string" || !(@ like_regex "[^[:space:]]"))'::jsonpath)))
    ELSE false
END));


ALTER DOMAIN app.localized OWNER TO aiontheballot_owner;

--
-- Name: match_status; Type: TYPE; Schema: app; Owner: aiontheballot_owner
--

CREATE TYPE app.match_status AS ENUM (
    'unmatched',
    'matched',
    'attested'
);


ALTER TYPE app.match_status OWNER TO aiontheballot_owner;

--
-- Name: methodology_kind; Type: TYPE; Schema: app; Owner: aiontheballot_owner
--

CREATE TYPE app.methodology_kind AS ENUM (
    'demands',
    'descriptive'
);


ALTER TYPE app.methodology_kind OWNER TO aiontheballot_owner;

--
-- Name: org_role; Type: TYPE; Schema: app; Owner: aiontheballot_owner
--

CREATE TYPE app.org_role AS ENUM (
    'operator',
    'endorser'
);


ALTER TYPE app.org_role OWNER TO aiontheballot_owner;

--
-- Name: programme_status; Type: TYPE; Schema: app; Owner: aiontheballot_owner
--

CREATE TYPE app.programme_status AS ENUM (
    'pending',
    'published'
);


ALTER TYPE app.programme_status OWNER TO aiontheballot_owner;

--
-- Name: rating; Type: TYPE; Schema: app; Owner: aiontheballot_owner
--

CREATE TYPE app.rating AS ENUM (
    'meets',
    'partially_meets',
    'does_not_meet',
    'green',
    'yellow',
    'red',
    'not_mentioned'
);


ALTER TYPE app.rating OWNER TO aiontheballot_owner;

--
-- Name: report_kind; Type: TYPE; Schema: app; Owner: aiontheballot_owner
--

CREATE TYPE app.report_kind AS ENUM (
    'error_report',
    'party_response'
);


ALTER TYPE app.report_kind OWNER TO aiontheballot_owner;

--
-- Name: report_status; Type: TYPE; Schema: app; Owner: aiontheballot_owner
--

CREATE TYPE app.report_status AS ENUM (
    'new',
    'triaged',
    'accepted',
    'rejected',
    'spam'
);


ALTER TYPE app.report_status OWNER TO aiontheballot_owner;

--
-- Name: review_event_kind; Type: TYPE; Schema: app; Owner: aiontheballot_owner
--

CREATE TYPE app.review_event_kind AS ENUM (
    'submitted',
    'recalled',
    'approved',
    'rejected',
    'commented'
);


ALTER TYPE app.review_event_kind OWNER TO aiontheballot_owner;

--
-- Name: slug; Type: DOMAIN; Schema: app; Owner: aiontheballot_owner
--

CREATE DOMAIN app.slug AS text
	CONSTRAINT slug_check CHECK ((VALUE ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text));


ALTER DOMAIN app.slug OWNER TO aiontheballot_owner;

--
-- Name: source_kind; Type: TYPE; Schema: app; Owner: aiontheballot_owner
--

CREATE TYPE app.source_kind AS ENUM (
    'pdf',
    'web_page',
    'social_post',
    'video',
    'audio',
    'party_submission'
);


ALTER TYPE app.source_kind OWNER TO aiontheballot_owner;

--
-- Name: suggestion_state; Type: TYPE; Schema: app; Owner: aiontheballot_owner
--

CREATE TYPE app.suggestion_state AS ENUM (
    'open',
    'accepted',
    'rejected'
);


ALTER TYPE app.suggestion_state OWNER TO aiontheballot_owner;

--
-- Name: tenant_document_kind; Type: TYPE; Schema: app; Owner: aiontheballot_owner
--

CREATE TYPE app.tenant_document_kind AS ENUM (
    'privacy_policy',
    'right_of_reply_policy',
    'about_operator'
);


ALTER TYPE app.tenant_document_kind OWNER TO aiontheballot_owner;

--
-- Name: tenant_role; Type: TYPE; Schema: app; Owner: aiontheballot_owner
--

CREATE TYPE app.tenant_role AS ENUM (
    'country_admin',
    'editor',
    'reviewer'
);


ALTER TYPE app.tenant_role OWNER TO aiontheballot_owner;

--
-- Name: active_tenant_has_operator(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.active_tenant_has_operator() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  DECLARE
    tenant uuid := CASE WHEN TG_TABLE_NAME = 'tenants' THEN (to_jsonb(NEW) ->> 'id')::uuid
                        ELSE (to_jsonb(OLD) ->> 'tenant_id')::uuid END;
  BEGIN
    IF EXISTS (SELECT 1 FROM app.tenants t WHERE t.id = tenant AND t.active)
       AND NOT EXISTS (SELECT 1 FROM app.tenant_organizations o WHERE o.tenant_id = tenant AND o.role = 'operator') THEN
      RAISE EXCEPTION 'tenant % is active, so it needs an operator', tenant USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END
  $$;


ALTER FUNCTION private.active_tenant_has_operator() OWNER TO aiontheballot_owner;

--
-- Name: assessment_trail(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.assessment_trail() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
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


ALTER FUNCTION private.assessment_trail() OWNER TO aiontheballot_owner;

--
-- Name: assessment_transition(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.assessment_transition() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
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


ALTER FUNCTION private.assessment_transition() OWNER TO aiontheballot_owner;

--
-- Name: audit(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.audit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  DECLARE
    before jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
    after jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
    subject jsonb := coalesce(after, before);
    hidden text[];
    key_columns text[];
    changed text[];
    diff jsonb;
  BEGIN
    SELECT coalesce(array_agg(a.attname::text), '{}') INTO hidden
      FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = TG_RELID AND a.attnum > 0 AND NOT a.attisdropped
       AND (a.atttypid = 'pg_catalog.bytea'::pg_catalog.regtype
            OR EXISTS (SELECT 1 FROM pg_catalog.pg_description d
                        WHERE d.objoid = a.attrelid AND d.objsubid = a.attnum
                          AND d.classoid = 'pg_catalog.pg_class'::pg_catalog.regclass
                          AND d.description = 'personal data'));

    SELECT array_agg(a.attname::text ORDER BY k.ord) INTO key_columns
      FROM pg_catalog.pg_index i
     CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY k(attnum, ord)
      JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
     WHERE i.indrelid = TG_RELID AND i.indisprimary;
    IF key_columns IS NULL THEN
      RAISE EXCEPTION 'private.audit on %.%: the table needs a primary key', TG_TABLE_SCHEMA, TG_TABLE_NAME;
    END IF;

    IF TG_OP = 'UPDATE' THEN
      SELECT coalesce(array_agg(n.key), '{}') INTO changed
        FROM jsonb_each(after) n
       WHERE n.value IS DISTINCT FROM before -> n.key;
      IF cardinality(changed) = 0 THEN
        RETURN NULL;
      END IF;
      diff := jsonb_build_object(
        'old', (SELECT coalesce(jsonb_object_agg(o.key, o.value), '{}') FROM jsonb_each(before) o
                 WHERE o.key = ANY (changed) AND NOT o.key = ANY (hidden)),
        'new', (SELECT coalesce(jsonb_object_agg(n.key, n.value), '{}') FROM jsonb_each(after) n
                 WHERE n.key = ANY (changed) AND NOT n.key = ANY (hidden)));
    ELSIF TG_OP = 'INSERT' THEN
      diff := jsonb_build_object('new', after - hidden);
    ELSE
      diff := jsonb_build_object('old', before - hidden);
    END IF;

    INSERT INTO app.audit_log (tenant_id, actor_id, action, table_name, row_id, diff)
    VALUES (
      (CASE WHEN TG_TABLE_SCHEMA = 'app' AND TG_TABLE_NAME = 'tenants' THEN subject ->> 'id'
            ELSE subject ->> 'tenant_id' END)::uuid,
      private.current_user_id(),
      lower(TG_OP),
      TG_TABLE_NAME,
      CASE WHEN cardinality(key_columns) = 1 THEN subject ->> key_columns[1]
           ELSE (SELECT jsonb_object_agg(c, subject -> c) FROM unnest(key_columns) c)::text END,
      diff);
    RETURN NULL;
  END
  $$;


ALTER FUNCTION private.audit() OWNER TO aiontheballot_owner;

--
-- Name: blob_matches_file(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.blob_matches_file() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  DECLARE
    expected_sha text;
    expected_size bigint;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      IF EXISTS (SELECT 1 FROM app.files f WHERE f.id = OLD.file_id) THEN
        RAISE EXCEPTION 'delete file %, not just its bytes', OLD.file_id USING ERRCODE = 'restrict_violation';
      END IF;
      RETURN OLD;
    END IF;
    -- Read as the writer: a file the writer can't see gets no bytes from them.
    SELECT f.sha256, f.byte_size INTO expected_sha, expected_size FROM app.files f WHERE f.id = NEW.file_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'file % is not visible to the writer', NEW.file_id USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF encode(sha256(NEW.content), 'hex') <> expected_sha OR octet_length(NEW.content) <> expected_size THEN
      RAISE EXCEPTION 'the bytes of file % do not match its hash and size', NEW.file_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;


ALTER FUNCTION private.blob_matches_file() OWNER TO aiontheballot_owner;

--
-- Name: bump_public_version(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.bump_public_version() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  DECLARE
    subject jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
    tenants uuid[];
  BEGIN
    tenants := CASE
      WHEN TG_TABLE_SCHEMA = 'app' AND TG_TABLE_NAME = 'tenants' THEN ARRAY[(subject ->> 'id')::uuid]
      WHEN TG_TABLE_SCHEMA = 'app' AND TG_TABLE_NAME = 'organizations' THEN ARRAY(
        SELECT o.tenant_id FROM app.tenant_organizations o WHERE o.organization_id = (subject ->> 'id')::uuid)
      WHEN TG_TABLE_SCHEMA = 'app' AND TG_TABLE_NAME = 'brand_assets' THEN ARRAY(
        SELECT s.tenant_id FROM app.tenant_brand_selections s WHERE s.brand_asset_id = (subject ->> 'id')::uuid
        UNION
        SELECT o.tenant_id FROM app.tenant_organizations o JOIN app.organizations g ON g.id = o.organization_id
         WHERE g.logo_asset_id = (subject ->> 'id')::uuid)
      WHEN TG_TABLE_SCHEMA = 'app' AND TG_TABLE_NAME = 'core_criteria' THEN ARRAY(
        SELECT DISTINCT c.tenant_id FROM app.criteria c WHERE c.core_criterion_id = (subject ->> 'id')::uuid)
      ELSE ARRAY[(subject ->> 'tenant_id')::uuid]
    END;
    IF array_position(tenants, NULL) IS NOT NULL THEN
      RAISE EXCEPTION 'private.bump_public_version on %.%: the row has no tenant', TG_TABLE_SCHEMA, TG_TABLE_NAME;
    END IF;
    INSERT INTO app.public_versions AS v (tenant_id, version)
      SELECT t, 1 FROM unnest(tenants) t
      ON CONFLICT (tenant_id) DO UPDATE SET version = v.version + 1;
    RETURN NULL;
  END
  $$;


ALTER FUNCTION private.bump_public_version() OWNER TO aiontheballot_owner;

--
-- Name: cell_content_changed(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.cell_content_changed() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
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


ALTER FUNCTION private.cell_content_changed() OWNER TO aiontheballot_owner;

--
-- Name: contributor_rules(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.contributor_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
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


ALTER FUNCTION private.contributor_rules() OWNER TO aiontheballot_owner;

--
-- Name: current_aal(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.current_aal() RETURNS integer
    LANGUAGE sql STABLE PARALLEL SAFE
    SET search_path TO ''
    AS $$ SELECT coalesce(nullif(current_setting('app.aal', true), '')::integer, 0) $$;


ALTER FUNCTION private.current_aal() OWNER TO aiontheballot_owner;

--
-- Name: current_user_id(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.current_user_id() RETURNS uuid
    LANGUAGE sql STABLE PARALLEL SAFE
    SET search_path TO ''
    AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;


ALTER FUNCTION private.current_user_id() OWNER TO aiontheballot_owner;

--
-- Name: election_rules(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.election_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  DECLARE
    tenant record;
    missing text;
  BEGIN
    SELECT t.active, t.country_code, t.default_locale INTO tenant FROM app.tenants t WHERE t.id = NEW.tenant_id;
    IF NEW.territory_code IS NOT NULL AND NOT starts_with(NEW.territory_code, tenant.country_code || '-') THEN
      RAISE EXCEPTION 'territory % is outside the tenant''s country, %', NEW.territory_code, tenant.country_code
        USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'INSERT' THEN
      IF NEW.status <> 'draft' THEN
        RAISE EXCEPTION 'a new election is a draft' USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.went_live_at := NULL;
      RETURN NEW;
    END IF;

    IF OLD.status = 'archived' THEN
      RAISE EXCEPTION 'election % is archived and read-only', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'draft' AND NEW.status = 'live' OR OLD.status = 'live' AND NEW.status = 'archived') THEN
      RAISE EXCEPTION 'election % cannot go from % to %', OLD.id, OLD.status, NEW.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status <> 'draft'
       AND (NEW.slug, NEW.type, NEW.territory_code) IS DISTINCT FROM (OLD.slug, OLD.type, OLD.territory_code) THEN
      RAISE EXCEPTION 'election %: the slug, type and territory are fixed once it leaves draft', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;

    IF OLD.status = 'draft' AND NEW.status = 'live' THEN
      missing := CASE
        WHEN NOT tenant.active THEN 'an active tenant'
        WHEN NOT EXISTS (SELECT 1 FROM app.tenant_organizations o
                          WHERE o.tenant_id = NEW.tenant_id AND o.role = 'operator') THEN 'an operator'
        WHEN NOT EXISTS (SELECT 1 FROM app.methodologies m WHERE m.election_id = NEW.id) THEN 'a methodology'
        WHEN NOT NEW.name ? tenant.default_locale THEN 'its name in the default locale'
        WHEN EXISTS (SELECT 1 FROM app.methodologies m
                      WHERE m.election_id = NEW.id AND NOT m.body ? tenant.default_locale)
          THEN 'the methodology in the default locale'
        WHEN EXISTS (SELECT 1 FROM app.parties p
                      WHERE p.election_id = NEW.id
                        AND NOT (p.name ? tenant.default_locale AND p.short_name ? tenant.default_locale))
          THEN 'every party name in the default locale'
        WHEN EXISTS (SELECT 1 FROM app.criteria c
                      WHERE c.election_id = NEW.id
                        AND NOT (c.title ? tenant.default_locale AND c.description ? tenant.default_locale))
          THEN 'every criterion in the default locale'
      END;
      IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'election % cannot go live without %', OLD.id, missing USING ERRCODE = 'check_violation';
      END IF;
      NEW.went_live_at := now();
    ELSE
      NEW.went_live_at := OLD.went_live_at;
    END IF;
    RETURN NEW;
  END
  $$;


ALTER FUNCTION private.election_rules() OWNER TO aiontheballot_owner;

--
-- Name: forbid_mutation(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.forbid_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  BEGIN
    IF current_setting('app.purge', true) = 'on'
       AND (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID)
         = (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
      IF TG_LEVEL = 'ROW' THEN
        RETURN coalesce(NEW, OLD);
      END IF;
      RETURN NULL;
    END IF;
    RAISE EXCEPTION '%.% is immutable: % is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
      USING ERRCODE = 'restrict_violation';
  END
  $$;


ALTER FUNCTION private.forbid_mutation() OWNER TO aiontheballot_owner;

--
-- Name: forbid_tenant_change(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.forbid_tenant_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  BEGIN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'tenant_id of %.% cannot change', TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;


ALTER FUNCTION private.forbid_tenant_change() OWNER TO aiontheballot_owner;

--
-- Name: invitation_transition(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.invitation_transition() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  DECLARE
    decision text[] := ARRAY['accepted_at', 'accepted_by', 'revoked_at'];
  BEGIN
    IF OLD.accepted_at IS NOT NULL OR OLD.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'invitation % is already decided', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF (to_jsonb(NEW) - decision) IS DISTINCT FROM (to_jsonb(OLD) - decision) THEN
      RAISE EXCEPTION 'invitation %: only revoking or accepting it is allowed', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.revoked_at IS NOT NULL AND NEW.accepted_at IS NULL AND NEW.accepted_by IS NULL THEN
      NEW.revoked_at := now();
    ELSIF NEW.revoked_at IS NULL AND (NEW.accepted_at IS NOT NULL OR NEW.accepted_by IS NOT NULL) THEN
      IF OLD.expires_at <= now() THEN
        RAISE EXCEPTION 'invitation % has expired', OLD.id USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.accepted_at := now();
      NEW.accepted_by := private.current_user_id();
    ELSE
      RAISE EXCEPTION 'invitation %: revoke it or accept it', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;


ALTER FUNCTION private.invitation_transition() OWNER TO aiontheballot_owner;

--
-- Name: is_platform_admin(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.is_platform_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
    SELECT private.current_aal() = 2
       AND EXISTS (SELECT 1 FROM app.platform_admins p WHERE p.user_id = private.current_user_id())
  $$;


ALTER FUNCTION private.is_platform_admin() OWNER TO aiontheballot_owner;

--
-- Name: job_request_rules(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.job_request_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  DECLARE
    source record;
    ready boolean;
  BEGIN
    IF TG_OP = 'UPDATE' THEN
      IF OLD.finished_at IS NOT NULL THEN
        RAISE EXCEPTION 'job request % is finished', OLD.id USING ERRCODE = 'restrict_violation';
      END IF;
      IF (to_jsonb(NEW) - 'finished_at') IS DISTINCT FROM (to_jsonb(OLD) - 'finished_at') THEN
        RAISE EXCEPTION 'job request %: only finishing it is allowed', OLD.id USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.finished_at := CASE WHEN NEW.finished_at IS NOT NULL THEN now() END;
      RETURN NEW;
    END IF;

    SELECT s.url, s.file_id, s.extraction_status, s.archive_url INTO source
      FROM app.source_documents s WHERE s.id = NEW.source_document_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'source % is not visible to the requester', NEW.source_document_id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    ready := CASE NEW.kind
      WHEN 'fetch_source' THEN source.url IS NOT NULL AND source.file_id IS NULL
      WHEN 'extract_source' THEN source.file_id IS NOT NULL AND source.extraction_status = 'pending'
      WHEN 'archive_source' THEN source.url IS NOT NULL AND source.archive_url IS NULL
      WHEN 'llm_run' THEN EXISTS (SELECT 1 FROM app.llm_runs r WHERE r.id = NEW.llm_run_id AND r.status = 'queued')
    END;
    IF NOT coalesce(ready, false) THEN
      RAISE EXCEPTION 'a % job has nothing to do for source %', NEW.kind, NEW.source_document_id
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.finished_at := NULL;
    RETURN NEW;
  END
  $$;


ALTER FUNCTION private.job_request_rules() OWNER TO aiontheballot_owner;

--
-- Name: llm_run_rules(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.llm_run_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  DECLARE
    progress text[] := ARRAY['status', 'started_at', 'finished_at', 'input_tokens', 'output_tokens', 'cost_usd',
                             'error'];
    cap numeric;
    spent numeric;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status <> 'queued' THEN
        RAISE EXCEPTION 'a new run is queued' USING ERRCODE = 'restrict_violation';
      END IF;
      -- Read as the writer: a tenant the writer can't see gets no run from them.
      SELECT t.llm_monthly_cap_usd INTO cap FROM app.tenants t WHERE t.id = NEW.tenant_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'tenant % is not visible to the writer', NEW.tenant_id USING ERRCODE = 'insufficient_privilege';
      END IF;
      SELECT coalesce(sum(r.cost_usd), 0) INTO spent
        FROM app.llm_runs r
       WHERE r.tenant_id = NEW.tenant_id AND r.created_at >= date_trunc('month', now(), 'UTC');
      IF coalesce(cap, 0) <= 0 OR spent >= cap THEN
        RAISE EXCEPTION 'LLM assistance is off or this month''s cap is reached for tenant %', NEW.tenant_id
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.started_at := NULL;
      NEW.finished_at := NULL;
      RETURN NEW;
    END IF;

    IF (to_jsonb(NEW) - progress) IS DISTINCT FROM (to_jsonb(OLD) - progress) THEN
      RAISE EXCEPTION 'run %: only its progress changes', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'queued' AND NEW.status = 'running'
                OR OLD.status = 'running' AND NEW.status IN ('done', 'failed')) THEN
      RAISE EXCEPTION 'run % cannot go from % to %', OLD.id, OLD.status, NEW.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    NEW.started_at := CASE WHEN OLD.status = 'queued' AND NEW.status = 'running' THEN now() ELSE OLD.started_at END;
    NEW.finished_at := CASE WHEN OLD.status = 'running' AND NEW.status IN ('done', 'failed') THEN now()
                            ELSE OLD.finished_at END;
    RETURN NEW;
  END
  $$;


ALTER FUNCTION private.llm_run_rules() OWNER TO aiontheballot_owner;

--
-- Name: llm_suggestion_rules(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.llm_suggestion_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  DECLARE
    kind app.methodology_kind;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      SELECT t.methodology_kind INTO kind FROM app.tenants t WHERE t.id = NEW.tenant_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'tenant % is not visible to the writer', NEW.tenant_id USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NOT (CASE kind
                WHEN 'demands' THEN NEW.suggested_rating IN ('meets', 'partially_meets', 'does_not_meet', 'not_mentioned')
                ELSE NEW.suggested_rating IN ('green', 'yellow', 'red', 'not_mentioned')
              END) THEN
        RAISE EXCEPTION 'rating % is not on the % scale', NEW.suggested_rating, kind USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.state <> 'open' THEN
        RAISE EXCEPTION 'a new suggestion is open' USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.decided_by := NULL;
      NEW.decided_at := NULL;
      RETURN NEW;
    END IF;

    IF OLD.state <> 'open' THEN
      RAISE EXCEPTION 'suggestion % is already decided', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF (to_jsonb(NEW) - ARRAY['state', 'decided_by', 'decided_at'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state', 'decided_by', 'decided_at']) THEN
      RAISE EXCEPTION 'suggestion %: only the decision changes', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.state <> 'open' THEN
      NEW.decided_by := private.current_user_id();
      NEW.decided_at := now();
    END IF;
    RETURN NEW;
  END
  $$;


ALTER FUNCTION private.llm_suggestion_rules() OWNER TO aiontheballot_owner;

--
-- Name: members_may_change(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.members_may_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  DECLARE
    open text[] := coalesce(TG_ARGV::text[], '{}') || ARRAY['updated_by', 'updated_at'];
    changed text;
  BEGIN
    SELECT string_agg(n.key, ', ' ORDER BY n.key) INTO changed
      FROM jsonb_each(to_jsonb(NEW) - open) n
     WHERE n.value IS DISTINCT FROM (to_jsonb(OLD) - open) -> n.key;
    IF changed IS NOT NULL AND NOT private.is_platform_admin() THEN
      RAISE EXCEPTION 'only platform admins may change % of %.%', changed, TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END
  $$;


ALTER FUNCTION private.members_may_change() OWNER TO aiontheballot_owner;

--
-- Name: my_tenants(app.tenant_role[]); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.my_tenants(VARIADIC roles app.tenant_role[]) RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
    SELECT m.tenant_id
      FROM app.memberships m
     WHERE private.current_aal() = 2
       AND m.user_id = private.current_user_id()
       AND m.role = ANY (roles)
  $$;


ALTER FUNCTION private.my_tenants(VARIADIC roles app.tenant_role[]) OWNER TO aiontheballot_owner;

--
-- Name: normalize_for_match(text); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.normalize_for_match(input text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO ''
    AS $_$
    SELECT btrim(
      regexp_replace(
        regexp_replace(
          translate(
            replace(normalize(input, NFKC), U&'\00AD', ''),
            U&'\2018\2019\201A\201B\2032\201C\201D\201E\201F\2033\00AB\00BB\2010\2011\2012\2013\2014\2015\2212',
            $map$'''''"""""""-------$map$
          ),
          '([[:alpha:]])-[[:space:]]*\n[[:space:]]*([[:alpha:]])', '\1\2', 'g'
        ),
        '[[:space:]]+', ' ', 'g'
      )
    )
  $_$;


ALTER FUNCTION private.normalize_for_match(input text) OWNER TO aiontheballot_owner;

--
-- Name: party_logo_is_public_asset(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.party_logo_is_public_asset() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  BEGIN
    IF NEW.logo_file_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM app.files f WHERE f.id = NEW.logo_file_id AND f.bucket = 'public_assets') THEN
      RAISE EXCEPTION 'a party logo must be an image in the public_assets bucket' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;


ALTER FUNCTION private.party_logo_is_public_asset() OWNER TO aiontheballot_owner;

--
-- Name: platform_hostname_is_free(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.platform_hostname_is_free() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM app.tenant_hostnames t WHERE t.hostname = NEW.hostname) THEN
      RAISE EXCEPTION 'hostname % already belongs to a tenant', NEW.hostname USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;


ALTER FUNCTION private.platform_hostname_is_free() OWNER TO aiontheballot_owner;

--
-- Name: restrict_columns(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.restrict_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  DECLARE
    roles app.tenant_role[] := CASE WHEN TG_ARGV[0] = '' THEN '{}' ELSE string_to_array(TG_ARGV[0], ',') END;
    guarded text[] := TG_ARGV[1:TG_NARGS - 1];
    changed text;
  BEGIN
    SELECT string_agg(n.key, ', ' ORDER BY n.key) INTO changed
      FROM jsonb_each(to_jsonb(NEW)) n
     WHERE n.key = ANY (guarded) AND n.value IS DISTINCT FROM to_jsonb(OLD) -> n.key;
    IF changed IS NOT NULL
       AND NOT private.is_platform_admin()
       AND (to_jsonb(NEW) ->> 'tenant_id')::uuid NOT IN (SELECT private.my_tenants(VARIADIC roles)) THEN
      RAISE EXCEPTION 'changing % of %.% needs %', changed, TG_TABLE_SCHEMA, TG_TABLE_NAME,
        CASE WHEN cardinality(roles) = 0 THEN 'a platform admin' ELSE array_to_string(roles, ' or ') END
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END
  $$;


ALTER FUNCTION private.restrict_columns() OWNER TO aiontheballot_owner;

--
-- Name: restricted_assets_are_eligible(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.restricted_assets_are_eligible() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
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


ALTER FUNCTION private.restricted_assets_are_eligible() OWNER TO aiontheballot_owner;

--
-- Name: source_document_rules(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.source_document_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  DECLARE
    workflow text[] := ARRAY['extraction_status', 'archive_url'];
    copy record;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.extraction_status <> 'pending' OR NEW.archive_url IS NOT NULL THEN
        RAISE EXCEPTION 'a new source starts pending, with no archive' USING ERRCODE = 'restrict_violation';
      END IF;
    ELSE
      IF OLD.file_id IS NOT NULL AND (to_jsonb(NEW) - workflow) IS DISTINCT FROM (to_jsonb(OLD) - workflow) THEN
        RAISE EXCEPTION 'source % has a stored copy, so it never changes: replace it instead', OLD.id
          USING ERRCODE = 'restrict_violation';
      END IF;
      IF NEW.extraction_status IS DISTINCT FROM OLD.extraction_status AND OLD.extraction_status <> 'pending' THEN
        RAISE EXCEPTION 'the extraction status of source % leaves pending only once', OLD.id
          USING ERRCODE = 'restrict_violation';
      END IF;
      IF OLD.archive_url IS NOT NULL AND NEW.archive_url IS DISTINCT FROM OLD.archive_url THEN
        RAISE EXCEPTION 'the archive of source % is set once', OLD.id USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;

    -- The stored copy, as it is set: the hash comes from the file and the time from the transaction. The file is read
    -- as the writer, so a file the writer can't see is never attached by them.
    IF NEW.file_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.file_id IS NULL) THEN
      SELECT f.sha256, f.bucket INTO copy FROM app.files f WHERE f.id = NEW.file_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'file % is not visible to the writer', NEW.file_id USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF copy.bucket <> 'sources' THEN
        RAISE EXCEPTION 'a source''s copy is a file in the sources bucket' USING ERRCODE = 'check_violation';
      END IF;
      NEW.sha256 := copy.sha256;
      NEW.retrieved_at := now();
    ELSIF NEW.file_id IS NULL THEN
      NEW.sha256 := NULL;
      NEW.retrieved_at := NULL;
    END IF;
    RETURN NEW;
  END
  $$;


ALTER FUNCTION private.source_document_rules() OWNER TO aiontheballot_owner;

--
-- Name: source_text_rules(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.source_text_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM app.source_documents s
                    WHERE s.id = NEW.source_document_id AND s.extraction_status = 'pending' AND s.file_id IS NOT NULL) THEN
      RAISE EXCEPTION 'text is extracted only into a pending source with a stored copy' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END
  $$;


ALTER FUNCTION private.source_text_rules() OWNER TO aiontheballot_owner;

--
-- Name: stamp(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.stamp() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  DECLARE
    col text;
    fresh jsonb := to_jsonb(NEW);
    stamped jsonb := '{}';
  BEGIN
    IF TG_NARGS = 0 THEN
      RAISE EXCEPTION 'private.stamp on %.% needs the columns to stamp', TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    FOREACH col IN ARRAY TG_ARGV LOOP
      IF NOT fresh ? col OR NOT (col LIKE '%\_at' OR col LIKE '%\_by' OR col = 'actor_id') THEN
        RAISE EXCEPTION 'private.stamp on %.%: % is not an actor column or event timestamp of the table',
          TG_TABLE_SCHEMA, TG_TABLE_NAME, col
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
      stamped := stamped || jsonb_build_object(col,
        CASE
          WHEN TG_OP = 'UPDATE' AND col NOT IN ('updated_by', 'updated_at') THEN to_jsonb(OLD) -> col
          WHEN col LIKE '%\_at' THEN to_jsonb(now())
          ELSE to_jsonb(private.current_user_id())
        END);
    END LOOP;
    RETURN jsonb_populate_record(NEW, stamped);
  END
  $$;


ALTER FUNCTION private.stamp() OWNER TO aiontheballot_owner;

--
-- Name: structure_rules(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.structure_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  DECLARE
    fresh jsonb := to_jsonb(NEW);
    tenant uuid := (fresh ->> 'tenant_id')::uuid;
    election_status app.election_status;
    country text;
  BEGIN
    IF TG_TABLE_NAME = 'methodology_reviewers' THEN
      SELECT e.status INTO election_status
        FROM app.methodologies m JOIN app.elections e ON e.id = m.election_id
       WHERE m.id = (fresh ->> 'methodology_id')::uuid;
    ELSE
      SELECT e.status INTO election_status FROM app.elections e WHERE e.id = (fresh ->> 'election_id')::uuid;
    END IF;
    IF election_status IS NULL THEN
      RETURN NEW;
    END IF;

    IF election_status = 'archived' THEN
      RAISE EXCEPTION 'the election of this %.% row is archived and read-only', TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND election_status <> 'draft' AND fresh ? 'slug'
       AND fresh -> 'slug' IS DISTINCT FROM to_jsonb(OLD) -> 'slug' THEN
      RAISE EXCEPTION 'a %.% slug is fixed once its election leaves draft', TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
    END IF;

    IF jsonb_typeof(fresh -> 'territory_codes') = 'array' THEN
      SELECT t.country_code INTO country FROM app.tenants t WHERE t.id = tenant;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(fresh -> 'territory_codes') c
                  WHERE NOT starts_with(c, country || '-')) THEN
        RAISE EXCEPTION 'a party territory is outside the tenant''s country, %', country
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF TG_TABLE_NAME = 'methodologies' THEN
      IF fresh ->> 'kind' IS DISTINCT FROM (SELECT t.methodology_kind::text FROM app.tenants t WHERE t.id = tenant) THEN
        RAISE EXCEPTION 'a methodology uses its tenant''s kind' USING ERRCODE = 'check_violation';
      END IF;
      IF fresh ->> 'demands_owner_id' IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM app.tenant_organizations o
                          WHERE o.tenant_id = tenant AND o.organization_id = (fresh ->> 'demands_owner_id')::uuid) THEN
        RAISE EXCEPTION 'the demands belong to the tenant''s operator or an endorser' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END
  $$;


ALTER FUNCTION private.structure_rules() OWNER TO aiontheballot_owner;

--
-- Name: tenant_dependent_rules(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.tenant_dependent_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  BEGIN
    IF NEW.methodology_kind IS DISTINCT FROM OLD.methodology_kind
       AND EXISTS (SELECT 1 FROM app.methodologies m WHERE m.tenant_id = NEW.id) THEN
      RAISE EXCEPTION 'tenant %: the methodology kind is fixed once a methodology exists', NEW.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.country_code IS DISTINCT FROM OLD.country_code
       AND (EXISTS (SELECT 1 FROM app.elections e
                     WHERE e.tenant_id = NEW.id AND NOT starts_with(e.territory_code, NEW.country_code || '-'))
            OR EXISTS (SELECT 1 FROM app.parties p CROSS JOIN LATERAL unnest(p.territory_codes) c
                        WHERE p.tenant_id = NEW.id AND NOT starts_with(c, NEW.country_code || '-'))) THEN
      RAISE EXCEPTION 'tenant %: its territories use the country code %', NEW.id, OLD.country_code
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;


ALTER FUNCTION private.tenant_dependent_rules() OWNER TO aiontheballot_owner;

--
-- Name: tenant_document_rules(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.tenant_document_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
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


ALTER FUNCTION private.tenant_document_rules() OWNER TO aiontheballot_owner;

--
-- Name: tenant_hostname_rules(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.tenant_hostname_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF EXISTS (SELECT 1 FROM app.platform_hostnames p WHERE p.hostname = NEW.hostname)
         OR EXISTS (SELECT 1 FROM app.hostname_tombstones t WHERE t.hostname = NEW.hostname) THEN
        RAISE EXCEPTION 'hostname % is reserved and can never be claimed', NEW.hostname
          USING ERRCODE = 'restrict_violation';
      END IF;
      IF NEW.retired_at IS NOT NULL THEN
        RAISE EXCEPTION 'hostname % cannot be claimed already retired', NEW.hostname
          USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.verified_at := CASE WHEN NEW.verified_at IS NOT NULL THEN now() END;
      RETURN NEW;
    END IF;

    IF NEW.hostname IS DISTINCT FROM OLD.hostname THEN
      RAISE EXCEPTION 'hostname % cannot be renamed', OLD.hostname USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.verified_at IS NOT NULL AND NEW.verified_at IS DISTINCT FROM OLD.verified_at
       OR OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at THEN
      RAISE EXCEPTION 'hostname %: verification and retirement are set once', OLD.hostname
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.verified_at IS NULL AND NEW.verified_at IS NOT NULL THEN
      NEW.verified_at := now();
    END IF;
    IF OLD.retired_at IS NULL AND NEW.retired_at IS NOT NULL THEN
      NEW.retired_at := now();
    END IF;
    RETURN NEW;
  END
  $$;


ALTER FUNCTION private.tenant_hostname_rules() OWNER TO aiontheballot_owner;

--
-- Name: worker_job_scope(); Type: FUNCTION; Schema: private; Owner: aiontheballot_owner
--

CREATE FUNCTION private.worker_job_scope() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
  DECLARE
    kind app.job_kind;
    allowed text[];
    changed text[];
  BEGIN
    IF current_user <> 'aiontheballot_worker' THEN
      RETURN NEW;
    END IF;
    SELECT r.kind INTO kind FROM app.job_requests r WHERE r.finished_at IS NULL AND r.source_document_id = NEW.id;
    allowed := CASE kind
      WHEN 'fetch_source' THEN ARRAY['file_id', 'file_origin']
      WHEN 'extract_source' THEN ARRAY['extraction_status']
      WHEN 'archive_source' THEN ARRAY['archive_url']
      ELSE '{}'
    END;
    SELECT coalesce(array_agg(n.key), '{}') INTO changed
      FROM jsonb_each(to_jsonb(NEW)) n
     WHERE n.value IS DISTINCT FROM to_jsonb(OLD) -> n.key;
    IF NOT changed <@ allowed OR (kind = 'fetch_source' AND NEW.file_origin IS DISTINCT FROM 'fetched') THEN
      RAISE EXCEPTION 'a % job may not change % of its source', coalesce(kind::text, 'missing'), changed
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END
  $$;


ALTER FUNCTION private.worker_job_scope() OWNER TO aiontheballot_owner;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: assessment_contributors; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.assessment_contributors (
    assessment_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    generation integer NOT NULL,
    user_id uuid NOT NULL,
    first_edit_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE app.assessment_contributors OWNER TO aiontheballot_owner;

--
-- Name: assessments; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.assessments (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    election_id uuid NOT NULL,
    party_id uuid NOT NULL,
    criterion_id uuid NOT NULL,
    state app.assessment_state DEFAULT 'draft'::app.assessment_state NOT NULL,
    draft_rating app.rating,
    draft_summary app.localized,
    draft_change_kind app.change_kind,
    draft_public_note app.localized,
    generation integer DEFAULT 0 NOT NULL,
    content_version integer DEFAULT 0 NOT NULL,
    recheck_reason text,
    updated_by uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE app.assessments OWNER TO aiontheballot_owner;

--
-- Name: audit_log; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.audit_log (
    id bigint NOT NULL,
    tenant_id uuid,
    actor_id uuid,
    action text NOT NULL,
    table_name text NOT NULL,
    row_id text NOT NULL,
    diff jsonb,
    at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE app.audit_log OWNER TO aiontheballot_owner;

--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.audit_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME app.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: brand_asset_grants; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.brand_asset_grants (
    brand_asset_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    granted_by uuid NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE app.brand_asset_grants OWNER TO aiontheballot_owner;

--
-- Name: brand_assets; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.brand_assets (
    id uuid DEFAULT uuidv7() NOT NULL,
    name text NOT NULL,
    restricted boolean DEFAULT false NOT NULL,
    content_type text NOT NULL,
    sha256 text NOT NULL,
    content bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT brand_assets_check CHECK ((sha256 = encode(sha256(content), 'hex'::text))),
    CONSTRAINT brand_assets_content_check CHECK ((octet_length(content) <= 2097152)),
    CONSTRAINT brand_assets_content_type_check CHECK ((content_type = ANY (ARRAY['image/png'::text, 'image/jpeg'::text, 'image/webp'::text])))
);


ALTER TABLE app.brand_assets OWNER TO aiontheballot_owner;

--
-- Name: core_criteria; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.core_criteria (
    id uuid DEFAULT uuidv7() NOT NULL,
    key app.slug NOT NULL,
    title app.localized NOT NULL,
    description app.localized NOT NULL
);


ALTER TABLE app.core_criteria OWNER TO aiontheballot_owner;

--
-- Name: criteria; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.criteria (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    election_id uuid NOT NULL,
    slug app.slug NOT NULL,
    title app.localized NOT NULL,
    description app.localized NOT NULL,
    display_order integer NOT NULL,
    core_criterion_id uuid,
    retired_at timestamp with time zone
);


ALTER TABLE app.criteria OWNER TO aiontheballot_owner;

--
-- Name: draft_checked_documents; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.draft_checked_documents (
    assessment_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    election_id uuid NOT NULL,
    source_document_id uuid NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    checked_by uuid NOT NULL
);


ALTER TABLE app.draft_checked_documents OWNER TO aiontheballot_owner;

--
-- Name: draft_evidence; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.draft_evidence (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    election_id uuid NOT NULL,
    assessment_id uuid NOT NULL,
    source_document_id uuid NOT NULL,
    ordinal integer NOT NULL,
    quote text NOT NULL,
    unit_index integer,
    section_label text,
    ts_start numeric(10,3),
    ts_end numeric(10,3),
    match_status app.match_status DEFAULT 'unmatched'::app.match_status NOT NULL,
    matched_from_unit integer,
    matched_to_unit integer,
    attested_by uuid,
    attestation_file_id uuid,
    origin app.evidence_origin DEFAULT 'manual'::app.evidence_origin NOT NULL,
    llm_suggestion_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT draft_evidence_check CHECK (((origin = 'llm'::app.evidence_origin) = (llm_suggestion_id IS NOT NULL))),
    CONSTRAINT draft_evidence_check1 CHECK (((ts_end IS NULL) OR ((ts_start IS NOT NULL) AND (ts_end > ts_start)))),
    CONSTRAINT draft_evidence_quote_check CHECK (((char_length(btrim(quote)) >= 15) AND (char_length(btrim(quote)) <= 1000))),
    CONSTRAINT draft_evidence_ts_start_check CHECK ((ts_start >= (0)::numeric))
);


ALTER TABLE app.draft_evidence OWNER TO aiontheballot_owner;

--
-- Name: elections; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.elections (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    slug app.slug NOT NULL,
    type app.election_type NOT NULL,
    territory_code text,
    name app.localized NOT NULL,
    election_date date,
    status app.election_status DEFAULT 'draft'::app.election_status NOT NULL,
    went_live_at timestamp with time zone,
    require_second_reviewer boolean DEFAULT true NOT NULL,
    frozen_from timestamp with time zone,
    frozen_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT elections_check CHECK (((type <> ALL (ARRAY['general'::app.election_type, 'european'::app.election_type])) OR (territory_code IS NULL))),
    CONSTRAINT elections_check1 CHECK (((type <> 'regional'::app.election_type) OR (territory_code IS NOT NULL))),
    CONSTRAINT elections_check2 CHECK (((frozen_until IS NULL) OR ((frozen_from IS NOT NULL) AND (frozen_until > frozen_from)))),
    CONSTRAINT elections_slug_check CHECK (((slug)::text !~ '^[a-z]{2}(-[a-z]{2})?$'::text)),
    CONSTRAINT elections_territory_code_check CHECK ((territory_code ~ '^[A-Z]{2}-[A-Z0-9]{1,3}$'::text))
);


ALTER TABLE app.elections OWNER TO aiontheballot_owner;

--
-- Name: file_blobs; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.file_blobs (
    file_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    content bytea NOT NULL
);


ALTER TABLE app.file_blobs OWNER TO aiontheballot_owner;

--
-- Name: files; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.files (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    bucket app.file_bucket NOT NULL,
    content_type text NOT NULL,
    byte_size bigint NOT NULL,
    sha256 text NOT NULL,
    original_filename text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT files_byte_size_check CHECK (((byte_size >= 0) AND (byte_size <= 52428800))),
    CONSTRAINT files_check CHECK (((bucket <> 'public_assets'::app.file_bucket) OR (content_type = ANY (ARRAY['image/png'::text, 'image/jpeg'::text, 'image/webp'::text])))),
    CONSTRAINT files_content_type_check CHECK ((content_type ~ '^[a-z]+/[a-z0-9.+-]+$'::text)),
    CONSTRAINT files_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text))
);


ALTER TABLE app.files OWNER TO aiontheballot_owner;

--
-- Name: COLUMN files.original_filename; Type: COMMENT; Schema: app; Owner: aiontheballot_owner
--

COMMENT ON COLUMN app.files.original_filename IS 'personal data';


--
-- Name: hostname_tombstones; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.hostname_tombstones (
    hostname app.hostname NOT NULL,
    purged_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE app.hostname_tombstones OWNER TO aiontheballot_owner;

--
-- Name: hostname_verifications; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.hostname_verifications (
    hostname app.hostname NOT NULL,
    token_hash text NOT NULL,
    last_checked_at timestamp with time zone,
    last_result text,
    CONSTRAINT hostname_verifications_token_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
);


ALTER TABLE app.hostname_verifications OWNER TO aiontheballot_owner;

--
-- Name: invitations; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.invitations (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    email text NOT NULL,
    role app.tenant_role NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_at timestamp with time zone,
    accepted_by uuid,
    revoked_at timestamp with time zone,
    CONSTRAINT invitations_check CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '30 days'::interval)))),
    CONSTRAINT invitations_check1 CHECK (((accepted_at IS NULL) = (accepted_by IS NULL))),
    CONSTRAINT invitations_check2 CHECK (((accepted_at IS NULL) OR (revoked_at IS NULL))),
    CONSTRAINT invitations_email_check CHECK (((email = lower(email)) AND (email ~ '^[^@[:space:]]+@[^@[:space:]]+$'::text))),
    CONSTRAINT invitations_token_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
);


ALTER TABLE app.invitations OWNER TO aiontheballot_owner;

--
-- Name: COLUMN invitations.email; Type: COMMENT; Schema: app; Owner: aiontheballot_owner
--

COMMENT ON COLUMN app.invitations.email IS 'personal data';


--
-- Name: job_requests; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.job_requests (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    kind app.job_kind NOT NULL,
    source_document_id uuid NOT NULL,
    llm_run_id uuid,
    requested_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT job_requests_check CHECK (((kind = 'llm_run'::app.job_kind) = (llm_run_id IS NOT NULL)))
);


ALTER TABLE app.job_requests OWNER TO aiontheballot_owner;

--
-- Name: llm_runs; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.llm_runs (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    election_id uuid NOT NULL,
    source_document_id uuid NOT NULL,
    requested_by uuid NOT NULL,
    model text NOT NULL,
    prompt_version text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    input_tokens integer,
    output_tokens integer,
    cost_usd numeric(10,4),
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT llm_runs_cost_usd_check CHECK ((cost_usd >= (0)::numeric)),
    CONSTRAINT llm_runs_input_tokens_check CHECK ((input_tokens >= 0)),
    CONSTRAINT llm_runs_output_tokens_check CHECK ((output_tokens >= 0)),
    CONSTRAINT llm_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'done'::text, 'failed'::text])))
);


ALTER TABLE app.llm_runs OWNER TO aiontheballot_owner;

--
-- Name: llm_suggestions; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.llm_suggestions (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    election_id uuid NOT NULL,
    run_id uuid NOT NULL,
    party_id uuid NOT NULL,
    criterion_id uuid NOT NULL,
    suggested_rating app.rating NOT NULL,
    rationale text NOT NULL,
    passages jsonb NOT NULL,
    state app.suggestion_state DEFAULT 'open'::app.suggestion_state NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    CONSTRAINT llm_suggestions_check CHECK ((((state = 'open'::app.suggestion_state) = (decided_at IS NULL)) AND ((decided_at IS NULL) = (decided_by IS NULL)))),
    CONSTRAINT llm_suggestions_passages_check CHECK ((jsonb_typeof(passages) = 'array'::text))
);


ALTER TABLE app.llm_suggestions OWNER TO aiontheballot_owner;

--
-- Name: memberships; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.memberships (
    user_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    role app.tenant_role NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE app.memberships OWNER TO aiontheballot_owner;

--
-- Name: methodologies; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.methodologies (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    election_id uuid NOT NULL,
    kind app.methodology_kind NOT NULL,
    demands_owner_id uuid,
    body app.localized NOT NULL,
    admissible_source_kinds app.source_kind[] DEFAULT '{pdf,web_page}'::app.source_kind[] NOT NULL,
    not_mentioned_source_kinds app.source_kind[] DEFAULT '{pdf,web_page}'::app.source_kind[] NOT NULL,
    CONSTRAINT methodologies_check CHECK (((kind = 'demands'::app.methodology_kind) = (demands_owner_id IS NOT NULL))),
    CONSTRAINT methodologies_check1 CHECK (((cardinality(admissible_source_kinds) > 0) AND (cardinality(not_mentioned_source_kinds) > 0)))
);


ALTER TABLE app.methodologies OWNER TO aiontheballot_owner;

--
-- Name: methodology_reviewers; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.methodology_reviewers (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    methodology_id uuid NOT NULL,
    name text NOT NULL,
    affiliation text NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    retired_at timestamp with time zone
);


ALTER TABLE app.methodology_reviewers OWNER TO aiontheballot_owner;

--
-- Name: COLUMN methodology_reviewers.name; Type: COMMENT; Schema: app; Owner: aiontheballot_owner
--

COMMENT ON COLUMN app.methodology_reviewers.name IS 'personal data';


--
-- Name: organizations; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.organizations (
    id uuid DEFAULT uuidv7() NOT NULL,
    display_name app.localized NOT NULL,
    legal_name text NOT NULL,
    tax_id text,
    address text,
    registry_entry text,
    contact_email text,
    privacy_email text,
    url text,
    logo_asset_id uuid,
    is_pauseai_chapter boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organizations_contact_email_check CHECK (((contact_email = lower(contact_email)) AND (contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'::text))),
    CONSTRAINT organizations_privacy_email_check CHECK (((privacy_email = lower(privacy_email)) AND (privacy_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'::text))),
    CONSTRAINT organizations_url_check CHECK ((url ~ '^https://'::text))
);


ALTER TABLE app.organizations OWNER TO aiontheballot_owner;

--
-- Name: parties; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.parties (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    election_id uuid NOT NULL,
    slug app.slug NOT NULL,
    name app.localized NOT NULL,
    short_name app.localized NOT NULL,
    logo_file_id uuid,
    colour text,
    display_order integer NOT NULL,
    website text,
    programme_status app.programme_status DEFAULT 'pending'::app.programme_status NOT NULL,
    programme_checked_at timestamp with time zone,
    territory_codes text[],
    retired_at timestamp with time zone,
    CONSTRAINT parties_colour_check CHECK ((colour ~ '^#[0-9a-f]{6}$'::text)),
    CONSTRAINT parties_territory_codes_check CHECK (((cardinality(territory_codes) > 0) AND (array_to_string(territory_codes, ','::text) ~ '^[A-Z]{2}-[A-Z0-9]{1,3}(,[A-Z]{2}-[A-Z0-9]{1,3})*$'::text))),
    CONSTRAINT parties_website_check CHECK ((website ~ '^https?://'::text))
);


ALTER TABLE app.parties OWNER TO aiontheballot_owner;

--
-- Name: platform_admins; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.platform_admins (
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE app.platform_admins OWNER TO aiontheballot_owner;

--
-- Name: platform_hostnames; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.platform_hostnames (
    hostname app.hostname NOT NULL
);


ALTER TABLE app.platform_hostnames OWNER TO aiontheballot_owner;

--
-- Name: public_versions; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.public_versions (
    tenant_id uuid NOT NULL,
    version bigint DEFAULT 0 NOT NULL
);


ALTER TABLE app.public_versions OWNER TO aiontheballot_owner;

--
-- Name: review_events; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.review_events (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    assessment_id uuid NOT NULL,
    kind app.review_event_kind NOT NULL,
    actor_id uuid NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE app.review_events OWNER TO aiontheballot_owner;

--
-- Name: source_documents; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.source_documents (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    election_id uuid NOT NULL,
    party_id uuid,
    kind app.source_kind NOT NULL,
    title text NOT NULL,
    url text,
    language app.locale,
    is_programme boolean DEFAULT false NOT NULL,
    file_id uuid,
    file_origin text,
    sha256 text,
    retrieved_at timestamp with time zone,
    archive_url text,
    extraction_status app.extraction_status DEFAULT 'pending'::app.extraction_status NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT source_documents_archive_url_check CHECK ((archive_url ~ '^https://'::text)),
    CONSTRAINT source_documents_check CHECK ((((file_id IS NULL) = (file_origin IS NULL)) AND ((file_id IS NULL) = (sha256 IS NULL)))),
    CONSTRAINT source_documents_check1 CHECK (((file_id IS NULL) = (retrieved_at IS NULL))),
    CONSTRAINT source_documents_check2 CHECK (((NOT is_programme) OR (party_id IS NOT NULL))),
    CONSTRAINT source_documents_check3 CHECK (((extraction_status <> 'done'::app.extraction_status) OR (file_id IS NOT NULL))),
    CONSTRAINT source_documents_file_origin_check CHECK ((file_origin = ANY (ARRAY['fetched'::text, 'uploaded'::text]))),
    CONSTRAINT source_documents_url_check CHECK ((url ~ '^https?://'::text))
);


ALTER TABLE app.source_documents OWNER TO aiontheballot_owner;

--
-- Name: source_texts; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.source_texts (
    source_document_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    unit_index integer NOT NULL,
    label text NOT NULL,
    body text NOT NULL,
    normalized text GENERATED ALWAYS AS (private.normalize_for_match(body)) STORED,
    CONSTRAINT source_texts_unit_index_check CHECK ((unit_index > 0))
);


ALTER TABLE app.source_texts OWNER TO aiontheballot_owner;

--
-- Name: tenant_brand_selections; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.tenant_brand_selections (
    tenant_id uuid NOT NULL,
    slot text NOT NULL,
    brand_asset_id uuid NOT NULL,
    CONSTRAINT tenant_brand_selections_slot_check CHECK ((slot ~ '^[a-z]+(_[a-z]+)*$'::text))
);


ALTER TABLE app.tenant_brand_selections OWNER TO aiontheballot_owner;

--
-- Name: tenant_documents; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.tenant_documents (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    kind app.tenant_document_kind NOT NULL,
    version integer NOT NULL,
    body app.localized NOT NULL,
    published_at timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE app.tenant_documents OWNER TO aiontheballot_owner;

--
-- Name: tenant_hostnames; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.tenant_hostnames (
    hostname app.hostname NOT NULL,
    tenant_id uuid NOT NULL,
    is_canonical boolean DEFAULT false NOT NULL,
    verified_at timestamp with time zone,
    retired_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_hostnames_check CHECK (((NOT is_canonical) OR (verified_at IS NOT NULL))),
    CONSTRAINT tenant_hostnames_check1 CHECK ((NOT (is_canonical AND (retired_at IS NOT NULL))))
);


ALTER TABLE app.tenant_hostnames OWNER TO aiontheballot_owner;

--
-- Name: tenant_organizations; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.tenant_organizations (
    tenant_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    role app.org_role NOT NULL,
    display_order integer DEFAULT 0 NOT NULL
);


ALTER TABLE app.tenant_organizations OWNER TO aiontheballot_owner;

--
-- Name: tenants; Type: TABLE; Schema: app; Owner: aiontheballot_owner
--

CREATE TABLE app.tenants (
    id uuid DEFAULT uuidv7() NOT NULL,
    slug app.slug NOT NULL,
    country_code text NOT NULL,
    default_locale app.locale NOT NULL,
    enabled_locales app.locale[] NOT NULL,
    display_name app.localized NOT NULL,
    theme jsonb DEFAULT '{}'::jsonb NOT NULL,
    methodology_kind app.methodology_kind NOT NULL,
    active boolean DEFAULT false NOT NULL,
    live_edits_need_second_approver boolean DEFAULT false NOT NULL,
    report_retention_days integer NOT NULL,
    llm_monthly_cap_usd numeric(10,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenants_check CHECK (((default_locale)::text = ANY ((enabled_locales)::text[]))),
    CONSTRAINT tenants_country_code_check CHECK ((country_code ~ '^[A-Z]{2}$'::text)),
    CONSTRAINT tenants_llm_monthly_cap_usd_check CHECK ((llm_monthly_cap_usd >= (0)::numeric)),
    CONSTRAINT tenants_report_retention_days_check CHECK ((report_retention_days > 0)),
    CONSTRAINT theme_is_colours CHECK (
CASE
    WHEN (jsonb_typeof(theme) = 'object'::text) THEN (NOT jsonb_path_exists(theme, '$.keyvalue()?((!(@."key" like_regex "^[a-z]+(_[a-z]+)*$") || @."value".type() != "string") || !(@."value" like_regex "^#[0-9a-f]{6}$"))'::jsonpath))
    ELSE false
END)
);


ALTER TABLE app.tenants OWNER TO aiontheballot_owner;

--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: aiontheballot_owner
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


ALTER TABLE public.schema_migrations OWNER TO aiontheballot_owner;

--
-- Name: assessment_contributors assessment_contributors_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.assessment_contributors
    ADD CONSTRAINT assessment_contributors_pkey PRIMARY KEY (assessment_id, generation, user_id);


--
-- Name: assessments assessments_party_id_criterion_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.assessments
    ADD CONSTRAINT assessments_party_id_criterion_id_key UNIQUE (party_id, criterion_id);


--
-- Name: assessments assessments_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.assessments
    ADD CONSTRAINT assessments_pkey PRIMARY KEY (id);


--
-- Name: assessments assessments_tenant_id_id_election_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.assessments
    ADD CONSTRAINT assessments_tenant_id_id_election_id_key UNIQUE (tenant_id, id, election_id);


--
-- Name: assessments assessments_tenant_id_id_election_id_party_id_criterion_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.assessments
    ADD CONSTRAINT assessments_tenant_id_id_election_id_party_id_criterion_id_key UNIQUE (tenant_id, id, election_id, party_id, criterion_id);


--
-- Name: assessments assessments_tenant_id_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.assessments
    ADD CONSTRAINT assessments_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: brand_asset_grants brand_asset_grants_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.brand_asset_grants
    ADD CONSTRAINT brand_asset_grants_pkey PRIMARY KEY (brand_asset_id, tenant_id);


--
-- Name: brand_assets brand_assets_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.brand_assets
    ADD CONSTRAINT brand_assets_pkey PRIMARY KEY (id);


--
-- Name: core_criteria core_criteria_key_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.core_criteria
    ADD CONSTRAINT core_criteria_key_key UNIQUE (key);


--
-- Name: core_criteria core_criteria_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.core_criteria
    ADD CONSTRAINT core_criteria_pkey PRIMARY KEY (id);


--
-- Name: criteria criteria_election_id_slug_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.criteria
    ADD CONSTRAINT criteria_election_id_slug_key UNIQUE (election_id, slug);


--
-- Name: criteria criteria_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.criteria
    ADD CONSTRAINT criteria_pkey PRIMARY KEY (id);


--
-- Name: criteria criteria_tenant_id_election_id_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.criteria
    ADD CONSTRAINT criteria_tenant_id_election_id_id_key UNIQUE (tenant_id, election_id, id);


--
-- Name: criteria criteria_tenant_id_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.criteria
    ADD CONSTRAINT criteria_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: draft_checked_documents draft_checked_documents_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.draft_checked_documents
    ADD CONSTRAINT draft_checked_documents_pkey PRIMARY KEY (assessment_id, source_document_id);


--
-- Name: draft_evidence draft_evidence_assessment_id_ordinal_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.draft_evidence
    ADD CONSTRAINT draft_evidence_assessment_id_ordinal_key UNIQUE (assessment_id, ordinal);


--
-- Name: draft_evidence draft_evidence_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.draft_evidence
    ADD CONSTRAINT draft_evidence_pkey PRIMARY KEY (id);


--
-- Name: draft_evidence draft_evidence_tenant_id_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.draft_evidence
    ADD CONSTRAINT draft_evidence_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: elections elections_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.elections
    ADD CONSTRAINT elections_pkey PRIMARY KEY (id);


--
-- Name: elections elections_tenant_id_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.elections
    ADD CONSTRAINT elections_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: elections elections_tenant_id_slug_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.elections
    ADD CONSTRAINT elections_tenant_id_slug_key UNIQUE (tenant_id, slug);


--
-- Name: file_blobs file_blobs_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.file_blobs
    ADD CONSTRAINT file_blobs_pkey PRIMARY KEY (file_id);


--
-- Name: files files_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.files
    ADD CONSTRAINT files_pkey PRIMARY KEY (id);


--
-- Name: files files_tenant_id_bucket_sha256_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.files
    ADD CONSTRAINT files_tenant_id_bucket_sha256_key UNIQUE (tenant_id, bucket, sha256);


--
-- Name: files files_tenant_id_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.files
    ADD CONSTRAINT files_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: hostname_tombstones hostname_tombstones_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.hostname_tombstones
    ADD CONSTRAINT hostname_tombstones_pkey PRIMARY KEY (hostname);


--
-- Name: hostname_verifications hostname_verifications_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.hostname_verifications
    ADD CONSTRAINT hostname_verifications_pkey PRIMARY KEY (hostname);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_tenant_id_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.invitations
    ADD CONSTRAINT invitations_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: invitations invitations_token_hash_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.invitations
    ADD CONSTRAINT invitations_token_hash_key UNIQUE (token_hash);


--
-- Name: job_requests job_requests_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.job_requests
    ADD CONSTRAINT job_requests_pkey PRIMARY KEY (id);


--
-- Name: job_requests job_requests_tenant_id_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.job_requests
    ADD CONSTRAINT job_requests_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: llm_runs llm_runs_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.llm_runs
    ADD CONSTRAINT llm_runs_pkey PRIMARY KEY (id);


--
-- Name: llm_runs llm_runs_tenant_id_id_election_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.llm_runs
    ADD CONSTRAINT llm_runs_tenant_id_id_election_id_key UNIQUE (tenant_id, id, election_id);


--
-- Name: llm_runs llm_runs_tenant_id_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.llm_runs
    ADD CONSTRAINT llm_runs_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: llm_runs llm_runs_tenant_id_id_source_document_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.llm_runs
    ADD CONSTRAINT llm_runs_tenant_id_id_source_document_id_key UNIQUE (tenant_id, id, source_document_id);


--
-- Name: llm_suggestions llm_suggestions_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.llm_suggestions
    ADD CONSTRAINT llm_suggestions_pkey PRIMARY KEY (id);


--
-- Name: llm_suggestions llm_suggestions_tenant_id_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.llm_suggestions
    ADD CONSTRAINT llm_suggestions_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: memberships memberships_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.memberships
    ADD CONSTRAINT memberships_pkey PRIMARY KEY (user_id, tenant_id, role);


--
-- Name: methodologies methodologies_election_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.methodologies
    ADD CONSTRAINT methodologies_election_id_key UNIQUE (election_id);


--
-- Name: methodologies methodologies_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.methodologies
    ADD CONSTRAINT methodologies_pkey PRIMARY KEY (id);


--
-- Name: methodologies methodologies_tenant_id_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.methodologies
    ADD CONSTRAINT methodologies_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: methodology_reviewers methodology_reviewers_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.methodology_reviewers
    ADD CONSTRAINT methodology_reviewers_pkey PRIMARY KEY (id);


--
-- Name: methodology_reviewers methodology_reviewers_tenant_id_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.methodology_reviewers
    ADD CONSTRAINT methodology_reviewers_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: parties parties_election_id_slug_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.parties
    ADD CONSTRAINT parties_election_id_slug_key UNIQUE (election_id, slug);


--
-- Name: parties parties_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.parties
    ADD CONSTRAINT parties_pkey PRIMARY KEY (id);


--
-- Name: parties parties_tenant_id_election_id_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.parties
    ADD CONSTRAINT parties_tenant_id_election_id_id_key UNIQUE (tenant_id, election_id, id);


--
-- Name: parties parties_tenant_id_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.parties
    ADD CONSTRAINT parties_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: platform_admins platform_admins_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.platform_admins
    ADD CONSTRAINT platform_admins_pkey PRIMARY KEY (user_id);


--
-- Name: platform_hostnames platform_hostnames_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.platform_hostnames
    ADD CONSTRAINT platform_hostnames_pkey PRIMARY KEY (hostname);


--
-- Name: public_versions public_versions_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.public_versions
    ADD CONSTRAINT public_versions_pkey PRIMARY KEY (tenant_id);


--
-- Name: review_events review_events_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.review_events
    ADD CONSTRAINT review_events_pkey PRIMARY KEY (id);


--
-- Name: source_documents source_documents_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.source_documents
    ADD CONSTRAINT source_documents_pkey PRIMARY KEY (id);


--
-- Name: source_documents source_documents_tenant_id_election_id_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.source_documents
    ADD CONSTRAINT source_documents_tenant_id_election_id_id_key UNIQUE (tenant_id, election_id, id);


--
-- Name: source_documents source_documents_tenant_id_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.source_documents
    ADD CONSTRAINT source_documents_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: source_texts source_texts_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.source_texts
    ADD CONSTRAINT source_texts_pkey PRIMARY KEY (source_document_id, unit_index);


--
-- Name: tenant_brand_selections tenant_brand_selections_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.tenant_brand_selections
    ADD CONSTRAINT tenant_brand_selections_pkey PRIMARY KEY (tenant_id, slot);


--
-- Name: tenant_documents tenant_documents_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.tenant_documents
    ADD CONSTRAINT tenant_documents_pkey PRIMARY KEY (id);


--
-- Name: tenant_documents tenant_documents_tenant_id_id_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.tenant_documents
    ADD CONSTRAINT tenant_documents_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: tenant_documents tenant_documents_tenant_id_kind_version_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.tenant_documents
    ADD CONSTRAINT tenant_documents_tenant_id_kind_version_key UNIQUE (tenant_id, kind, version);


--
-- Name: tenant_hostnames tenant_hostnames_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.tenant_hostnames
    ADD CONSTRAINT tenant_hostnames_pkey PRIMARY KEY (hostname);


--
-- Name: tenant_organizations tenant_organizations_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.tenant_organizations
    ADD CONSTRAINT tenant_organizations_pkey PRIMARY KEY (tenant_id, organization_id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_slug_key; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.tenants
    ADD CONSTRAINT tenants_slug_key UNIQUE (slug);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: aiontheballot_owner
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: assessments_criterion_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX assessments_criterion_id_idx ON app.assessments USING btree (criterion_id);


--
-- Name: assessments_election_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX assessments_election_id_idx ON app.assessments USING btree (election_id);


--
-- Name: audit_log_tenant_id_at_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX audit_log_tenant_id_at_idx ON app.audit_log USING btree (tenant_id, at DESC);


--
-- Name: brand_asset_grants_tenant_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX brand_asset_grants_tenant_id_idx ON app.brand_asset_grants USING btree (tenant_id);


--
-- Name: criteria_core_criterion_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX criteria_core_criterion_id_idx ON app.criteria USING btree (core_criterion_id);


--
-- Name: draft_checked_documents_source_document_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX draft_checked_documents_source_document_id_idx ON app.draft_checked_documents USING btree (source_document_id);


--
-- Name: draft_evidence_attestation_file_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX draft_evidence_attestation_file_id_idx ON app.draft_evidence USING btree (attestation_file_id);


--
-- Name: draft_evidence_llm_suggestion_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX draft_evidence_llm_suggestion_id_idx ON app.draft_evidence USING btree (llm_suggestion_id);


--
-- Name: draft_evidence_source_document_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX draft_evidence_source_document_id_idx ON app.draft_evidence USING btree (source_document_id);


--
-- Name: job_requests_llm_run_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX job_requests_llm_run_id_idx ON app.job_requests USING btree (llm_run_id);


--
-- Name: job_requests_source_document_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX job_requests_source_document_id_idx ON app.job_requests USING btree (source_document_id);


--
-- Name: llm_runs_tenant_id_created_at_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX llm_runs_tenant_id_created_at_idx ON app.llm_runs USING btree (tenant_id, created_at);


--
-- Name: llm_suggestions_run_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX llm_suggestions_run_id_idx ON app.llm_suggestions USING btree (run_id);


--
-- Name: memberships_tenant_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX memberships_tenant_id_idx ON app.memberships USING btree (tenant_id);


--
-- Name: methodologies_demands_owner_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX methodologies_demands_owner_id_idx ON app.methodologies USING btree (demands_owner_id);


--
-- Name: methodology_reviewers_methodology_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX methodology_reviewers_methodology_id_idx ON app.methodology_reviewers USING btree (methodology_id);


--
-- Name: organizations_logo_asset_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX organizations_logo_asset_id_idx ON app.organizations USING btree (logo_asset_id);


--
-- Name: parties_logo_file_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX parties_logo_file_id_idx ON app.parties USING btree (logo_file_id);


--
-- Name: review_events_assessment_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX review_events_assessment_id_idx ON app.review_events USING btree (assessment_id);


--
-- Name: source_documents_election_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX source_documents_election_id_idx ON app.source_documents USING btree (election_id);


--
-- Name: source_documents_file_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX source_documents_file_id_idx ON app.source_documents USING btree (file_id);


--
-- Name: source_documents_party_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX source_documents_party_id_idx ON app.source_documents USING btree (party_id);


--
-- Name: tenant_brand_selections_brand_asset_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX tenant_brand_selections_brand_asset_id_idx ON app.tenant_brand_selections USING btree (brand_asset_id);


--
-- Name: tenant_hostnames_one_canonical_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE UNIQUE INDEX tenant_hostnames_one_canonical_idx ON app.tenant_hostnames USING btree (tenant_id) WHERE is_canonical;


--
-- Name: tenant_hostnames_tenant_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX tenant_hostnames_tenant_id_idx ON app.tenant_hostnames USING btree (tenant_id);


--
-- Name: tenant_organizations_one_operator_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE UNIQUE INDEX tenant_organizations_one_operator_idx ON app.tenant_organizations USING btree (tenant_id) WHERE (role = 'operator'::app.org_role);


--
-- Name: tenant_organizations_organization_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX tenant_organizations_organization_id_idx ON app.tenant_organizations USING btree (organization_id);


--
-- Name: tenant_organizations active_tenant_has_operator; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE CONSTRAINT TRIGGER active_tenant_has_operator AFTER DELETE OR UPDATE ON app.tenant_organizations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.active_tenant_has_operator();


--
-- Name: tenants active_tenant_has_operator; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE CONSTRAINT TRIGGER active_tenant_has_operator AFTER INSERT OR UPDATE OF active ON app.tenants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.active_tenant_has_operator();


--
-- Name: assessment_contributors audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.assessment_contributors FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: assessments audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.assessments FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: brand_asset_grants audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.brand_asset_grants FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: brand_assets audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.brand_assets FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: core_criteria audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.core_criteria FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: criteria audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.criteria FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: draft_checked_documents audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.draft_checked_documents FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: draft_evidence audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.draft_evidence FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: elections audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.elections FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: files audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.files FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: hostname_tombstones audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.hostname_tombstones FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: hostname_verifications audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.hostname_verifications FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: invitations audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.invitations FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: job_requests audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.job_requests FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: llm_runs audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.llm_runs FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: llm_suggestions audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.llm_suggestions FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: memberships audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.memberships FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: methodologies audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.methodologies FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: methodology_reviewers audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.methodology_reviewers FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: organizations audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.organizations FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: parties audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.parties FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: platform_admins audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.platform_admins FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: platform_hostnames audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.platform_hostnames FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: review_events audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.review_events FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: source_documents audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.source_documents FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: tenant_brand_selections audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.tenant_brand_selections FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: tenant_documents audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.tenant_documents FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: tenant_hostnames audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.tenant_hostnames FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: tenant_organizations audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.tenant_organizations FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: tenants audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.tenants FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: brand_assets bump_public_version; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER bump_public_version AFTER INSERT OR DELETE OR UPDATE ON app.brand_assets FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();


--
-- Name: core_criteria bump_public_version; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER bump_public_version AFTER INSERT OR DELETE OR UPDATE ON app.core_criteria FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();


--
-- Name: criteria bump_public_version; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER bump_public_version AFTER INSERT OR DELETE OR UPDATE ON app.criteria FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();


--
-- Name: elections bump_public_version; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER bump_public_version AFTER INSERT OR DELETE OR UPDATE ON app.elections FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();


--
-- Name: file_blobs bump_public_version; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER bump_public_version AFTER INSERT OR DELETE OR UPDATE ON app.file_blobs FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();


--
-- Name: files bump_public_version; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER bump_public_version AFTER INSERT OR DELETE OR UPDATE ON app.files FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();


--
-- Name: methodologies bump_public_version; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER bump_public_version AFTER INSERT OR DELETE OR UPDATE ON app.methodologies FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();


--
-- Name: methodology_reviewers bump_public_version; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER bump_public_version AFTER INSERT OR DELETE OR UPDATE ON app.methodology_reviewers FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();


--
-- Name: organizations bump_public_version; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER bump_public_version AFTER INSERT OR DELETE OR UPDATE ON app.organizations FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();


--
-- Name: parties bump_public_version; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER bump_public_version AFTER INSERT OR DELETE OR UPDATE ON app.parties FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();


--
-- Name: tenant_brand_selections bump_public_version; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER bump_public_version AFTER INSERT OR DELETE OR UPDATE ON app.tenant_brand_selections FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();


--
-- Name: tenant_documents bump_public_version; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER bump_public_version AFTER INSERT OR DELETE OR UPDATE ON app.tenant_documents FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();


--
-- Name: tenant_hostnames bump_public_version; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER bump_public_version AFTER INSERT OR DELETE OR UPDATE ON app.tenant_hostnames FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();


--
-- Name: tenant_organizations bump_public_version; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER bump_public_version AFTER INSERT OR DELETE OR UPDATE ON app.tenant_organizations FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();


--
-- Name: tenants bump_public_version; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER bump_public_version AFTER INSERT OR DELETE OR UPDATE ON app.tenants FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();


--
-- Name: draft_checked_documents content; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER content AFTER INSERT OR DELETE OR UPDATE ON app.draft_checked_documents FOR EACH ROW EXECUTE FUNCTION private.cell_content_changed();


--
-- Name: draft_evidence content; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER content AFTER INSERT OR DELETE OR UPDATE ON app.draft_evidence FOR EACH ROW EXECUTE FUNCTION private.cell_content_changed('attested_by', 'match_status', 'matched_from_unit', 'matched_to_unit');


--
-- Name: elections country_admin_columns; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER country_admin_columns BEFORE UPDATE ON app.elections FOR EACH ROW EXECUTE FUNCTION private.restrict_columns('country_admin', 'status', 'frozen_from', 'frozen_until');


--
-- Name: assessments editor_columns; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER editor_columns BEFORE UPDATE ON app.assessments FOR EACH ROW EXECUTE FUNCTION private.restrict_columns('country_admin,editor', 'draft_rating', 'draft_summary', 'draft_change_kind', 'draft_public_note', 'recheck_reason');


--
-- Name: draft_evidence editor_columns; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER editor_columns BEFORE UPDATE ON app.draft_evidence FOR EACH ROW EXECUTE FUNCTION private.restrict_columns('country_admin,editor', 'source_document_id', 'ordinal', 'quote', 'unit_index', 'section_label', 'ts_start', 'ts_end', 'attestation_file_id');


--
-- Name: tenant_hostnames forbid_delete; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_delete BEFORE DELETE ON app.tenant_hostnames FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation();


--
-- Name: audit_log forbid_mutation; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_mutation BEFORE DELETE OR UPDATE ON app.audit_log FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation();


--
-- Name: hostname_tombstones forbid_mutation; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_mutation BEFORE DELETE OR UPDATE ON app.hostname_tombstones FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation();


--
-- Name: review_events forbid_mutation; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_mutation BEFORE DELETE OR UPDATE ON app.review_events FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation();


--
-- Name: source_texts forbid_mutation; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_mutation BEFORE DELETE OR UPDATE ON app.source_texts FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation();


--
-- Name: assessment_contributors forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.assessment_contributors FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: assessments forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.assessments FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: audit_log forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.audit_log FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: brand_asset_grants forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.brand_asset_grants FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: criteria forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.criteria FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: draft_checked_documents forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.draft_checked_documents FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: draft_evidence forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.draft_evidence FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: elections forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.elections FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: file_blobs forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.file_blobs FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: files forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.files FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: invitations forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.invitations FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: job_requests forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.job_requests FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: llm_runs forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.llm_runs FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: llm_suggestions forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.llm_suggestions FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: memberships forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.memberships FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: methodologies forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.methodologies FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: methodology_reviewers forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.methodology_reviewers FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: parties forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.parties FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: public_versions forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.public_versions FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: review_events forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.review_events FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: source_documents forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.source_documents FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: source_texts forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.source_texts FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: tenant_brand_selections forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.tenant_brand_selections FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: tenant_documents forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.tenant_documents FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: tenant_hostnames forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.tenant_hostnames FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: tenant_organizations forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.tenant_organizations FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: audit_log forbid_truncate; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_truncate BEFORE TRUNCATE ON app.audit_log FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_mutation();


--
-- Name: file_blobs forbid_truncate; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_truncate BEFORE TRUNCATE ON app.file_blobs FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_mutation();


--
-- Name: files forbid_truncate; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_truncate BEFORE TRUNCATE ON app.files FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_mutation();


--
-- Name: hostname_tombstones forbid_truncate; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_truncate BEFORE TRUNCATE ON app.hostname_tombstones FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_mutation();


--
-- Name: review_events forbid_truncate; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_truncate BEFORE TRUNCATE ON app.review_events FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_mutation();


--
-- Name: source_texts forbid_truncate; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_truncate BEFORE TRUNCATE ON app.source_texts FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_mutation();


--
-- Name: tenant_hostnames forbid_truncate; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_truncate BEFORE TRUNCATE ON app.tenant_hostnames FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_mutation();


--
-- Name: assessment_contributors forbid_update; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_update BEFORE UPDATE ON app.assessment_contributors FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation();


--
-- Name: file_blobs forbid_update; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_update BEFORE UPDATE ON app.file_blobs FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation();


--
-- Name: files forbid_update; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_update BEFORE UPDATE ON app.files FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation();


--
-- Name: platform_hostnames is_free; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER is_free BEFORE INSERT ON app.platform_hostnames FOR EACH ROW EXECUTE FUNCTION private.platform_hostname_is_free();


--
-- Name: source_documents job_scope; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER job_scope BEFORE UPDATE ON app.source_documents FOR EACH ROW EXECUTE FUNCTION private.worker_job_scope();


--
-- Name: parties logo_is_public_asset; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER logo_is_public_asset BEFORE INSERT OR UPDATE OF logo_file_id ON app.parties FOR EACH ROW EXECUTE FUNCTION private.party_logo_is_public_asset();


--
-- Name: file_blobs matches_file; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER matches_file BEFORE INSERT OR DELETE ON app.file_blobs FOR EACH ROW EXECUTE FUNCTION private.blob_matches_file();


--
-- Name: tenants members_may_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER members_may_change BEFORE UPDATE ON app.tenants FOR EACH ROW EXECUTE FUNCTION private.members_may_change('theme', 'report_retention_days', 'llm_monthly_cap_usd');


--
-- Name: elections platform_admin_columns; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER platform_admin_columns BEFORE UPDATE ON app.elections FOR EACH ROW EXECUTE FUNCTION private.restrict_columns('', 'require_second_reviewer');


--
-- Name: brand_asset_grants restricted_assets_are_eligible; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE CONSTRAINT TRIGGER restricted_assets_are_eligible AFTER DELETE OR UPDATE ON app.brand_asset_grants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.restricted_assets_are_eligible();


--
-- Name: brand_assets restricted_assets_are_eligible; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE CONSTRAINT TRIGGER restricted_assets_are_eligible AFTER UPDATE OF restricted ON app.brand_assets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.restricted_assets_are_eligible();


--
-- Name: organizations restricted_assets_are_eligible; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE CONSTRAINT TRIGGER restricted_assets_are_eligible AFTER INSERT OR UPDATE OF is_pauseai_chapter, logo_asset_id ON app.organizations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.restricted_assets_are_eligible();


--
-- Name: tenant_brand_selections restricted_assets_are_eligible; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE CONSTRAINT TRIGGER restricted_assets_are_eligible AFTER INSERT OR UPDATE ON app.tenant_brand_selections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.restricted_assets_are_eligible();


--
-- Name: tenant_organizations restricted_assets_are_eligible; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE CONSTRAINT TRIGGER restricted_assets_are_eligible AFTER INSERT OR DELETE OR UPDATE ON app.tenant_organizations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.restricted_assets_are_eligible();


--
-- Name: assessment_contributors rules; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER rules AFTER INSERT ON app.assessment_contributors FOR EACH ROW EXECUTE FUNCTION private.contributor_rules();


--
-- Name: assessments rules; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER rules BEFORE UPDATE ON app.assessments FOR EACH ROW EXECUTE FUNCTION private.assessment_transition();


--
-- Name: criteria rules; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.criteria FOR EACH ROW EXECUTE FUNCTION private.structure_rules();


--
-- Name: elections rules; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.elections FOR EACH ROW EXECUTE FUNCTION private.election_rules();


--
-- Name: job_requests rules; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.job_requests FOR EACH ROW EXECUTE FUNCTION private.job_request_rules();


--
-- Name: llm_runs rules; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.llm_runs FOR EACH ROW EXECUTE FUNCTION private.llm_run_rules();


--
-- Name: llm_suggestions rules; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.llm_suggestions FOR EACH ROW EXECUTE FUNCTION private.llm_suggestion_rules();


--
-- Name: methodologies rules; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.methodologies FOR EACH ROW EXECUTE FUNCTION private.structure_rules();


--
-- Name: methodology_reviewers rules; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.methodology_reviewers FOR EACH ROW EXECUTE FUNCTION private.structure_rules();


--
-- Name: parties rules; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.parties FOR EACH ROW EXECUTE FUNCTION private.structure_rules();


--
-- Name: source_documents rules; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.source_documents FOR EACH ROW EXECUTE FUNCTION private.source_document_rules();


--
-- Name: source_texts rules; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER rules AFTER INSERT ON app.source_texts FOR EACH ROW EXECUTE FUNCTION private.source_text_rules();


--
-- Name: tenant_documents rules; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.tenant_documents FOR EACH ROW EXECUTE FUNCTION private.tenant_document_rules();


--
-- Name: tenant_hostnames rules; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.tenant_hostnames FOR EACH ROW EXECUTE FUNCTION private.tenant_hostname_rules();


--
-- Name: tenants rules; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER rules BEFORE UPDATE OF methodology_kind, country_code ON app.tenants FOR EACH ROW EXECUTE FUNCTION private.tenant_dependent_rules();


--
-- Name: assessment_contributors stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT ON app.assessment_contributors FOR EACH ROW EXECUTE FUNCTION private.stamp('first_edit_at');


--
-- Name: assessments stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.assessments FOR EACH ROW EXECUTE FUNCTION private.stamp('updated_by', 'updated_at');


--
-- Name: audit_log stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT ON app.audit_log FOR EACH ROW EXECUTE FUNCTION private.stamp('actor_id');


--
-- Name: brand_asset_grants stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.brand_asset_grants FOR EACH ROW EXECUTE FUNCTION private.stamp('granted_by', 'granted_at');


--
-- Name: brand_assets stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.brand_assets FOR EACH ROW EXECUTE FUNCTION private.stamp('created_at');


--
-- Name: draft_checked_documents stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT ON app.draft_checked_documents FOR EACH ROW EXECUTE FUNCTION private.stamp('checked_by', 'checked_at');


--
-- Name: draft_evidence stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.draft_evidence FOR EACH ROW EXECUTE FUNCTION private.stamp('created_by', 'created_at');


--
-- Name: elections stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.elections FOR EACH ROW EXECUTE FUNCTION private.stamp('created_at');


--
-- Name: files stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT ON app.files FOR EACH ROW EXECUTE FUNCTION private.stamp('created_by', 'created_at');


--
-- Name: invitations stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.invitations FOR EACH ROW EXECUTE FUNCTION private.stamp('created_by', 'created_at');


--
-- Name: job_requests stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.job_requests FOR EACH ROW EXECUTE FUNCTION private.stamp('requested_by', 'created_at');


--
-- Name: llm_runs stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.llm_runs FOR EACH ROW EXECUTE FUNCTION private.stamp('requested_by', 'created_at');


--
-- Name: memberships stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.memberships FOR EACH ROW EXECUTE FUNCTION private.stamp('created_by', 'created_at');


--
-- Name: organizations stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.organizations FOR EACH ROW EXECUTE FUNCTION private.stamp('created_at');


--
-- Name: platform_admins stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.platform_admins FOR EACH ROW EXECUTE FUNCTION private.stamp('created_at');


--
-- Name: review_events stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT ON app.review_events FOR EACH ROW EXECUTE FUNCTION private.stamp('actor_id', 'created_at');


--
-- Name: source_documents stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.source_documents FOR EACH ROW EXECUTE FUNCTION private.stamp('created_by', 'created_at');


--
-- Name: tenant_documents stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.tenant_documents FOR EACH ROW EXECUTE FUNCTION private.stamp('created_by', 'created_at');


--
-- Name: tenant_hostnames stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.tenant_hostnames FOR EACH ROW EXECUTE FUNCTION private.stamp('created_at');


--
-- Name: tenants stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.tenants FOR EACH ROW EXECUTE FUNCTION private.stamp('created_at');


--
-- Name: assessments trail; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER trail AFTER INSERT OR UPDATE ON app.assessments FOR EACH ROW EXECUTE FUNCTION private.assessment_trail();


--
-- Name: invitations transition; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER transition BEFORE UPDATE ON app.invitations FOR EACH ROW EXECUTE FUNCTION private.invitation_transition();


--
-- Name: assessment_contributors assessment_contributors_tenant_id_assessment_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.assessment_contributors
    ADD CONSTRAINT assessment_contributors_tenant_id_assessment_id_fkey FOREIGN KEY (tenant_id, assessment_id) REFERENCES app.assessments(tenant_id, id) ON DELETE CASCADE;


--
-- Name: assessments assessments_tenant_id_election_id_criterion_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.assessments
    ADD CONSTRAINT assessments_tenant_id_election_id_criterion_id_fkey FOREIGN KEY (tenant_id, election_id, criterion_id) REFERENCES app.criteria(tenant_id, election_id, id);


--
-- Name: assessments assessments_tenant_id_election_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.assessments
    ADD CONSTRAINT assessments_tenant_id_election_id_fkey FOREIGN KEY (tenant_id, election_id) REFERENCES app.elections(tenant_id, id);


--
-- Name: assessments assessments_tenant_id_election_id_party_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.assessments
    ADD CONSTRAINT assessments_tenant_id_election_id_party_id_fkey FOREIGN KEY (tenant_id, election_id, party_id) REFERENCES app.parties(tenant_id, election_id, id);


--
-- Name: audit_log audit_log_tenant_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.audit_log
    ADD CONSTRAINT audit_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES app.tenants(id);


--
-- Name: brand_asset_grants brand_asset_grants_brand_asset_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.brand_asset_grants
    ADD CONSTRAINT brand_asset_grants_brand_asset_id_fkey FOREIGN KEY (brand_asset_id) REFERENCES app.brand_assets(id);


--
-- Name: brand_asset_grants brand_asset_grants_tenant_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.brand_asset_grants
    ADD CONSTRAINT brand_asset_grants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES app.tenants(id);


--
-- Name: criteria criteria_core_criterion_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.criteria
    ADD CONSTRAINT criteria_core_criterion_id_fkey FOREIGN KEY (core_criterion_id) REFERENCES app.core_criteria(id);


--
-- Name: criteria criteria_tenant_id_election_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.criteria
    ADD CONSTRAINT criteria_tenant_id_election_id_fkey FOREIGN KEY (tenant_id, election_id) REFERENCES app.elections(tenant_id, id);


--
-- Name: draft_checked_documents draft_checked_documents_tenant_id_assessment_id_election_i_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.draft_checked_documents
    ADD CONSTRAINT draft_checked_documents_tenant_id_assessment_id_election_i_fkey FOREIGN KEY (tenant_id, assessment_id, election_id) REFERENCES app.assessments(tenant_id, id, election_id) ON DELETE CASCADE;


--
-- Name: draft_checked_documents draft_checked_documents_tenant_id_election_id_source_docum_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.draft_checked_documents
    ADD CONSTRAINT draft_checked_documents_tenant_id_election_id_source_docum_fkey FOREIGN KEY (tenant_id, election_id, source_document_id) REFERENCES app.source_documents(tenant_id, election_id, id);


--
-- Name: draft_evidence draft_evidence_tenant_id_assessment_id_election_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.draft_evidence
    ADD CONSTRAINT draft_evidence_tenant_id_assessment_id_election_id_fkey FOREIGN KEY (tenant_id, assessment_id, election_id) REFERENCES app.assessments(tenant_id, id, election_id) ON DELETE CASCADE;


--
-- Name: draft_evidence draft_evidence_tenant_id_attestation_file_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.draft_evidence
    ADD CONSTRAINT draft_evidence_tenant_id_attestation_file_id_fkey FOREIGN KEY (tenant_id, attestation_file_id) REFERENCES app.files(tenant_id, id);


--
-- Name: draft_evidence draft_evidence_tenant_id_election_id_source_document_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.draft_evidence
    ADD CONSTRAINT draft_evidence_tenant_id_election_id_source_document_id_fkey FOREIGN KEY (tenant_id, election_id, source_document_id) REFERENCES app.source_documents(tenant_id, election_id, id);


--
-- Name: draft_evidence draft_evidence_tenant_id_llm_suggestion_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.draft_evidence
    ADD CONSTRAINT draft_evidence_tenant_id_llm_suggestion_id_fkey FOREIGN KEY (tenant_id, llm_suggestion_id) REFERENCES app.llm_suggestions(tenant_id, id);


--
-- Name: elections elections_tenant_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.elections
    ADD CONSTRAINT elections_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES app.tenants(id);


--
-- Name: file_blobs file_blobs_tenant_id_file_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.file_blobs
    ADD CONSTRAINT file_blobs_tenant_id_file_id_fkey FOREIGN KEY (tenant_id, file_id) REFERENCES app.files(tenant_id, id) ON DELETE CASCADE;


--
-- Name: files files_tenant_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.files
    ADD CONSTRAINT files_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES app.tenants(id);


--
-- Name: hostname_verifications hostname_verifications_hostname_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.hostname_verifications
    ADD CONSTRAINT hostname_verifications_hostname_fkey FOREIGN KEY (hostname) REFERENCES app.tenant_hostnames(hostname);


--
-- Name: invitations invitations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.invitations
    ADD CONSTRAINT invitations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES app.tenants(id);


--
-- Name: job_requests job_requests_tenant_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.job_requests
    ADD CONSTRAINT job_requests_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES app.tenants(id);


--
-- Name: job_requests job_requests_tenant_id_llm_run_id_source_document_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.job_requests
    ADD CONSTRAINT job_requests_tenant_id_llm_run_id_source_document_id_fkey FOREIGN KEY (tenant_id, llm_run_id, source_document_id) REFERENCES app.llm_runs(tenant_id, id, source_document_id);


--
-- Name: job_requests job_requests_tenant_id_source_document_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.job_requests
    ADD CONSTRAINT job_requests_tenant_id_source_document_id_fkey FOREIGN KEY (tenant_id, source_document_id) REFERENCES app.source_documents(tenant_id, id);


--
-- Name: llm_runs llm_runs_tenant_id_election_id_source_document_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.llm_runs
    ADD CONSTRAINT llm_runs_tenant_id_election_id_source_document_id_fkey FOREIGN KEY (tenant_id, election_id, source_document_id) REFERENCES app.source_documents(tenant_id, election_id, id);


--
-- Name: llm_suggestions llm_suggestions_tenant_id_election_id_criterion_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.llm_suggestions
    ADD CONSTRAINT llm_suggestions_tenant_id_election_id_criterion_id_fkey FOREIGN KEY (tenant_id, election_id, criterion_id) REFERENCES app.criteria(tenant_id, election_id, id);


--
-- Name: llm_suggestions llm_suggestions_tenant_id_election_id_party_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.llm_suggestions
    ADD CONSTRAINT llm_suggestions_tenant_id_election_id_party_id_fkey FOREIGN KEY (tenant_id, election_id, party_id) REFERENCES app.parties(tenant_id, election_id, id);


--
-- Name: llm_suggestions llm_suggestions_tenant_id_run_id_election_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.llm_suggestions
    ADD CONSTRAINT llm_suggestions_tenant_id_run_id_election_id_fkey FOREIGN KEY (tenant_id, run_id, election_id) REFERENCES app.llm_runs(tenant_id, id, election_id);


--
-- Name: memberships memberships_tenant_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.memberships
    ADD CONSTRAINT memberships_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES app.tenants(id);


--
-- Name: methodologies methodologies_demands_owner_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.methodologies
    ADD CONSTRAINT methodologies_demands_owner_id_fkey FOREIGN KEY (demands_owner_id) REFERENCES app.organizations(id);


--
-- Name: methodologies methodologies_tenant_id_election_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.methodologies
    ADD CONSTRAINT methodologies_tenant_id_election_id_fkey FOREIGN KEY (tenant_id, election_id) REFERENCES app.elections(tenant_id, id);


--
-- Name: methodology_reviewers methodology_reviewers_tenant_id_methodology_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.methodology_reviewers
    ADD CONSTRAINT methodology_reviewers_tenant_id_methodology_id_fkey FOREIGN KEY (tenant_id, methodology_id) REFERENCES app.methodologies(tenant_id, id);


--
-- Name: organizations organizations_logo_asset_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.organizations
    ADD CONSTRAINT organizations_logo_asset_id_fkey FOREIGN KEY (logo_asset_id) REFERENCES app.brand_assets(id);


--
-- Name: parties parties_tenant_id_election_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.parties
    ADD CONSTRAINT parties_tenant_id_election_id_fkey FOREIGN KEY (tenant_id, election_id) REFERENCES app.elections(tenant_id, id);


--
-- Name: parties parties_tenant_id_logo_file_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.parties
    ADD CONSTRAINT parties_tenant_id_logo_file_id_fkey FOREIGN KEY (tenant_id, logo_file_id) REFERENCES app.files(tenant_id, id);


--
-- Name: public_versions public_versions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.public_versions
    ADD CONSTRAINT public_versions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES app.tenants(id);


--
-- Name: review_events review_events_tenant_id_assessment_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.review_events
    ADD CONSTRAINT review_events_tenant_id_assessment_id_fkey FOREIGN KEY (tenant_id, assessment_id) REFERENCES app.assessments(tenant_id, id);


--
-- Name: source_documents source_documents_tenant_id_election_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.source_documents
    ADD CONSTRAINT source_documents_tenant_id_election_id_fkey FOREIGN KEY (tenant_id, election_id) REFERENCES app.elections(tenant_id, id);


--
-- Name: source_documents source_documents_tenant_id_election_id_party_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.source_documents
    ADD CONSTRAINT source_documents_tenant_id_election_id_party_id_fkey FOREIGN KEY (tenant_id, election_id, party_id) REFERENCES app.parties(tenant_id, election_id, id);


--
-- Name: source_documents source_documents_tenant_id_file_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.source_documents
    ADD CONSTRAINT source_documents_tenant_id_file_id_fkey FOREIGN KEY (tenant_id, file_id) REFERENCES app.files(tenant_id, id);


--
-- Name: source_texts source_texts_tenant_id_source_document_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.source_texts
    ADD CONSTRAINT source_texts_tenant_id_source_document_id_fkey FOREIGN KEY (tenant_id, source_document_id) REFERENCES app.source_documents(tenant_id, id);


--
-- Name: tenant_brand_selections tenant_brand_selections_brand_asset_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.tenant_brand_selections
    ADD CONSTRAINT tenant_brand_selections_brand_asset_id_fkey FOREIGN KEY (brand_asset_id) REFERENCES app.brand_assets(id);


--
-- Name: tenant_brand_selections tenant_brand_selections_tenant_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.tenant_brand_selections
    ADD CONSTRAINT tenant_brand_selections_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES app.tenants(id);


--
-- Name: tenant_documents tenant_documents_tenant_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.tenant_documents
    ADD CONSTRAINT tenant_documents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES app.tenants(id);


--
-- Name: tenant_hostnames tenant_hostnames_tenant_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.tenant_hostnames
    ADD CONSTRAINT tenant_hostnames_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES app.tenants(id);


--
-- Name: tenant_organizations tenant_organizations_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.tenant_organizations
    ADD CONSTRAINT tenant_organizations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organizations(id);


--
-- Name: tenant_organizations tenant_organizations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.tenant_organizations
    ADD CONSTRAINT tenant_organizations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES app.tenants(id);


--
-- Name: assessment_contributors; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.assessment_contributors ENABLE ROW LEVEL SECURITY;

--
-- Name: assessments; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.assessments ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_asset_grants; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.brand_asset_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_assets; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.brand_assets ENABLE ROW LEVEL SECURITY;

--
-- Name: core_criteria; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.core_criteria ENABLE ROW LEVEL SECURITY;

--
-- Name: elections country_admin_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_delete ON app.elections FOR DELETE TO aiontheballot_admin USING ((((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)) AND (status = 'draft'::app.election_status)));


--
-- Name: invitations country_admin_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_delete ON app.invitations FOR DELETE TO aiontheballot_admin USING ((((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)) AND ((accepted_at IS NOT NULL) OR (revoked_at IS NOT NULL) OR (expires_at <= now()))));


--
-- Name: memberships country_admin_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_delete ON app.memberships FOR DELETE TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: methodologies country_admin_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_delete ON app.methodologies FOR DELETE TO aiontheballot_admin USING ((((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)) AND (EXISTS ( SELECT 1
   FROM app.elections e
  WHERE ((e.id = methodologies.election_id) AND (e.status = 'draft'::app.election_status))))));


--
-- Name: methodology_reviewers country_admin_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_delete ON app.methodology_reviewers FOR DELETE TO aiontheballot_admin USING ((((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)) AND (EXISTS ( SELECT 1
   FROM (app.methodologies m
     JOIN app.elections e ON ((e.id = m.election_id)))
  WHERE ((m.id = methodology_reviewers.methodology_id) AND (e.status = 'draft'::app.election_status))))));


--
-- Name: tenant_brand_selections country_admin_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_delete ON app.tenant_brand_selections FOR DELETE TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: tenant_documents country_admin_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_delete ON app.tenant_documents FOR DELETE TO aiontheballot_admin USING ((((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)) AND (published_at IS NULL)));


--
-- Name: invitations country_admin_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_insert ON app.invitations FOR INSERT TO aiontheballot_admin WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: memberships country_admin_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_insert ON app.memberships FOR INSERT TO aiontheballot_admin WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: methodologies country_admin_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_insert ON app.methodologies FOR INSERT TO aiontheballot_admin WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: methodology_reviewers country_admin_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_insert ON app.methodology_reviewers FOR INSERT TO aiontheballot_admin WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: tenant_brand_selections country_admin_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_insert ON app.tenant_brand_selections FOR INSERT TO aiontheballot_admin WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: tenant_documents country_admin_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_insert ON app.tenant_documents FOR INSERT TO aiontheballot_admin WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: audit_log country_admin_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_read ON app.audit_log FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: invitations country_admin_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_read ON app.invitations FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: invitations country_admin_revoke; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_revoke ON app.invitations FOR UPDATE TO aiontheballot_admin USING ((((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)) AND (accepted_at IS NULL) AND (revoked_at IS NULL))) WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: methodologies country_admin_update; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_update ON app.methodologies FOR UPDATE TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin))) WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: methodology_reviewers country_admin_update; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_update ON app.methodology_reviewers FOR UPDATE TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin))) WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: tenant_brand_selections country_admin_update; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_update ON app.tenant_brand_selections FOR UPDATE TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin))) WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: tenant_documents country_admin_update; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_update ON app.tenant_documents FOR UPDATE TO aiontheballot_admin USING ((((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)) AND (published_at IS NULL))) WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: tenants country_admin_update; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_update ON app.tenants FOR UPDATE TO aiontheballot_admin USING (((id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin))) WITH CHECK (((id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: criteria; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.criteria ENABLE ROW LEVEL SECURITY;

--
-- Name: draft_checked_documents; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.draft_checked_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: draft_evidence; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.draft_evidence ENABLE ROW LEVEL SECURITY;

--
-- Name: llm_suggestions editor_decide; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_decide ON app.llm_suggestions FOR UPDATE TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin))) WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: assessments editor_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_delete ON app.assessments FOR DELETE TO aiontheballot_admin USING ((((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)) AND (generation = 0)));


--
-- Name: criteria editor_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_delete ON app.criteria FOR DELETE TO aiontheballot_admin USING ((((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)) AND (EXISTS ( SELECT 1
   FROM app.elections e
  WHERE ((e.id = criteria.election_id) AND (e.status = 'draft'::app.election_status))))));


--
-- Name: draft_checked_documents editor_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_delete ON app.draft_checked_documents FOR DELETE TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: draft_evidence editor_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_delete ON app.draft_evidence FOR DELETE TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: files editor_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_delete ON app.files FOR DELETE TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: parties editor_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_delete ON app.parties FOR DELETE TO aiontheballot_admin USING ((((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)) AND (EXISTS ( SELECT 1
   FROM app.elections e
  WHERE ((e.id = parties.election_id) AND (e.status = 'draft'::app.election_status))))));


--
-- Name: source_documents editor_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_delete ON app.source_documents FOR DELETE TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: assessments editor_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_insert ON app.assessments FOR INSERT TO aiontheballot_admin WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: criteria editor_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_insert ON app.criteria FOR INSERT TO aiontheballot_admin WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: draft_checked_documents editor_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_insert ON app.draft_checked_documents FOR INSERT TO aiontheballot_admin WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: draft_evidence editor_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_insert ON app.draft_evidence FOR INSERT TO aiontheballot_admin WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: elections editor_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_insert ON app.elections FOR INSERT TO aiontheballot_admin WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: file_blobs editor_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_insert ON app.file_blobs FOR INSERT TO aiontheballot_admin WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: files editor_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_insert ON app.files FOR INSERT TO aiontheballot_admin WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: job_requests editor_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_insert ON app.job_requests FOR INSERT TO aiontheballot_admin WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: llm_runs editor_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_insert ON app.llm_runs FOR INSERT TO aiontheballot_admin WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: parties editor_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_insert ON app.parties FOR INSERT TO aiontheballot_admin WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: source_documents editor_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_insert ON app.source_documents FOR INSERT TO aiontheballot_admin WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: criteria editor_update; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_update ON app.criteria FOR UPDATE TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin))) WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: elections editor_update; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_update ON app.elections FOR UPDATE TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin))) WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: parties editor_update; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_update ON app.parties FOR UPDATE TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin))) WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: source_documents editor_update; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY editor_update ON app.source_documents FOR UPDATE TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin))) WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: elections; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.elections ENABLE ROW LEVEL SECURITY;

--
-- Name: file_blobs; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.file_blobs ENABLE ROW LEVEL SECURITY;

--
-- Name: files; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.files ENABLE ROW LEVEL SECURITY;

--
-- Name: hostname_tombstones; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.hostname_tombstones ENABLE ROW LEVEL SECURITY;

--
-- Name: hostname_verifications; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.hostname_verifications ENABLE ROW LEVEL SECURITY;

--
-- Name: invitations; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: job_requests; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.job_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: llm_runs; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.llm_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: llm_suggestions; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.llm_suggestions ENABLE ROW LEVEL SECURITY;

--
-- Name: review_events member_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_insert ON app.review_events FOR INSERT TO aiontheballot_admin WITH CHECK ((((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)) AND ((kind = 'commented'::app.review_event_kind) OR (pg_trigger_depth() > 0))));


--
-- Name: assessment_contributors member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.assessment_contributors FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: assessments member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.assessments FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: brand_asset_grants member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.brand_asset_grants FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: brand_assets member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.brand_assets FOR SELECT TO aiontheballot_admin USING ((((NOT restricted) AND (EXISTS ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants))) OR (EXISTS ( SELECT 1
   FROM app.brand_asset_grants g
  WHERE ((g.brand_asset_id = brand_assets.id) AND (g.tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants))))) OR (EXISTS ( SELECT 1
   FROM app.tenant_brand_selections s
  WHERE ((s.brand_asset_id = brand_assets.id) AND (s.tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants))))) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: core_criteria member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.core_criteria FOR SELECT TO aiontheballot_admin USING (((EXISTS ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: criteria member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.criteria FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: draft_checked_documents member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.draft_checked_documents FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: draft_evidence member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.draft_evidence FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: elections member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.elections FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: file_blobs member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.file_blobs FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: files member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.files FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: job_requests member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.job_requests FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: llm_runs member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.llm_runs FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: llm_suggestions member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.llm_suggestions FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: memberships member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.memberships FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: methodologies member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.methodologies FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: methodology_reviewers member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.methodology_reviewers FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: organizations member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.organizations FOR SELECT TO aiontheballot_admin USING (((EXISTS ( SELECT 1
   FROM app.tenant_organizations o
  WHERE ((o.organization_id = organizations.id) AND (o.tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants))))) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: parties member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.parties FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: review_events member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.review_events FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: source_documents member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.source_documents FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: source_texts member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.source_texts FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: tenant_brand_selections member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.tenant_brand_selections FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: tenant_documents member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.tenant_documents FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: tenant_hostnames member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.tenant_hostnames FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: tenant_organizations member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.tenant_organizations FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: tenants member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.tenants FOR SELECT TO aiontheballot_admin USING (((id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: assessments member_update; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_update ON app.assessments FOR UPDATE TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin))) WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: draft_evidence member_update; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_update ON app.draft_evidence FOR UPDATE TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin))) WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: memberships; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: methodologies; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.methodologies ENABLE ROW LEVEL SECURITY;

--
-- Name: methodology_reviewers; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.methodology_reviewers ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: parties; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.parties ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_asset_grants platform_admin_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_delete ON app.brand_asset_grants FOR DELETE TO aiontheballot_admin USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: brand_assets platform_admin_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_delete ON app.brand_assets FOR DELETE TO aiontheballot_admin USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: core_criteria platform_admin_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_delete ON app.core_criteria FOR DELETE TO aiontheballot_admin USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: organizations platform_admin_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_delete ON app.organizations FOR DELETE TO aiontheballot_admin USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: tenant_organizations platform_admin_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_delete ON app.tenant_organizations FOR DELETE TO aiontheballot_admin USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: brand_asset_grants platform_admin_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_insert ON app.brand_asset_grants FOR INSERT TO aiontheballot_admin WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: brand_assets platform_admin_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_insert ON app.brand_assets FOR INSERT TO aiontheballot_admin WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: core_criteria platform_admin_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_insert ON app.core_criteria FOR INSERT TO aiontheballot_admin WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: hostname_verifications platform_admin_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_insert ON app.hostname_verifications FOR INSERT TO aiontheballot_admin WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: organizations platform_admin_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_insert ON app.organizations FOR INSERT TO aiontheballot_admin WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: platform_hostnames platform_admin_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_insert ON app.platform_hostnames FOR INSERT TO aiontheballot_admin WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: tenant_hostnames platform_admin_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_insert ON app.tenant_hostnames FOR INSERT TO aiontheballot_admin WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: tenant_organizations platform_admin_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_insert ON app.tenant_organizations FOR INSERT TO aiontheballot_admin WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: tenants platform_admin_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_insert ON app.tenants FOR INSERT TO aiontheballot_admin WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: hostname_tombstones platform_admin_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_read ON app.hostname_tombstones FOR SELECT TO aiontheballot_admin USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: hostname_verifications platform_admin_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_read ON app.hostname_verifications FOR SELECT TO aiontheballot_admin USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: platform_admins platform_admin_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_read ON app.platform_admins FOR SELECT TO aiontheballot_admin USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: platform_hostnames platform_admin_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_read ON app.platform_hostnames FOR SELECT TO aiontheballot_admin USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: brand_assets platform_admin_update; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_update ON app.brand_assets FOR UPDATE TO aiontheballot_admin USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: core_criteria platform_admin_update; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_update ON app.core_criteria FOR UPDATE TO aiontheballot_admin USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: hostname_verifications platform_admin_update; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_update ON app.hostname_verifications FOR UPDATE TO aiontheballot_admin USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: organizations platform_admin_update; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_update ON app.organizations FOR UPDATE TO aiontheballot_admin USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: tenant_hostnames platform_admin_update; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_update ON app.tenant_hostnames FOR UPDATE TO aiontheballot_admin USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: tenant_organizations platform_admin_update; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_update ON app.tenant_organizations FOR UPDATE TO aiontheballot_admin USING (( SELECT private.is_platform_admin() AS is_platform_admin)) WITH CHECK (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: platform_admins; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.platform_admins ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_hostnames; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.platform_hostnames ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_assets public_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY public_read ON app.brand_assets FOR SELECT TO aiontheballot_web USING (((NOT restricted) OR (EXISTS ( SELECT 1
   FROM (app.tenant_brand_selections s
     JOIN app.tenants t ON ((t.id = s.tenant_id)))
  WHERE ((s.brand_asset_id = brand_assets.id) AND t.active)))));


--
-- Name: core_criteria public_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY public_read ON app.core_criteria FOR SELECT TO aiontheballot_web USING (true);


--
-- Name: criteria public_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY public_read ON app.criteria FOR SELECT TO aiontheballot_web USING ((EXISTS ( SELECT 1
   FROM app.elections e
  WHERE ((e.id = criteria.election_id) AND (e.status = ANY (ARRAY['live'::app.election_status, 'archived'::app.election_status]))))));


--
-- Name: elections public_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY public_read ON app.elections FOR SELECT TO aiontheballot_web USING (((status = ANY (ARRAY['live'::app.election_status, 'archived'::app.election_status])) AND (EXISTS ( SELECT 1
   FROM app.tenants t
  WHERE ((t.id = elections.tenant_id) AND t.active)))));


--
-- Name: file_blobs public_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY public_read ON app.file_blobs FOR SELECT TO aiontheballot_web USING ((EXISTS ( SELECT 1
   FROM app.files f
  WHERE ((f.id = file_blobs.file_id) AND (f.bucket = 'public_assets'::app.file_bucket)))));


--
-- Name: files public_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY public_read ON app.files FOR SELECT TO aiontheballot_web USING (((bucket = 'public_assets'::app.file_bucket) AND (EXISTS ( SELECT 1
   FROM app.parties p
  WHERE (p.logo_file_id = files.id)))));


--
-- Name: hostname_tombstones public_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY public_read ON app.hostname_tombstones FOR SELECT TO aiontheballot_web USING (true);


--
-- Name: methodologies public_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY public_read ON app.methodologies FOR SELECT TO aiontheballot_web USING ((EXISTS ( SELECT 1
   FROM app.elections e
  WHERE ((e.id = methodologies.election_id) AND (e.status = ANY (ARRAY['live'::app.election_status, 'archived'::app.election_status]))))));


--
-- Name: methodology_reviewers public_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY public_read ON app.methodology_reviewers FOR SELECT TO aiontheballot_web USING ((EXISTS ( SELECT 1
   FROM (app.methodologies m
     JOIN app.elections e ON ((e.id = m.election_id)))
  WHERE ((m.id = methodology_reviewers.methodology_id) AND (e.status = ANY (ARRAY['live'::app.election_status, 'archived'::app.election_status]))))));


--
-- Name: organizations public_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY public_read ON app.organizations FOR SELECT TO aiontheballot_web USING ((EXISTS ( SELECT 1
   FROM (app.tenant_organizations o
     JOIN app.tenants t ON ((t.id = o.tenant_id)))
  WHERE ((o.organization_id = organizations.id) AND t.active))));


--
-- Name: parties public_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY public_read ON app.parties FOR SELECT TO aiontheballot_web USING ((EXISTS ( SELECT 1
   FROM app.elections e
  WHERE ((e.id = parties.election_id) AND (e.status = ANY (ARRAY['live'::app.election_status, 'archived'::app.election_status]))))));


--
-- Name: public_versions public_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY public_read ON app.public_versions FOR SELECT TO aiontheballot_web USING ((EXISTS ( SELECT 1
   FROM app.tenants t
  WHERE ((t.id = public_versions.tenant_id) AND t.active))));


--
-- Name: tenant_brand_selections public_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY public_read ON app.tenant_brand_selections FOR SELECT TO aiontheballot_web USING ((EXISTS ( SELECT 1
   FROM app.tenants t
  WHERE ((t.id = tenant_brand_selections.tenant_id) AND t.active))));


--
-- Name: tenant_documents public_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY public_read ON app.tenant_documents FOR SELECT TO aiontheballot_web USING (((published_at IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM app.tenants t
  WHERE ((t.id = tenant_documents.tenant_id) AND t.active)))));


--
-- Name: tenant_hostnames public_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY public_read ON app.tenant_hostnames FOR SELECT TO aiontheballot_web USING (((verified_at IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM app.tenants t
  WHERE ((t.id = tenant_hostnames.tenant_id) AND t.active)))));


--
-- Name: tenant_organizations public_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY public_read ON app.tenant_organizations FOR SELECT TO aiontheballot_web USING ((EXISTS ( SELECT 1
   FROM app.tenants t
  WHERE ((t.id = tenant_organizations.tenant_id) AND t.active))));


--
-- Name: tenants public_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY public_read ON app.tenants FOR SELECT TO aiontheballot_web USING (active);


--
-- Name: public_versions; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.public_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: review_events; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.review_events ENABLE ROW LEVEL SECURITY;

--
-- Name: assessment_contributors self_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY self_insert ON app.assessment_contributors FOR INSERT TO aiontheballot_admin WITH CHECK ((((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)) AND (user_id = private.current_user_id())));


--
-- Name: source_documents; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.source_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: source_texts; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.source_texts ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_brand_selections; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.tenant_brand_selections ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_documents; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.tenant_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_hostnames; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.tenant_hostnames ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_organizations; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.tenant_organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: tenants; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.tenants ENABLE ROW LEVEL SECURITY;

--
-- Name: source_texts worker_extract; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY worker_extract ON app.source_texts FOR INSERT TO aiontheballot_worker WITH CHECK ((EXISTS ( SELECT 1
   FROM app.job_requests r
  WHERE ((r.finished_at IS NULL) AND (r.kind = 'extract_source'::app.job_kind) AND (r.source_document_id = source_texts.source_document_id)))));


--
-- Name: file_blobs worker_fetch; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY worker_fetch ON app.file_blobs FOR INSERT TO aiontheballot_worker WITH CHECK ((EXISTS ( SELECT 1
   FROM (app.files f
     JOIN app.job_requests r ON ((r.tenant_id = f.tenant_id)))
  WHERE ((f.id = file_blobs.file_id) AND (f.created_at = now()) AND (r.finished_at IS NULL) AND (r.kind = 'fetch_source'::app.job_kind)))));


--
-- Name: files worker_fetch; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY worker_fetch ON app.files FOR INSERT TO aiontheballot_worker WITH CHECK (((bucket = 'sources'::app.file_bucket) AND (EXISTS ( SELECT 1
   FROM app.job_requests r
  WHERE ((r.finished_at IS NULL) AND (r.kind = 'fetch_source'::app.job_kind) AND (r.tenant_id = files.tenant_id) AND (r.requested_by = files.created_by))))));


--
-- Name: job_requests worker_finish; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY worker_finish ON app.job_requests FOR UPDATE TO aiontheballot_worker USING (((id = (NULLIF(current_setting('app.job_request_id'::text, true), ''::text))::uuid) AND (finished_at IS NULL))) WITH CHECK ((id = (NULLIF(current_setting('app.job_request_id'::text, true), ''::text))::uuid));


--
-- Name: job_requests worker_job; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY worker_job ON app.job_requests FOR SELECT TO aiontheballot_worker USING (((id = (NULLIF(current_setting('app.job_request_id'::text, true), ''::text))::uuid) AND ((finished_at IS NULL) OR (finished_at = now()))));


--
-- Name: criteria worker_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY worker_read ON app.criteria FOR SELECT TO aiontheballot_worker USING ((EXISTS ( SELECT 1
   FROM (app.job_requests r
     JOIN app.source_documents s ON ((s.id = r.source_document_id)))
  WHERE ((r.finished_at IS NULL) AND (r.kind = 'llm_run'::app.job_kind) AND (s.election_id = criteria.election_id)))));


--
-- Name: file_blobs worker_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY worker_read ON app.file_blobs FOR SELECT TO aiontheballot_worker USING ((EXISTS ( SELECT 1
   FROM app.files f
  WHERE (f.id = file_blobs.file_id))));


--
-- Name: files worker_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY worker_read ON app.files FOR SELECT TO aiontheballot_worker USING (((EXISTS ( SELECT 1
   FROM app.source_documents s
  WHERE (s.file_id = files.id))) OR ((created_at = now()) AND (EXISTS ( SELECT 1
   FROM app.job_requests r
  WHERE ((r.finished_at IS NULL) AND (r.kind = 'fetch_source'::app.job_kind) AND (r.tenant_id = files.tenant_id)))))));


--
-- Name: llm_runs worker_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY worker_read ON app.llm_runs FOR SELECT TO aiontheballot_worker USING ((EXISTS ( SELECT 1
   FROM app.job_requests r
  WHERE ((r.finished_at IS NULL) AND (r.llm_run_id = llm_runs.id)))));


--
-- Name: llm_suggestions worker_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY worker_read ON app.llm_suggestions FOR SELECT TO aiontheballot_worker USING ((EXISTS ( SELECT 1
   FROM app.job_requests r
  WHERE ((r.finished_at IS NULL) AND (r.llm_run_id = llm_suggestions.run_id)))));


--
-- Name: parties worker_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY worker_read ON app.parties FOR SELECT TO aiontheballot_worker USING ((EXISTS ( SELECT 1
   FROM (app.job_requests r
     JOIN app.source_documents s ON ((s.id = r.source_document_id)))
  WHERE ((r.finished_at IS NULL) AND (r.kind = 'llm_run'::app.job_kind) AND (s.election_id = parties.election_id)))));


--
-- Name: source_documents worker_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY worker_read ON app.source_documents FOR SELECT TO aiontheballot_worker USING ((EXISTS ( SELECT 1
   FROM app.job_requests r
  WHERE ((r.finished_at IS NULL) AND (r.source_document_id = source_documents.id)))));


--
-- Name: source_texts worker_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY worker_read ON app.source_texts FOR SELECT TO aiontheballot_worker USING ((EXISTS ( SELECT 1
   FROM app.job_requests r
  WHERE ((r.finished_at IS NULL) AND (r.source_document_id = source_texts.source_document_id)))));


--
-- Name: tenants worker_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY worker_read ON app.tenants FOR SELECT TO aiontheballot_worker USING ((EXISTS ( SELECT 1
   FROM app.job_requests r
  WHERE ((r.finished_at IS NULL) AND (r.tenant_id = tenants.id)))));


--
-- Name: llm_runs worker_run; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY worker_run ON app.llm_runs FOR UPDATE TO aiontheballot_worker USING ((EXISTS ( SELECT 1
   FROM app.job_requests r
  WHERE ((r.finished_at IS NULL) AND (r.llm_run_id = llm_runs.id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM app.job_requests r
  WHERE ((r.finished_at IS NULL) AND (r.llm_run_id = llm_runs.id)))));


--
-- Name: llm_suggestions worker_suggest; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY worker_suggest ON app.llm_suggestions FOR INSERT TO aiontheballot_worker WITH CHECK ((EXISTS ( SELECT 1
   FROM app.job_requests r
  WHERE ((r.finished_at IS NULL) AND (r.llm_run_id = llm_suggestions.run_id)))));


--
-- Name: source_documents worker_update; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY worker_update ON app.source_documents FOR UPDATE TO aiontheballot_worker USING ((EXISTS ( SELECT 1
   FROM app.job_requests r
  WHERE ((r.finished_at IS NULL) AND (r.source_document_id = source_documents.id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM app.job_requests r
  WHERE ((r.finished_at IS NULL) AND (r.source_document_id = source_documents.id)))));


--
-- Name: SCHEMA app; Type: ACL; Schema: -; Owner: aiontheballot_owner
--

GRANT USAGE ON SCHEMA app TO aiontheballot_web;
GRANT USAGE ON SCHEMA app TO aiontheballot_admin;
GRANT USAGE ON SCHEMA app TO aiontheballot_worker;


--
-- Name: SCHEMA private; Type: ACL; Schema: -; Owner: aiontheballot_owner
--

GRANT USAGE ON SCHEMA private TO aiontheballot_web;
GRANT USAGE ON SCHEMA private TO aiontheballot_admin;
GRANT USAGE ON SCHEMA private TO aiontheballot_worker;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;


--
-- Name: TYPE assessment_state; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.assessment_state FROM PUBLIC;


--
-- Name: TYPE change_action; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.change_action FROM PUBLIC;


--
-- Name: TYPE change_kind; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.change_kind FROM PUBLIC;


--
-- Name: TYPE change_request_state; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.change_request_state FROM PUBLIC;


--
-- Name: TYPE election_status; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.election_status FROM PUBLIC;


--
-- Name: TYPE election_type; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.election_type FROM PUBLIC;


--
-- Name: TYPE evidence_origin; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.evidence_origin FROM PUBLIC;


--
-- Name: TYPE extraction_status; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.extraction_status FROM PUBLIC;


--
-- Name: TYPE file_bucket; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.file_bucket FROM PUBLIC;


--
-- Name: TYPE hostname; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.hostname FROM PUBLIC;


--
-- Name: TYPE job_kind; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.job_kind FROM PUBLIC;


--
-- Name: TYPE locale; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.locale FROM PUBLIC;


--
-- Name: TYPE localized; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.localized FROM PUBLIC;


--
-- Name: TYPE match_status; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.match_status FROM PUBLIC;


--
-- Name: TYPE methodology_kind; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.methodology_kind FROM PUBLIC;


--
-- Name: TYPE org_role; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.org_role FROM PUBLIC;


--
-- Name: TYPE programme_status; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.programme_status FROM PUBLIC;


--
-- Name: TYPE rating; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.rating FROM PUBLIC;


--
-- Name: TYPE report_kind; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.report_kind FROM PUBLIC;


--
-- Name: TYPE report_status; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.report_status FROM PUBLIC;


--
-- Name: TYPE review_event_kind; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.review_event_kind FROM PUBLIC;


--
-- Name: TYPE slug; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.slug FROM PUBLIC;


--
-- Name: TYPE source_kind; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.source_kind FROM PUBLIC;


--
-- Name: TYPE suggestion_state; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.suggestion_state FROM PUBLIC;


--
-- Name: TYPE tenant_document_kind; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.tenant_document_kind FROM PUBLIC;


--
-- Name: TYPE tenant_role; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.tenant_role FROM PUBLIC;


--
-- Name: FUNCTION active_tenant_has_operator(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.active_tenant_has_operator() FROM PUBLIC;


--
-- Name: FUNCTION assessment_trail(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.assessment_trail() FROM PUBLIC;


--
-- Name: FUNCTION assessment_transition(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.assessment_transition() FROM PUBLIC;


--
-- Name: FUNCTION audit(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.audit() FROM PUBLIC;


--
-- Name: FUNCTION blob_matches_file(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.blob_matches_file() FROM PUBLIC;


--
-- Name: FUNCTION bump_public_version(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.bump_public_version() FROM PUBLIC;


--
-- Name: FUNCTION cell_content_changed(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.cell_content_changed() FROM PUBLIC;


--
-- Name: FUNCTION contributor_rules(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.contributor_rules() FROM PUBLIC;


--
-- Name: FUNCTION current_aal(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.current_aal() FROM PUBLIC;
GRANT ALL ON FUNCTION private.current_aal() TO aiontheballot_admin;


--
-- Name: FUNCTION current_user_id(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.current_user_id() FROM PUBLIC;
GRANT ALL ON FUNCTION private.current_user_id() TO aiontheballot_admin;
GRANT ALL ON FUNCTION private.current_user_id() TO aiontheballot_worker;


--
-- Name: FUNCTION election_rules(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.election_rules() FROM PUBLIC;


--
-- Name: FUNCTION forbid_mutation(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.forbid_mutation() FROM PUBLIC;


--
-- Name: FUNCTION forbid_tenant_change(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.forbid_tenant_change() FROM PUBLIC;


--
-- Name: FUNCTION invitation_transition(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.invitation_transition() FROM PUBLIC;


--
-- Name: FUNCTION is_platform_admin(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.is_platform_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_platform_admin() TO aiontheballot_admin;


--
-- Name: FUNCTION job_request_rules(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.job_request_rules() FROM PUBLIC;


--
-- Name: FUNCTION llm_run_rules(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.llm_run_rules() FROM PUBLIC;


--
-- Name: FUNCTION llm_suggestion_rules(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.llm_suggestion_rules() FROM PUBLIC;


--
-- Name: FUNCTION members_may_change(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.members_may_change() FROM PUBLIC;


--
-- Name: FUNCTION my_tenants(VARIADIC roles app.tenant_role[]); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.my_tenants(VARIADIC roles app.tenant_role[]) FROM PUBLIC;
GRANT ALL ON FUNCTION private.my_tenants(VARIADIC roles app.tenant_role[]) TO aiontheballot_admin;


--
-- Name: FUNCTION normalize_for_match(input text); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.normalize_for_match(input text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.normalize_for_match(input text) TO aiontheballot_worker;


--
-- Name: FUNCTION party_logo_is_public_asset(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.party_logo_is_public_asset() FROM PUBLIC;


--
-- Name: FUNCTION platform_hostname_is_free(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.platform_hostname_is_free() FROM PUBLIC;


--
-- Name: FUNCTION restrict_columns(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.restrict_columns() FROM PUBLIC;


--
-- Name: FUNCTION restricted_assets_are_eligible(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.restricted_assets_are_eligible() FROM PUBLIC;


--
-- Name: FUNCTION source_document_rules(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.source_document_rules() FROM PUBLIC;


--
-- Name: FUNCTION source_text_rules(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.source_text_rules() FROM PUBLIC;


--
-- Name: FUNCTION stamp(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.stamp() FROM PUBLIC;


--
-- Name: FUNCTION structure_rules(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.structure_rules() FROM PUBLIC;


--
-- Name: FUNCTION tenant_dependent_rules(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.tenant_dependent_rules() FROM PUBLIC;


--
-- Name: FUNCTION tenant_document_rules(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.tenant_document_rules() FROM PUBLIC;


--
-- Name: FUNCTION tenant_hostname_rules(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.tenant_hostname_rules() FROM PUBLIC;


--
-- Name: FUNCTION worker_job_scope(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.worker_job_scope() FROM PUBLIC;


--
-- Name: TABLE assessment_contributors; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.assessment_contributors TO aiontheballot_admin;


--
-- Name: COLUMN assessment_contributors.assessment_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(assessment_id) ON TABLE app.assessment_contributors TO aiontheballot_admin;


--
-- Name: COLUMN assessment_contributors.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.assessment_contributors TO aiontheballot_admin;


--
-- Name: COLUMN assessment_contributors.generation; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(generation) ON TABLE app.assessment_contributors TO aiontheballot_admin;


--
-- Name: COLUMN assessment_contributors.user_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(user_id) ON TABLE app.assessment_contributors TO aiontheballot_admin;


--
-- Name: TABLE assessments; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT,DELETE ON TABLE app.assessments TO aiontheballot_admin;


--
-- Name: COLUMN assessments.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.assessments TO aiontheballot_admin;


--
-- Name: COLUMN assessments.election_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(election_id) ON TABLE app.assessments TO aiontheballot_admin;


--
-- Name: COLUMN assessments.party_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(party_id) ON TABLE app.assessments TO aiontheballot_admin;


--
-- Name: COLUMN assessments.criterion_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(criterion_id) ON TABLE app.assessments TO aiontheballot_admin;


--
-- Name: COLUMN assessments.state; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(state) ON TABLE app.assessments TO aiontheballot_admin;


--
-- Name: COLUMN assessments.draft_rating; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(draft_rating),UPDATE(draft_rating) ON TABLE app.assessments TO aiontheballot_admin;


--
-- Name: COLUMN assessments.draft_summary; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(draft_summary),UPDATE(draft_summary) ON TABLE app.assessments TO aiontheballot_admin;


--
-- Name: COLUMN assessments.draft_change_kind; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(draft_change_kind),UPDATE(draft_change_kind) ON TABLE app.assessments TO aiontheballot_admin;


--
-- Name: COLUMN assessments.draft_public_note; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(draft_public_note),UPDATE(draft_public_note) ON TABLE app.assessments TO aiontheballot_admin;


--
-- Name: COLUMN assessments.recheck_reason; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(recheck_reason) ON TABLE app.assessments TO aiontheballot_admin;


--
-- Name: TABLE audit_log; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.audit_log TO aiontheballot_admin;


--
-- Name: TABLE brand_asset_grants; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT,DELETE ON TABLE app.brand_asset_grants TO aiontheballot_admin;


--
-- Name: COLUMN brand_asset_grants.brand_asset_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(brand_asset_id) ON TABLE app.brand_asset_grants TO aiontheballot_admin;


--
-- Name: COLUMN brand_asset_grants.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.brand_asset_grants TO aiontheballot_admin;


--
-- Name: TABLE brand_assets; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.brand_assets TO aiontheballot_web;
GRANT SELECT,DELETE ON TABLE app.brand_assets TO aiontheballot_admin;


--
-- Name: COLUMN brand_assets.name; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(name),UPDATE(name) ON TABLE app.brand_assets TO aiontheballot_admin;


--
-- Name: COLUMN brand_assets.restricted; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(restricted),UPDATE(restricted) ON TABLE app.brand_assets TO aiontheballot_admin;


--
-- Name: COLUMN brand_assets.content_type; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(content_type) ON TABLE app.brand_assets TO aiontheballot_admin;


--
-- Name: COLUMN brand_assets.sha256; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(sha256) ON TABLE app.brand_assets TO aiontheballot_admin;


--
-- Name: COLUMN brand_assets.content; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(content) ON TABLE app.brand_assets TO aiontheballot_admin;


--
-- Name: TABLE core_criteria; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.core_criteria TO aiontheballot_web;
GRANT SELECT,DELETE ON TABLE app.core_criteria TO aiontheballot_admin;


--
-- Name: COLUMN core_criteria.key; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(key),UPDATE(key) ON TABLE app.core_criteria TO aiontheballot_admin;


--
-- Name: COLUMN core_criteria.title; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(title),UPDATE(title) ON TABLE app.core_criteria TO aiontheballot_admin;


--
-- Name: COLUMN core_criteria.description; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(description),UPDATE(description) ON TABLE app.core_criteria TO aiontheballot_admin;


--
-- Name: TABLE criteria; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.criteria TO aiontheballot_web;
GRANT SELECT,DELETE ON TABLE app.criteria TO aiontheballot_admin;
GRANT SELECT ON TABLE app.criteria TO aiontheballot_worker;


--
-- Name: COLUMN criteria.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.criteria TO aiontheballot_admin;


--
-- Name: COLUMN criteria.election_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(election_id) ON TABLE app.criteria TO aiontheballot_admin;


--
-- Name: COLUMN criteria.slug; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(slug),UPDATE(slug) ON TABLE app.criteria TO aiontheballot_admin;


--
-- Name: COLUMN criteria.title; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(title),UPDATE(title) ON TABLE app.criteria TO aiontheballot_admin;


--
-- Name: COLUMN criteria.description; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(description),UPDATE(description) ON TABLE app.criteria TO aiontheballot_admin;


--
-- Name: COLUMN criteria.display_order; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(display_order),UPDATE(display_order) ON TABLE app.criteria TO aiontheballot_admin;


--
-- Name: COLUMN criteria.core_criterion_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(core_criterion_id),UPDATE(core_criterion_id) ON TABLE app.criteria TO aiontheballot_admin;


--
-- Name: COLUMN criteria.retired_at; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(retired_at) ON TABLE app.criteria TO aiontheballot_admin;


--
-- Name: TABLE draft_checked_documents; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT,DELETE ON TABLE app.draft_checked_documents TO aiontheballot_admin;


--
-- Name: COLUMN draft_checked_documents.assessment_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(assessment_id) ON TABLE app.draft_checked_documents TO aiontheballot_admin;


--
-- Name: COLUMN draft_checked_documents.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.draft_checked_documents TO aiontheballot_admin;


--
-- Name: COLUMN draft_checked_documents.election_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(election_id) ON TABLE app.draft_checked_documents TO aiontheballot_admin;


--
-- Name: COLUMN draft_checked_documents.source_document_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(source_document_id) ON TABLE app.draft_checked_documents TO aiontheballot_admin;


--
-- Name: TABLE draft_evidence; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT,DELETE ON TABLE app.draft_evidence TO aiontheballot_admin;


--
-- Name: COLUMN draft_evidence.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.draft_evidence TO aiontheballot_admin;


--
-- Name: COLUMN draft_evidence.election_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(election_id) ON TABLE app.draft_evidence TO aiontheballot_admin;


--
-- Name: COLUMN draft_evidence.assessment_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(assessment_id) ON TABLE app.draft_evidence TO aiontheballot_admin;


--
-- Name: COLUMN draft_evidence.source_document_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(source_document_id),UPDATE(source_document_id) ON TABLE app.draft_evidence TO aiontheballot_admin;


--
-- Name: COLUMN draft_evidence.ordinal; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(ordinal),UPDATE(ordinal) ON TABLE app.draft_evidence TO aiontheballot_admin;


--
-- Name: COLUMN draft_evidence.quote; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(quote),UPDATE(quote) ON TABLE app.draft_evidence TO aiontheballot_admin;


--
-- Name: COLUMN draft_evidence.unit_index; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(unit_index),UPDATE(unit_index) ON TABLE app.draft_evidence TO aiontheballot_admin;


--
-- Name: COLUMN draft_evidence.section_label; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(section_label),UPDATE(section_label) ON TABLE app.draft_evidence TO aiontheballot_admin;


--
-- Name: COLUMN draft_evidence.ts_start; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(ts_start),UPDATE(ts_start) ON TABLE app.draft_evidence TO aiontheballot_admin;


--
-- Name: COLUMN draft_evidence.ts_end; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(ts_end),UPDATE(ts_end) ON TABLE app.draft_evidence TO aiontheballot_admin;


--
-- Name: COLUMN draft_evidence.attested_by; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(attested_by) ON TABLE app.draft_evidence TO aiontheballot_admin;


--
-- Name: COLUMN draft_evidence.attestation_file_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(attestation_file_id),UPDATE(attestation_file_id) ON TABLE app.draft_evidence TO aiontheballot_admin;


--
-- Name: COLUMN draft_evidence.origin; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(origin) ON TABLE app.draft_evidence TO aiontheballot_admin;


--
-- Name: COLUMN draft_evidence.llm_suggestion_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(llm_suggestion_id) ON TABLE app.draft_evidence TO aiontheballot_admin;


--
-- Name: TABLE elections; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT,DELETE ON TABLE app.elections TO aiontheballot_admin;


--
-- Name: COLUMN elections.id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT(id) ON TABLE app.elections TO aiontheballot_web;


--
-- Name: COLUMN elections.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT(tenant_id) ON TABLE app.elections TO aiontheballot_web;
GRANT INSERT(tenant_id) ON TABLE app.elections TO aiontheballot_admin;


--
-- Name: COLUMN elections.slug; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT(slug) ON TABLE app.elections TO aiontheballot_web;
GRANT INSERT(slug),UPDATE(slug) ON TABLE app.elections TO aiontheballot_admin;


--
-- Name: COLUMN elections.type; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT(type) ON TABLE app.elections TO aiontheballot_web;
GRANT INSERT(type),UPDATE(type) ON TABLE app.elections TO aiontheballot_admin;


--
-- Name: COLUMN elections.territory_code; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT(territory_code) ON TABLE app.elections TO aiontheballot_web;
GRANT INSERT(territory_code),UPDATE(territory_code) ON TABLE app.elections TO aiontheballot_admin;


--
-- Name: COLUMN elections.name; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT(name) ON TABLE app.elections TO aiontheballot_web;
GRANT INSERT(name),UPDATE(name) ON TABLE app.elections TO aiontheballot_admin;


--
-- Name: COLUMN elections.election_date; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT(election_date) ON TABLE app.elections TO aiontheballot_web;
GRANT INSERT(election_date),UPDATE(election_date) ON TABLE app.elections TO aiontheballot_admin;


--
-- Name: COLUMN elections.status; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT(status) ON TABLE app.elections TO aiontheballot_web;
GRANT UPDATE(status) ON TABLE app.elections TO aiontheballot_admin;


--
-- Name: COLUMN elections.went_live_at; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT(went_live_at) ON TABLE app.elections TO aiontheballot_web;


--
-- Name: COLUMN elections.require_second_reviewer; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(require_second_reviewer) ON TABLE app.elections TO aiontheballot_admin;


--
-- Name: COLUMN elections.frozen_from; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(frozen_from) ON TABLE app.elections TO aiontheballot_admin;


--
-- Name: COLUMN elections.frozen_until; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(frozen_until) ON TABLE app.elections TO aiontheballot_admin;


--
-- Name: COLUMN elections.created_at; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT(created_at) ON TABLE app.elections TO aiontheballot_web;


--
-- Name: TABLE file_blobs; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.file_blobs TO aiontheballot_admin;
GRANT SELECT ON TABLE app.file_blobs TO aiontheballot_web;
GRANT SELECT ON TABLE app.file_blobs TO aiontheballot_worker;


--
-- Name: COLUMN file_blobs.file_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(file_id) ON TABLE app.file_blobs TO aiontheballot_admin;
GRANT INSERT(file_id) ON TABLE app.file_blobs TO aiontheballot_worker;


--
-- Name: COLUMN file_blobs.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.file_blobs TO aiontheballot_admin;
GRANT INSERT(tenant_id) ON TABLE app.file_blobs TO aiontheballot_worker;


--
-- Name: COLUMN file_blobs.content; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(content) ON TABLE app.file_blobs TO aiontheballot_admin;
GRANT INSERT(content) ON TABLE app.file_blobs TO aiontheballot_worker;


--
-- Name: TABLE files; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT,DELETE ON TABLE app.files TO aiontheballot_admin;


--
-- Name: COLUMN files.id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT(id) ON TABLE app.files TO aiontheballot_web;
GRANT SELECT(id) ON TABLE app.files TO aiontheballot_worker;


--
-- Name: COLUMN files.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.files TO aiontheballot_admin;
GRANT SELECT(tenant_id) ON TABLE app.files TO aiontheballot_web;
GRANT SELECT(tenant_id),INSERT(tenant_id) ON TABLE app.files TO aiontheballot_worker;


--
-- Name: COLUMN files.bucket; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(bucket) ON TABLE app.files TO aiontheballot_admin;
GRANT SELECT(bucket) ON TABLE app.files TO aiontheballot_web;
GRANT SELECT(bucket),INSERT(bucket) ON TABLE app.files TO aiontheballot_worker;


--
-- Name: COLUMN files.content_type; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(content_type) ON TABLE app.files TO aiontheballot_admin;
GRANT SELECT(content_type) ON TABLE app.files TO aiontheballot_web;
GRANT SELECT(content_type),INSERT(content_type) ON TABLE app.files TO aiontheballot_worker;


--
-- Name: COLUMN files.byte_size; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(byte_size) ON TABLE app.files TO aiontheballot_admin;
GRANT SELECT(byte_size) ON TABLE app.files TO aiontheballot_web;
GRANT SELECT(byte_size),INSERT(byte_size) ON TABLE app.files TO aiontheballot_worker;


--
-- Name: COLUMN files.sha256; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(sha256) ON TABLE app.files TO aiontheballot_admin;
GRANT SELECT(sha256) ON TABLE app.files TO aiontheballot_web;
GRANT SELECT(sha256),INSERT(sha256) ON TABLE app.files TO aiontheballot_worker;


--
-- Name: COLUMN files.original_filename; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(original_filename) ON TABLE app.files TO aiontheballot_admin;
GRANT INSERT(original_filename) ON TABLE app.files TO aiontheballot_worker;


--
-- Name: COLUMN files.created_at; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT(created_at) ON TABLE app.files TO aiontheballot_web;
GRANT SELECT(created_at) ON TABLE app.files TO aiontheballot_worker;


--
-- Name: TABLE hostname_tombstones; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.hostname_tombstones TO aiontheballot_web;
GRANT SELECT ON TABLE app.hostname_tombstones TO aiontheballot_admin;


--
-- Name: TABLE hostname_verifications; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.hostname_verifications TO aiontheballot_admin;


--
-- Name: COLUMN hostname_verifications.hostname; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(hostname) ON TABLE app.hostname_verifications TO aiontheballot_admin;


--
-- Name: COLUMN hostname_verifications.token_hash; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(token_hash),UPDATE(token_hash) ON TABLE app.hostname_verifications TO aiontheballot_admin;


--
-- Name: COLUMN hostname_verifications.last_checked_at; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(last_checked_at) ON TABLE app.hostname_verifications TO aiontheballot_admin;


--
-- Name: COLUMN hostname_verifications.last_result; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(last_result) ON TABLE app.hostname_verifications TO aiontheballot_admin;


--
-- Name: TABLE invitations; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT,DELETE ON TABLE app.invitations TO aiontheballot_admin;


--
-- Name: COLUMN invitations.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.invitations TO aiontheballot_admin;


--
-- Name: COLUMN invitations.email; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(email) ON TABLE app.invitations TO aiontheballot_admin;


--
-- Name: COLUMN invitations.role; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(role) ON TABLE app.invitations TO aiontheballot_admin;


--
-- Name: COLUMN invitations.token_hash; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(token_hash) ON TABLE app.invitations TO aiontheballot_admin;


--
-- Name: COLUMN invitations.expires_at; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(expires_at) ON TABLE app.invitations TO aiontheballot_admin;


--
-- Name: COLUMN invitations.revoked_at; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(revoked_at) ON TABLE app.invitations TO aiontheballot_admin;


--
-- Name: TABLE job_requests; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.job_requests TO aiontheballot_admin;
GRANT SELECT ON TABLE app.job_requests TO aiontheballot_worker;


--
-- Name: COLUMN job_requests.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.job_requests TO aiontheballot_admin;


--
-- Name: COLUMN job_requests.kind; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(kind) ON TABLE app.job_requests TO aiontheballot_admin;


--
-- Name: COLUMN job_requests.source_document_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(source_document_id) ON TABLE app.job_requests TO aiontheballot_admin;


--
-- Name: COLUMN job_requests.llm_run_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(llm_run_id) ON TABLE app.job_requests TO aiontheballot_admin;


--
-- Name: COLUMN job_requests.finished_at; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(finished_at) ON TABLE app.job_requests TO aiontheballot_worker;


--
-- Name: TABLE llm_runs; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.llm_runs TO aiontheballot_admin;
GRANT SELECT ON TABLE app.llm_runs TO aiontheballot_worker;


--
-- Name: COLUMN llm_runs.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.llm_runs TO aiontheballot_admin;


--
-- Name: COLUMN llm_runs.election_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(election_id) ON TABLE app.llm_runs TO aiontheballot_admin;


--
-- Name: COLUMN llm_runs.source_document_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(source_document_id) ON TABLE app.llm_runs TO aiontheballot_admin;


--
-- Name: COLUMN llm_runs.model; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(model) ON TABLE app.llm_runs TO aiontheballot_admin;


--
-- Name: COLUMN llm_runs.prompt_version; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(prompt_version) ON TABLE app.llm_runs TO aiontheballot_admin;


--
-- Name: COLUMN llm_runs.status; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(status) ON TABLE app.llm_runs TO aiontheballot_worker;


--
-- Name: COLUMN llm_runs.input_tokens; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(input_tokens) ON TABLE app.llm_runs TO aiontheballot_worker;


--
-- Name: COLUMN llm_runs.output_tokens; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(output_tokens) ON TABLE app.llm_runs TO aiontheballot_worker;


--
-- Name: COLUMN llm_runs.cost_usd; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(cost_usd) ON TABLE app.llm_runs TO aiontheballot_worker;


--
-- Name: COLUMN llm_runs.error; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(error) ON TABLE app.llm_runs TO aiontheballot_worker;


--
-- Name: TABLE llm_suggestions; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.llm_suggestions TO aiontheballot_admin;
GRANT SELECT ON TABLE app.llm_suggestions TO aiontheballot_worker;


--
-- Name: COLUMN llm_suggestions.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.llm_suggestions TO aiontheballot_worker;


--
-- Name: COLUMN llm_suggestions.election_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(election_id) ON TABLE app.llm_suggestions TO aiontheballot_worker;


--
-- Name: COLUMN llm_suggestions.run_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(run_id) ON TABLE app.llm_suggestions TO aiontheballot_worker;


--
-- Name: COLUMN llm_suggestions.party_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(party_id) ON TABLE app.llm_suggestions TO aiontheballot_worker;


--
-- Name: COLUMN llm_suggestions.criterion_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(criterion_id) ON TABLE app.llm_suggestions TO aiontheballot_worker;


--
-- Name: COLUMN llm_suggestions.suggested_rating; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(suggested_rating) ON TABLE app.llm_suggestions TO aiontheballot_worker;


--
-- Name: COLUMN llm_suggestions.rationale; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(rationale) ON TABLE app.llm_suggestions TO aiontheballot_worker;


--
-- Name: COLUMN llm_suggestions.passages; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(passages) ON TABLE app.llm_suggestions TO aiontheballot_worker;


--
-- Name: COLUMN llm_suggestions.state; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(state) ON TABLE app.llm_suggestions TO aiontheballot_admin;


--
-- Name: TABLE memberships; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT,DELETE ON TABLE app.memberships TO aiontheballot_admin;


--
-- Name: COLUMN memberships.user_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(user_id) ON TABLE app.memberships TO aiontheballot_admin;


--
-- Name: COLUMN memberships.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.memberships TO aiontheballot_admin;


--
-- Name: COLUMN memberships.role; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(role) ON TABLE app.memberships TO aiontheballot_admin;


--
-- Name: TABLE methodologies; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.methodologies TO aiontheballot_web;
GRANT SELECT,DELETE ON TABLE app.methodologies TO aiontheballot_admin;


--
-- Name: COLUMN methodologies.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.methodologies TO aiontheballot_admin;


--
-- Name: COLUMN methodologies.election_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(election_id) ON TABLE app.methodologies TO aiontheballot_admin;


--
-- Name: COLUMN methodologies.kind; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(kind),UPDATE(kind) ON TABLE app.methodologies TO aiontheballot_admin;


--
-- Name: COLUMN methodologies.demands_owner_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(demands_owner_id),UPDATE(demands_owner_id) ON TABLE app.methodologies TO aiontheballot_admin;


--
-- Name: COLUMN methodologies.body; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(body),UPDATE(body) ON TABLE app.methodologies TO aiontheballot_admin;


--
-- Name: COLUMN methodologies.admissible_source_kinds; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(admissible_source_kinds),UPDATE(admissible_source_kinds) ON TABLE app.methodologies TO aiontheballot_admin;


--
-- Name: COLUMN methodologies.not_mentioned_source_kinds; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(not_mentioned_source_kinds),UPDATE(not_mentioned_source_kinds) ON TABLE app.methodologies TO aiontheballot_admin;


--
-- Name: TABLE methodology_reviewers; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.methodology_reviewers TO aiontheballot_web;
GRANT SELECT,DELETE ON TABLE app.methodology_reviewers TO aiontheballot_admin;


--
-- Name: COLUMN methodology_reviewers.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.methodology_reviewers TO aiontheballot_admin;


--
-- Name: COLUMN methodology_reviewers.methodology_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(methodology_id) ON TABLE app.methodology_reviewers TO aiontheballot_admin;


--
-- Name: COLUMN methodology_reviewers.name; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(name),UPDATE(name) ON TABLE app.methodology_reviewers TO aiontheballot_admin;


--
-- Name: COLUMN methodology_reviewers.affiliation; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(affiliation),UPDATE(affiliation) ON TABLE app.methodology_reviewers TO aiontheballot_admin;


--
-- Name: COLUMN methodology_reviewers.display_order; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(display_order),UPDATE(display_order) ON TABLE app.methodology_reviewers TO aiontheballot_admin;


--
-- Name: COLUMN methodology_reviewers.retired_at; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(retired_at) ON TABLE app.methodology_reviewers TO aiontheballot_admin;


--
-- Name: TABLE organizations; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.organizations TO aiontheballot_web;
GRANT SELECT,DELETE ON TABLE app.organizations TO aiontheballot_admin;


--
-- Name: COLUMN organizations.display_name; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(display_name),UPDATE(display_name) ON TABLE app.organizations TO aiontheballot_admin;


--
-- Name: COLUMN organizations.legal_name; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(legal_name),UPDATE(legal_name) ON TABLE app.organizations TO aiontheballot_admin;


--
-- Name: COLUMN organizations.tax_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tax_id),UPDATE(tax_id) ON TABLE app.organizations TO aiontheballot_admin;


--
-- Name: COLUMN organizations.address; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(address),UPDATE(address) ON TABLE app.organizations TO aiontheballot_admin;


--
-- Name: COLUMN organizations.registry_entry; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(registry_entry),UPDATE(registry_entry) ON TABLE app.organizations TO aiontheballot_admin;


--
-- Name: COLUMN organizations.contact_email; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(contact_email),UPDATE(contact_email) ON TABLE app.organizations TO aiontheballot_admin;


--
-- Name: COLUMN organizations.privacy_email; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(privacy_email),UPDATE(privacy_email) ON TABLE app.organizations TO aiontheballot_admin;


--
-- Name: COLUMN organizations.url; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(url),UPDATE(url) ON TABLE app.organizations TO aiontheballot_admin;


--
-- Name: COLUMN organizations.logo_asset_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(logo_asset_id),UPDATE(logo_asset_id) ON TABLE app.organizations TO aiontheballot_admin;


--
-- Name: COLUMN organizations.is_pauseai_chapter; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(is_pauseai_chapter),UPDATE(is_pauseai_chapter) ON TABLE app.organizations TO aiontheballot_admin;


--
-- Name: TABLE parties; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.parties TO aiontheballot_web;
GRANT SELECT,DELETE ON TABLE app.parties TO aiontheballot_admin;
GRANT SELECT ON TABLE app.parties TO aiontheballot_worker;


--
-- Name: COLUMN parties.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.parties TO aiontheballot_admin;


--
-- Name: COLUMN parties.election_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(election_id) ON TABLE app.parties TO aiontheballot_admin;


--
-- Name: COLUMN parties.slug; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(slug),UPDATE(slug) ON TABLE app.parties TO aiontheballot_admin;


--
-- Name: COLUMN parties.name; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(name),UPDATE(name) ON TABLE app.parties TO aiontheballot_admin;


--
-- Name: COLUMN parties.short_name; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(short_name),UPDATE(short_name) ON TABLE app.parties TO aiontheballot_admin;


--
-- Name: COLUMN parties.logo_file_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(logo_file_id),UPDATE(logo_file_id) ON TABLE app.parties TO aiontheballot_admin;


--
-- Name: COLUMN parties.colour; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(colour),UPDATE(colour) ON TABLE app.parties TO aiontheballot_admin;


--
-- Name: COLUMN parties.display_order; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(display_order),UPDATE(display_order) ON TABLE app.parties TO aiontheballot_admin;


--
-- Name: COLUMN parties.website; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(website),UPDATE(website) ON TABLE app.parties TO aiontheballot_admin;


--
-- Name: COLUMN parties.programme_status; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(programme_status) ON TABLE app.parties TO aiontheballot_admin;


--
-- Name: COLUMN parties.programme_checked_at; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(programme_checked_at) ON TABLE app.parties TO aiontheballot_admin;


--
-- Name: COLUMN parties.territory_codes; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(territory_codes),UPDATE(territory_codes) ON TABLE app.parties TO aiontheballot_admin;


--
-- Name: COLUMN parties.retired_at; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(retired_at) ON TABLE app.parties TO aiontheballot_admin;


--
-- Name: TABLE platform_admins; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.platform_admins TO aiontheballot_admin;


--
-- Name: TABLE platform_hostnames; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.platform_hostnames TO aiontheballot_admin;


--
-- Name: COLUMN platform_hostnames.hostname; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(hostname) ON TABLE app.platform_hostnames TO aiontheballot_admin;


--
-- Name: TABLE public_versions; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.public_versions TO aiontheballot_web;


--
-- Name: TABLE review_events; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.review_events TO aiontheballot_admin;


--
-- Name: COLUMN review_events.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.review_events TO aiontheballot_admin;


--
-- Name: COLUMN review_events.assessment_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(assessment_id) ON TABLE app.review_events TO aiontheballot_admin;


--
-- Name: COLUMN review_events.kind; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(kind) ON TABLE app.review_events TO aiontheballot_admin;


--
-- Name: COLUMN review_events.note; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(note) ON TABLE app.review_events TO aiontheballot_admin;


--
-- Name: TABLE source_documents; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT,DELETE ON TABLE app.source_documents TO aiontheballot_admin;
GRANT SELECT ON TABLE app.source_documents TO aiontheballot_worker;


--
-- Name: COLUMN source_documents.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.source_documents TO aiontheballot_admin;


--
-- Name: COLUMN source_documents.election_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(election_id) ON TABLE app.source_documents TO aiontheballot_admin;


--
-- Name: COLUMN source_documents.party_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(party_id),UPDATE(party_id) ON TABLE app.source_documents TO aiontheballot_admin;


--
-- Name: COLUMN source_documents.kind; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(kind),UPDATE(kind) ON TABLE app.source_documents TO aiontheballot_admin;


--
-- Name: COLUMN source_documents.title; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(title),UPDATE(title) ON TABLE app.source_documents TO aiontheballot_admin;


--
-- Name: COLUMN source_documents.url; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(url),UPDATE(url) ON TABLE app.source_documents TO aiontheballot_admin;


--
-- Name: COLUMN source_documents.language; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(language),UPDATE(language) ON TABLE app.source_documents TO aiontheballot_admin;


--
-- Name: COLUMN source_documents.is_programme; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(is_programme),UPDATE(is_programme) ON TABLE app.source_documents TO aiontheballot_admin;


--
-- Name: COLUMN source_documents.file_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(file_id),UPDATE(file_id) ON TABLE app.source_documents TO aiontheballot_admin;
GRANT UPDATE(file_id) ON TABLE app.source_documents TO aiontheballot_worker;


--
-- Name: COLUMN source_documents.file_origin; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(file_origin),UPDATE(file_origin) ON TABLE app.source_documents TO aiontheballot_admin;
GRANT UPDATE(file_origin) ON TABLE app.source_documents TO aiontheballot_worker;


--
-- Name: COLUMN source_documents.archive_url; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(archive_url) ON TABLE app.source_documents TO aiontheballot_worker;


--
-- Name: COLUMN source_documents.extraction_status; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(extraction_status) ON TABLE app.source_documents TO aiontheballot_worker;


--
-- Name: TABLE source_texts; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.source_texts TO aiontheballot_admin;
GRANT SELECT ON TABLE app.source_texts TO aiontheballot_worker;


--
-- Name: COLUMN source_texts.source_document_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(source_document_id) ON TABLE app.source_texts TO aiontheballot_worker;


--
-- Name: COLUMN source_texts.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.source_texts TO aiontheballot_worker;


--
-- Name: COLUMN source_texts.unit_index; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(unit_index) ON TABLE app.source_texts TO aiontheballot_worker;


--
-- Name: COLUMN source_texts.label; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(label) ON TABLE app.source_texts TO aiontheballot_worker;


--
-- Name: COLUMN source_texts.body; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(body) ON TABLE app.source_texts TO aiontheballot_worker;


--
-- Name: TABLE tenant_brand_selections; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.tenant_brand_selections TO aiontheballot_web;
GRANT SELECT,DELETE ON TABLE app.tenant_brand_selections TO aiontheballot_admin;


--
-- Name: COLUMN tenant_brand_selections.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.tenant_brand_selections TO aiontheballot_admin;


--
-- Name: COLUMN tenant_brand_selections.slot; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(slot) ON TABLE app.tenant_brand_selections TO aiontheballot_admin;


--
-- Name: COLUMN tenant_brand_selections.brand_asset_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(brand_asset_id),UPDATE(brand_asset_id) ON TABLE app.tenant_brand_selections TO aiontheballot_admin;


--
-- Name: TABLE tenant_documents; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.tenant_documents TO aiontheballot_web;
GRANT SELECT,DELETE ON TABLE app.tenant_documents TO aiontheballot_admin;


--
-- Name: COLUMN tenant_documents.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.tenant_documents TO aiontheballot_admin;


--
-- Name: COLUMN tenant_documents.kind; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(kind) ON TABLE app.tenant_documents TO aiontheballot_admin;


--
-- Name: COLUMN tenant_documents.body; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(body),UPDATE(body) ON TABLE app.tenant_documents TO aiontheballot_admin;


--
-- Name: COLUMN tenant_documents.published_at; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(published_at),UPDATE(published_at) ON TABLE app.tenant_documents TO aiontheballot_admin;


--
-- Name: TABLE tenant_hostnames; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.tenant_hostnames TO aiontheballot_web;
GRANT SELECT ON TABLE app.tenant_hostnames TO aiontheballot_admin;


--
-- Name: COLUMN tenant_hostnames.hostname; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(hostname) ON TABLE app.tenant_hostnames TO aiontheballot_admin;


--
-- Name: COLUMN tenant_hostnames.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.tenant_hostnames TO aiontheballot_admin;


--
-- Name: COLUMN tenant_hostnames.is_canonical; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(is_canonical),UPDATE(is_canonical) ON TABLE app.tenant_hostnames TO aiontheballot_admin;


--
-- Name: COLUMN tenant_hostnames.verified_at; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(verified_at),UPDATE(verified_at) ON TABLE app.tenant_hostnames TO aiontheballot_admin;


--
-- Name: COLUMN tenant_hostnames.retired_at; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT UPDATE(retired_at) ON TABLE app.tenant_hostnames TO aiontheballot_admin;


--
-- Name: TABLE tenant_organizations; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.tenant_organizations TO aiontheballot_web;
GRANT SELECT,DELETE ON TABLE app.tenant_organizations TO aiontheballot_admin;


--
-- Name: COLUMN tenant_organizations.tenant_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(tenant_id) ON TABLE app.tenant_organizations TO aiontheballot_admin;


--
-- Name: COLUMN tenant_organizations.organization_id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(organization_id) ON TABLE app.tenant_organizations TO aiontheballot_admin;


--
-- Name: COLUMN tenant_organizations.role; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(role),UPDATE(role) ON TABLE app.tenant_organizations TO aiontheballot_admin;


--
-- Name: COLUMN tenant_organizations.display_order; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(display_order),UPDATE(display_order) ON TABLE app.tenant_organizations TO aiontheballot_admin;


--
-- Name: TABLE tenants; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT ON TABLE app.tenants TO aiontheballot_admin;


--
-- Name: COLUMN tenants.id; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT(id) ON TABLE app.tenants TO aiontheballot_web;
GRANT SELECT(id) ON TABLE app.tenants TO aiontheballot_worker;


--
-- Name: COLUMN tenants.slug; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT(slug) ON TABLE app.tenants TO aiontheballot_web;
GRANT INSERT(slug),UPDATE(slug) ON TABLE app.tenants TO aiontheballot_admin;


--
-- Name: COLUMN tenants.country_code; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT(country_code) ON TABLE app.tenants TO aiontheballot_web;
GRANT INSERT(country_code),UPDATE(country_code) ON TABLE app.tenants TO aiontheballot_admin;


--
-- Name: COLUMN tenants.default_locale; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT(default_locale) ON TABLE app.tenants TO aiontheballot_web;
GRANT INSERT(default_locale),UPDATE(default_locale) ON TABLE app.tenants TO aiontheballot_admin;


--
-- Name: COLUMN tenants.enabled_locales; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT(enabled_locales) ON TABLE app.tenants TO aiontheballot_web;
GRANT INSERT(enabled_locales),UPDATE(enabled_locales) ON TABLE app.tenants TO aiontheballot_admin;


--
-- Name: COLUMN tenants.display_name; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT(display_name) ON TABLE app.tenants TO aiontheballot_web;
GRANT INSERT(display_name),UPDATE(display_name) ON TABLE app.tenants TO aiontheballot_admin;


--
-- Name: COLUMN tenants.theme; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT(theme) ON TABLE app.tenants TO aiontheballot_web;
GRANT INSERT(theme),UPDATE(theme) ON TABLE app.tenants TO aiontheballot_admin;


--
-- Name: COLUMN tenants.methodology_kind; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT(methodology_kind) ON TABLE app.tenants TO aiontheballot_web;
GRANT INSERT(methodology_kind),UPDATE(methodology_kind) ON TABLE app.tenants TO aiontheballot_admin;
GRANT SELECT(methodology_kind) ON TABLE app.tenants TO aiontheballot_worker;


--
-- Name: COLUMN tenants.active; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT(active) ON TABLE app.tenants TO aiontheballot_web;
GRANT INSERT(active),UPDATE(active) ON TABLE app.tenants TO aiontheballot_admin;


--
-- Name: COLUMN tenants.live_edits_need_second_approver; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(live_edits_need_second_approver),UPDATE(live_edits_need_second_approver) ON TABLE app.tenants TO aiontheballot_admin;


--
-- Name: COLUMN tenants.report_retention_days; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(report_retention_days),UPDATE(report_retention_days) ON TABLE app.tenants TO aiontheballot_admin;


--
-- Name: COLUMN tenants.llm_monthly_cap_usd; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT INSERT(llm_monthly_cap_usd),UPDATE(llm_monthly_cap_usd) ON TABLE app.tenants TO aiontheballot_admin;


--
-- Name: COLUMN tenants.created_at; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

GRANT SELECT(created_at) ON TABLE app.tenants TO aiontheballot_web;


--
-- Name: DEFAULT PRIVILEGES FOR TYPES; Type: DEFAULT ACL; Schema: -; Owner: aiontheballot_owner
--

ALTER DEFAULT PRIVILEGES FOR ROLE aiontheballot_owner REVOKE ALL ON TYPES FROM PUBLIC;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: -; Owner: aiontheballot_owner
--

ALTER DEFAULT PRIVILEGES FOR ROLE aiontheballot_owner REVOKE ALL ON FUNCTIONS FROM PUBLIC;


--
-- PostgreSQL database dump complete
--

\unrestrict schema

