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
-- Name: app; Type: SCHEMA; Schema: -; Owner: ballot_owner
--

CREATE SCHEMA app;


ALTER SCHEMA app OWNER TO ballot_owner;

--
-- Name: private; Type: SCHEMA; Schema: -; Owner: ballot_owner
--

CREATE SCHEMA private;


ALTER SCHEMA private OWNER TO ballot_owner;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: ballot_owner
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


ALTER TABLE public.schema_migrations OWNER TO ballot_owner;

--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: ballot_owner
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: SCHEMA app; Type: ACL; Schema: -; Owner: ballot_owner
--

GRANT USAGE ON SCHEMA app TO ballot_web;
GRANT USAGE ON SCHEMA app TO ballot_admin;
GRANT USAGE ON SCHEMA app TO ballot_worker;


--
-- Name: SCHEMA private; Type: ACL; Schema: -; Owner: ballot_owner
--

GRANT USAGE ON SCHEMA private TO ballot_web;
GRANT USAGE ON SCHEMA private TO ballot_admin;
GRANT USAGE ON SCHEMA private TO ballot_worker;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: -; Owner: ballot_owner
--

ALTER DEFAULT PRIVILEGES FOR ROLE ballot_owner REVOKE ALL ON FUNCTIONS FROM PUBLIC;


--
-- PostgreSQL database dump complete
--

\unrestrict schema

