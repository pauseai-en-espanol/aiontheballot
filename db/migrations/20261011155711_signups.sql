-- migrate:up

-- "Avísame cuando esté listo": each site's own signup list, double opt-in (PLAN R119, R122; public-site spec §6).
--
-- - The public reaches it only through three SECURITY DEFINER functions that only aiontheballot_web may execute
--   (ADR-0002 §6, §7): app.sign_up, app.confirm_signup and app.unsubscribe. The API makes each token (256 random
--   bits) and passes only its SHA-256, so no token is ever stored or seen by the database.
-- - A site takes signups only while it is active and has a published privacy policy, which the form links to.
-- - An address is on a site's list once. Signing up again while unconfirmed issues a new token, with the newest
--   choices; once confirmed, it changes nothing, so a stranger can't. Confirmation emails to one mailbox (its address
--   with any +tag left out, so variants count as one) go at most every 10 minutes and 5 times in all, and a site sends
--   at most 1,000 a day. The cap is checked first, for every address, so its answer says nothing about who is listed.
-- - Unconfirmed signups are deleted 7 days after the first: every call of the three functions deletes those due, and
--   the API calls app.confirm_signup(NULL, NULL) hourly to do only that.
-- - A token acts only on its own site's list. After confirming, the same token unsubscribes; unsubscribing deletes the
--   row, confirmed or not (the confirmation email's "this wasn't me" link uses it).
-- - Country admins and platform admins count signups: every column but the address, the mailbox and the token (column
--   grants). No runtime role reads the addresses: how the launch email reads them waits for a decision (PLAN R122).

CREATE TABLE app.signups (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id         uuid NOT NULL REFERENCES app.tenants,
  email             text NOT NULL
                    CHECK (email = lower(email) AND char_length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+$'),
  -- The address without its +tag: the mailbox the throttle counts, whatever variant was typed.
  mailbox           text NOT NULL GENERATED ALWAYS AS
                    (split_part(split_part(email, '@', 1), '+', 1) || '@' || split_part(email, '@', 2)) STORED,
  locale            app.locale NOT NULL,              -- the form's language: its emails are written in it
  future_elections  boolean NOT NULL DEFAULT false,   -- the optional, unticked box
  token_hash        text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),  -- hex SHA-256 of the newest token
  token_issued_at   timestamptz NOT NULL DEFAULT now(),
  tokens_issued     int NOT NULL DEFAULT 1 CHECK (tokens_issued BETWEEN 1 AND 5),
  created_at        timestamptz NOT NULL DEFAULT now(),
  confirmed_at      timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, email)
);
CREATE INDEX signups_unconfirmed_idx ON app.signups (created_at) WHERE confirmed_at IS NULL;
CREATE INDEX signups_mailbox_idx ON app.signups (tenant_id, mailbox);

COMMENT ON COLUMN app.signups.email IS 'personal data';
COMMENT ON COLUMN app.signups.mailbox IS 'personal data';
-- Not an address, but tied to one: kept out of the audit log, which outlives the row.
COMMENT ON COLUMN app.signups.token_hash IS 'personal data';

-- Confirmation emails sent per site and UTC day, written only by app.sign_up: the daily cap's counter.
CREATE TABLE app.signup_daily_counts (
  tenant_id  uuid NOT NULL REFERENCES app.tenants,
  day        date NOT NULL,
  count      int NOT NULL CHECK (count >= 0),
  PRIMARY KEY (tenant_id, day)
);

-- Deletes every signup still unconfirmed 7 days after it was made. Called by the three functions below only.
CREATE FUNCTION private.delete_expired_signups() RETURNS void
  LANGUAGE sql
  SET search_path = ''
  AS $$
    DELETE FROM app.signups s WHERE s.confirmed_at IS NULL AND s.created_at <= now() - interval '7 days'
  $$;

-- Signs an address up to a site's list, or issues it a new token. Returns whether to send a confirmation email with
-- the token whose hash was given: false when the address is already confirmed, or when its mailbox was sent one too
-- recently or too often. The answer never reaches the public, so whether an address is on a list stays private.
CREATE FUNCTION app.sign_up(tenant uuid, email text, locale text, future_elections boolean, token_hash text)
  RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $$
  DECLARE
    daily_cap constant int := 1000;  -- confirmation emails per site and UTC day; far above normal use
    today date := (now() AT TIME ZONE 'UTC')::date;
    address text := lower(btrim(email));
    existing app.signups;
    known boolean;
    sent int;
    box record;
  BEGIN
    PERFORM private.delete_expired_signups();
    IF NOT EXISTS (SELECT 1 FROM app.tenants t
                    WHERE t.id = tenant AND t.active AND sign_up.locale = ANY (t.enabled_locales))
       OR NOT EXISTS (SELECT 1 FROM app.tenant_documents d
                       WHERE d.tenant_id = tenant AND d.kind = 'privacy_policy' AND d.published_at IS NOT NULL) THEN
      RAISE EXCEPTION 'this site takes no signups' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- The cap first, for every address alike. Locking the day's counter also makes a site's signups take turns, so
    -- two signups of one new address at once can't both insert it.
    INSERT INTO app.signup_daily_counts AS c (tenant_id, day, count) VALUES (tenant, today, 0)
      ON CONFLICT ON CONSTRAINT signup_daily_counts_pkey DO NOTHING;
    SELECT c.count INTO sent FROM app.signup_daily_counts c WHERE c.tenant_id = tenant AND c.day = today FOR UPDATE;
    IF sent >= daily_cap THEN
      RAISE EXCEPTION 'this site sends no more confirmations today' USING ERRCODE = 'program_limit_exceeded';
    END IF;

    SELECT * INTO existing FROM app.signups s WHERE s.tenant_id = tenant AND s.email = address;
    known := FOUND;
    IF known AND existing.confirmed_at IS NOT NULL THEN
      RETURN false;
    END IF;
    SELECT max(s.token_issued_at) AS last, coalesce(sum(s.tokens_issued), 0) AS issued INTO box
      FROM app.signups s
     WHERE s.tenant_id = tenant
       AND s.mailbox = split_part(split_part(address, '@', 1), '+', 1) || '@' || split_part(address, '@', 2);
    IF box.last > now() - interval '10 minutes' OR box.issued >= 5 THEN
      RETURN false;
    END IF;

    IF known THEN
      UPDATE app.signups s
         SET locale = sign_up.locale, future_elections = coalesce(sign_up.future_elections, false),
             token_hash = sign_up.token_hash, token_issued_at = now(), tokens_issued = s.tokens_issued + 1
       WHERE s.id = existing.id;
    ELSE
      INSERT INTO app.signups (tenant_id, email, locale, future_elections, token_hash)
      VALUES (tenant, address, sign_up.locale, coalesce(sign_up.future_elections, false), sign_up.token_hash);
    END IF;
    UPDATE app.signup_daily_counts c SET count = c.count + 1 WHERE c.tenant_id = tenant AND c.day = today;
    RETURN true;
  END
  $$;

-- Confirms the unconfirmed signup of this site whose token this is. Returns whether the token now belongs to a
-- confirmed signup (so following the link twice still says it's done). NULLs only delete the expired signups (the
-- API's hourly call).
CREATE FUNCTION app.confirm_signup(tenant uuid, token_hash text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $$
  BEGIN
    PERFORM private.delete_expired_signups();
    IF tenant IS NULL OR token_hash IS NULL THEN
      RETURN false;
    END IF;
    UPDATE app.signups s SET confirmed_at = now()
     WHERE s.tenant_id = tenant AND s.token_hash = confirm_signup.token_hash AND s.confirmed_at IS NULL;
    RETURN EXISTS (SELECT 1 FROM app.signups s
                    WHERE s.tenant_id = tenant AND s.token_hash = confirm_signup.token_hash
                      AND s.confirmed_at IS NOT NULL);
  END
  $$;

-- Deletes the signup of this site whose token this is, confirmed or not. Returns whether there was one.
CREATE FUNCTION app.unsubscribe(tenant uuid, token_hash text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $$
  BEGIN
    PERFORM private.delete_expired_signups();
    DELETE FROM app.signups s WHERE s.tenant_id = tenant AND s.token_hash = unsubscribe.token_hash;
    RETURN FOUND;
  END
  $$;

-- A signup changes only through the functions above: its address and site never, its confirmation once.
CREATE FUNCTION private.signup_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      NEW.confirmed_at := NULL;
      NEW.tokens_issued := 1;
      NEW.token_issued_at := now();
      RETURN NEW;
    END IF;
    IF NEW.email IS DISTINCT FROM OLD.email OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'signup %: its address and creation never change', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.confirmed_at IS NOT NULL AND NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
      RAISE EXCEPTION 'signup % is confirmed for good', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
      NEW.confirmed_at := now();
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.signups
  FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();
CREATE TRIGGER rules BEFORE INSERT OR UPDATE ON app.signups
  FOR EACH ROW EXECUTE FUNCTION private.signup_rules();
CREATE TRIGGER stamp BEFORE INSERT ON app.signups
  FOR EACH ROW EXECUTE FUNCTION private.stamp('created_at');
-- Audited by id, site, choices and dates: the audit trigger never copies the address, the mailbox or the token.
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.signups
  FOR EACH ROW EXECUTE FUNCTION private.audit();
ALTER TABLE app.signups ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.signup_daily_counts
  FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();
ALTER TABLE app.signup_daily_counts ENABLE ROW LEVEL SECURITY;

-- purge_tenant as before (migration files_on_volume), with the site's signups and their counter.
CREATE OR REPLACE FUNCTION private.purge_tenant(tenant uuid) RETURNS bigint
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
  DECLARE
    -- Children before parents. Cells take their drafts and contributors with them.
    tables text[] := ARRAY[
      'revision_internal', 'revision_evidence', 'revision_checked_documents', 'structural_changes', 'change_requests',
      'assessment_revisions', 'review_events', 'reports', 'report_daily_counts', 'signups', 'signup_daily_counts',
      'assessment_contributors',
      'draft_checked_documents', 'draft_evidence', 'assessments', 'job_requests', 'llm_suggestions', 'llm_runs',
      'source_texts', 'source_documents', 'methodology_reviewers', 'methodologies', 'criteria', 'parties', 'elections',
      'tenant_brand_selections', 'files', 'tenant_documents', 'invitations', 'memberships',
      'brand_asset_grants', 'tenant_organizations', 'public_versions', 'tenant_hostnames', 'audit_log'];
    tenant_slug text;
    leftovers jsonb;
    counts jsonb := '{}';
    t text;
    n bigint;
    remaining text;
    logged bigint;
  BEGIN
    PERFORM set_config('app.purge', 'on', true);
    SELECT t.slug INTO tenant_slug FROM app.tenants t WHERE t.id = tenant FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no tenant %', tenant USING ERRCODE = 'no_data_found';
    END IF;

    leftovers := jsonb_build_object(
      'organizations', (SELECT coalesce(jsonb_agg(o.organization_id ORDER BY o.organization_id), '[]')
                          FROM app.tenant_organizations o
                         WHERE o.tenant_id = tenant
                           AND NOT EXISTS (SELECT 1 FROM app.tenant_organizations x
                                            WHERE x.organization_id = o.organization_id AND x.tenant_id <> tenant)),
      'users', (SELECT coalesce(jsonb_agg(DISTINCT m.user_id), '[]')
                  FROM app.memberships m
                 WHERE m.tenant_id = tenant
                   AND NOT EXISTS (SELECT 1 FROM app.memberships x WHERE x.user_id = m.user_id AND x.tenant_id <> tenant)));

    -- Its hostnames are printed on share images: they can never be claimed again.
    INSERT INTO app.hostname_tombstones (hostname)
    SELECT h.hostname FROM app.tenant_hostnames h WHERE h.tenant_id = tenant
    ON CONFLICT DO NOTHING;
    DELETE FROM app.hostname_verifications v
     WHERE v.hostname IN (SELECT h.hostname FROM app.tenant_hostnames h WHERE h.tenant_id = tenant);

    FOREACH t IN ARRAY tables LOOP
      -- Counted first: some rows go with their parents (drafts and contributors with their cells).
      EXECUTE format('SELECT count(*) FROM app.%I WHERE tenant_id = $1', t) INTO n USING tenant;
      IF t NOT IN ('assessment_contributors', 'draft_checked_documents', 'draft_evidence') THEN
        EXECUTE format('DELETE FROM app.%I WHERE tenant_id = $1', t) USING tenant;
      END IF;
      counts := counts || jsonb_build_object(t, n);
    END LOOP;

    -- Every table with a tenant_id must now be empty of it, including any this function doesn't list yet.
    FOR t IN SELECT c.relname FROM pg_catalog.pg_attribute a
               JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
               JOIN pg_catalog.pg_namespace s ON s.oid = c.relnamespace
              WHERE s.nspname = 'app' AND c.relkind IN ('r', 'p') AND a.attname = 'tenant_id' AND NOT a.attisdropped LOOP
      EXECUTE format('SELECT count(*) FROM app.%I WHERE tenant_id = $1', t) INTO n USING tenant;
      IF n > 0 THEN
        remaining := concat_ws(', ', remaining, t);
      END IF;
    END LOOP;
    IF remaining IS NOT NULL THEN
      RAISE EXCEPTION 'purging tenant % left rows in %', tenant, remaining USING ERRCODE = 'object_in_use';
    END IF;

    DELETE FROM app.tenants WHERE id = tenant;
    INSERT INTO app.purge_log (purged_tenant_id, purged_tenant_slug, purged_by, counts, leftovers)
    VALUES (tenant, tenant_slug, session_user, counts || jsonb_build_object('tenants', 1), leftovers)
    RETURNING id INTO logged;
    RETURN logged;
  END
  $_$;

GRANT EXECUTE ON FUNCTION app.sign_up(uuid, text, text, boolean, text), app.confirm_signup(uuid, text),
  app.unsubscribe(uuid, text) TO aiontheballot_web;

-- The counts, never the addresses, the mailboxes or the tokens. The counter has no grant and no policy at all.
GRANT SELECT (id, tenant_id, locale, future_elections, created_at, confirmed_at) ON app.signups
  TO aiontheballot_admin;
CREATE POLICY country_admin_read ON app.signups FOR SELECT TO aiontheballot_admin
  USING (tenant_id IN (SELECT private.my_tenants('country_admin')) OR (SELECT private.is_platform_admin()));

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
