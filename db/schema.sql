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
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: -; Owner: aiontheballot_owner
--

ALTER DEFAULT PRIVILEGES FOR ROLE aiontheballot_owner REVOKE ALL ON FUNCTIONS FROM PUBLIC;


--
-- PostgreSQL database dump complete
--

\unrestrict schema

