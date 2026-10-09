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
	CONSTRAINT localized_check CHECK (
CASE
    WHEN (jsonb_typeof(VALUE) = 'object'::text) THEN ((VALUE <> '{}'::jsonb) AND (NOT jsonb_path_exists(VALUE, '$.keyvalue()?(!(@."key" like_regex "^[a-z]{2}(-[a-z]{2})?$"))'::jsonpath)) AND (NOT jsonb_path_exists(VALUE, '$.*?(@.type() != "string" || !(@ like_regex "[^[:space:]]"))'::jsonpath)))
    ELSE false
END);


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

SET default_tablespace = '';

SET default_table_access_method = heap;

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
-- Name: memberships memberships_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.memberships
    ADD CONSTRAINT memberships_pkey PRIMARY KEY (user_id, tenant_id, role);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


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
-- Name: tenant_brand_selections tenant_brand_selections_pkey; Type: CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.tenant_brand_selections
    ADD CONSTRAINT tenant_brand_selections_pkey PRIMARY KEY (tenant_id, slot);


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
-- Name: audit_log_tenant_id_at_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX audit_log_tenant_id_at_idx ON app.audit_log USING btree (tenant_id, at DESC);


--
-- Name: brand_asset_grants_tenant_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX brand_asset_grants_tenant_id_idx ON app.brand_asset_grants USING btree (tenant_id);


--
-- Name: memberships_tenant_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX memberships_tenant_id_idx ON app.memberships USING btree (tenant_id);


--
-- Name: organizations_logo_asset_id_idx; Type: INDEX; Schema: app; Owner: aiontheballot_owner
--

CREATE INDEX organizations_logo_asset_id_idx ON app.organizations USING btree (logo_asset_id);


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
-- Name: brand_asset_grants audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.brand_asset_grants FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: brand_assets audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.brand_assets FOR EACH ROW EXECUTE FUNCTION private.audit();


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
-- Name: memberships audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.memberships FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: organizations audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.organizations FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: platform_admins audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.platform_admins FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: platform_hostnames audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.platform_hostnames FOR EACH ROW EXECUTE FUNCTION private.audit();


--
-- Name: tenant_brand_selections audit; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER audit AFTER INSERT OR DELETE OR UPDATE ON app.tenant_brand_selections FOR EACH ROW EXECUTE FUNCTION private.audit();


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
-- Name: organizations bump_public_version; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER bump_public_version AFTER INSERT OR DELETE OR UPDATE ON app.organizations FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();


--
-- Name: tenant_brand_selections bump_public_version; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER bump_public_version AFTER INSERT OR DELETE OR UPDATE ON app.tenant_brand_selections FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();


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
-- Name: audit_log forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.audit_log FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: brand_asset_grants forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.brand_asset_grants FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: invitations forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.invitations FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: memberships forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.memberships FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: public_versions forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.public_versions FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


--
-- Name: tenant_brand_selections forbid_tenant_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.tenant_brand_selections FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();


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
-- Name: hostname_tombstones forbid_truncate; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_truncate BEFORE TRUNCATE ON app.hostname_tombstones FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_mutation();


--
-- Name: tenant_hostnames forbid_truncate; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER forbid_truncate BEFORE TRUNCATE ON app.tenant_hostnames FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_mutation();


--
-- Name: platform_hostnames is_free; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER is_free BEFORE INSERT ON app.platform_hostnames FOR EACH ROW EXECUTE FUNCTION private.platform_hostname_is_free();


--
-- Name: tenants members_may_change; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER members_may_change BEFORE UPDATE ON app.tenants FOR EACH ROW EXECUTE FUNCTION private.members_may_change('theme', 'report_retention_days', 'llm_monthly_cap_usd');


--
-- Name: tenant_hostnames rules; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.tenant_hostnames FOR EACH ROW EXECUTE FUNCTION private.tenant_hostname_rules();


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
-- Name: invitations stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.invitations FOR EACH ROW EXECUTE FUNCTION private.stamp('created_by', 'created_at');


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
-- Name: tenant_hostnames stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.tenant_hostnames FOR EACH ROW EXECUTE FUNCTION private.stamp('created_at');


--
-- Name: tenants stamp; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.tenants FOR EACH ROW EXECUTE FUNCTION private.stamp('created_at');


--
-- Name: invitations transition; Type: TRIGGER; Schema: app; Owner: aiontheballot_owner
--

CREATE TRIGGER transition BEFORE UPDATE ON app.invitations FOR EACH ROW EXECUTE FUNCTION private.invitation_transition();


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
-- Name: memberships memberships_tenant_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.memberships
    ADD CONSTRAINT memberships_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES app.tenants(id);


--
-- Name: organizations organizations_logo_asset_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.organizations
    ADD CONSTRAINT organizations_logo_asset_id_fkey FOREIGN KEY (logo_asset_id) REFERENCES app.brand_assets(id);


--
-- Name: public_versions public_versions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE ONLY app.public_versions
    ADD CONSTRAINT public_versions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES app.tenants(id);


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
-- Name: invitations country_admin_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_delete ON app.invitations FOR DELETE TO aiontheballot_admin USING ((((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)) AND ((accepted_at IS NOT NULL) OR (revoked_at IS NOT NULL) OR (expires_at <= now()))));


--
-- Name: memberships country_admin_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_delete ON app.memberships FOR DELETE TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: tenant_brand_selections country_admin_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_delete ON app.tenant_brand_selections FOR DELETE TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: invitations country_admin_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_insert ON app.invitations FOR INSERT TO aiontheballot_admin WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: memberships country_admin_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_insert ON app.memberships FOR INSERT TO aiontheballot_admin WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: tenant_brand_selections country_admin_insert; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_insert ON app.tenant_brand_selections FOR INSERT TO aiontheballot_admin WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


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
-- Name: tenant_brand_selections country_admin_update; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_update ON app.tenant_brand_selections FOR UPDATE TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin))) WITH CHECK (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: tenants country_admin_update; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY country_admin_update ON app.tenants FOR UPDATE TO aiontheballot_admin USING (((id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin))) WITH CHECK (((id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


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
-- Name: memberships member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.memberships FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: organizations member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.organizations FOR SELECT TO aiontheballot_admin USING (((EXISTS ( SELECT 1
   FROM app.tenant_organizations o
  WHERE ((o.organization_id = organizations.id) AND (o.tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants))))) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


--
-- Name: tenant_brand_selections member_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY member_read ON app.tenant_brand_selections FOR SELECT TO aiontheballot_admin USING (((tenant_id IN ( SELECT private.my_tenants(VARIADIC ARRAY['country_admin'::app.tenant_role, 'editor'::app.tenant_role, 'reviewer'::app.tenant_role]) AS my_tenants)) OR ( SELECT private.is_platform_admin() AS is_platform_admin)));


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
-- Name: memberships; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_asset_grants platform_admin_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_delete ON app.brand_asset_grants FOR DELETE TO aiontheballot_admin USING (( SELECT private.is_platform_admin() AS is_platform_admin));


--
-- Name: brand_assets platform_admin_delete; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY platform_admin_delete ON app.brand_assets FOR DELETE TO aiontheballot_admin USING (( SELECT private.is_platform_admin() AS is_platform_admin));


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
-- Name: hostname_tombstones public_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY public_read ON app.hostname_tombstones FOR SELECT TO aiontheballot_web USING (true);


--
-- Name: organizations public_read; Type: POLICY; Schema: app; Owner: aiontheballot_owner
--

CREATE POLICY public_read ON app.organizations FOR SELECT TO aiontheballot_web USING ((EXISTS ( SELECT 1
   FROM (app.tenant_organizations o
     JOIN app.tenants t ON ((t.id = o.tenant_id)))
  WHERE ((o.organization_id = organizations.id) AND t.active))));


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
-- Name: tenant_brand_selections; Type: ROW SECURITY; Schema: app; Owner: aiontheballot_owner
--

ALTER TABLE app.tenant_brand_selections ENABLE ROW LEVEL SECURITY;

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
-- Name: FUNCTION audit(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.audit() FROM PUBLIC;


--
-- Name: FUNCTION bump_public_version(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.bump_public_version() FROM PUBLIC;


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


--
-- Name: FUNCTION platform_hostname_is_free(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.platform_hostname_is_free() FROM PUBLIC;


--
-- Name: FUNCTION stamp(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.stamp() FROM PUBLIC;


--
-- Name: FUNCTION tenant_hostname_rules(); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.tenant_hostname_rules() FROM PUBLIC;


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

