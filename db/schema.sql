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

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: aiontheballot_owner
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


ALTER TABLE public.schema_migrations OWNER TO aiontheballot_owner;

--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: aiontheballot_owner
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


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
-- Name: TYPE job_kind; Type: ACL; Schema: app; Owner: aiontheballot_owner
--

REVOKE ALL ON TYPE app.job_kind FROM PUBLIC;


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
-- Name: FUNCTION normalize_for_match(input text); Type: ACL; Schema: private; Owner: aiontheballot_owner
--

REVOKE ALL ON FUNCTION private.normalize_for_match(input text) FROM PUBLIC;


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

