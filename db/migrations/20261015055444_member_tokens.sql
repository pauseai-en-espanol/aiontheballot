-- migrate:up

-- A member's tokens for tools (ADR-0008, PLAN R202). A member signed in with their second factor mints a token in the
-- admin for a tool on their own machine (an MCP server), which then calls the admin API as them. Only the token's
-- SHA-256 is kept. It is minted from that member's live aal2 session, with their second factor verified, never from a
-- password alone; it lasts 30 days at most, dated by the database; it changes only when it was last used and when it
-- was revoked, both stamped by the database, and a revocation is never undone. A change of a member's password or
-- second factor revokes every token of theirs, so none outlives what it was minted from. Better Auth's role mints and
-- checks them; nothing else reaches the table. Like Better Auth's own tables it holds no tenant data (ADR-0002 §2).
CREATE TABLE auth.member_tokens (
  id uuid DEFAULT uuidv7() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  -- The session it was minted from. Not a foreign key: sessions end and are deleted, and the token outlives them.
  session_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days')
);
CREATE INDEX member_tokens_user_id_idx ON auth.member_tokens (user_id);
GRANT SELECT, INSERT ON auth.member_tokens TO aiontheballot_auth;
GRANT UPDATE (last_used_at, revoked_at) ON auth.member_tokens TO aiontheballot_auth;

CREATE FUNCTION private.member_token_minted() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
  BEGIN
    IF NEW.created_at IS DISTINCT FROM now() OR NEW.last_used_at IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'a token is dated by the database, unused and not revoked' USING ERRCODE = 'check_violation';
    END IF;
    -- The account's row, shared: a change of its password or second factor takes it exclusively before revoking its
    -- tokens (revoke_member_tokens), so it waits for a token being minted and then sees it, or this waits for that
    -- change and then finds its sessions gone.
    PERFORM 1 FROM auth.users u WHERE u.id = NEW.user_id FOR SHARE;
    PERFORM 1 FROM auth.two_factors f WHERE f.user_id = NEW.user_id AND f.verified IS NOT FALSE FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'a token needs its account''s second factor, verified' USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM 1 FROM auth.sessions s
     WHERE s.id = NEW.session_id AND s.user_id = NEW.user_id AND s.aal = 2 AND s.expires_at > now()
       FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'a token is minted only from a live session of its member, opened with their second factor'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER minted BEFORE INSERT ON auth.member_tokens
  FOR EACH ROW EXECUTE FUNCTION private.member_token_minted();

-- When it was last used and when it was revoked are the database's clock's, so a revocation is never dated later.
CREATE FUNCTION private.member_token_changes() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
  BEGIN
    IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
      RAISE EXCEPTION 'token %: a revoked token stays revoked', OLD.id USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF (to_jsonb(NEW) - 'last_used_at' - 'revoked_at') IS DISTINCT FROM (to_jsonb(OLD) - 'last_used_at' - 'revoked_at')
    THEN
      RAISE EXCEPTION 'token %: only when it was last used and when it was revoked change', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
      NEW.revoked_at := now();
    END IF;
    IF NEW.last_used_at IS DISTINCT FROM OLD.last_used_at THEN
      NEW.last_used_at := now();
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER changes BEFORE UPDATE ON auth.member_tokens
  FOR EACH ROW EXECUTE FUNCTION private.member_token_changes();

-- A change of an account's password or second factor revokes its tokens; one that takes a way in away (a password
-- set, changed or removed, a second factor removed) also ends its sessions in the same transaction, so none opened
-- before it mints a token after it. Better Auth ends them too, after (`revokeSessionsOnPasswordReset`), as does the
-- owner's reset of an authenticator (ADR-0002 §10). A secret enrolled again revokes the tokens only: enrolment runs
-- inside a session.
CREATE FUNCTION private.revoke_member_tokens() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
  DECLARE
    account uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  BEGIN
    PERFORM 1 FROM auth.users u WHERE u.id = account FOR UPDATE;
    UPDATE auth.member_tokens t SET revoked_at = now() WHERE t.user_id = account AND t.revoked_at IS NULL;
    IF TG_ARGV[0] = 'sessions' THEN
      DELETE FROM auth.sessions s WHERE s.user_id = account;
    END IF;
    RETURN NULL;
  END $$;
CREATE TRIGGER revoke_member_tokens AFTER DELETE ON auth.two_factors
  FOR EACH ROW EXECUTE FUNCTION private.revoke_member_tokens('sessions');
CREATE TRIGGER revoke_member_tokens_on_enrolment AFTER UPDATE OF secret ON auth.two_factors
  FOR EACH ROW WHEN (OLD.secret IS DISTINCT FROM NEW.secret) EXECUTE FUNCTION private.revoke_member_tokens('tokens');
CREATE TRIGGER revoke_member_tokens AFTER UPDATE OF password ON auth.accounts
  FOR EACH ROW WHEN (OLD.password IS DISTINCT FROM NEW.password)
  EXECUTE FUNCTION private.revoke_member_tokens('sessions');
CREATE TRIGGER revoke_member_tokens_on_credential AFTER INSERT OR DELETE ON auth.accounts
  FOR EACH ROW EXECUTE FUNCTION private.revoke_member_tokens('sessions');

-- Through a token, a tool drafts and a person decides (ADR-0008). The API sets `app.token_id` for a request that
-- carries one, as it sets `app.user_id` (ADR-0002 §3). Every table refuses a write through a token, but those drafting
-- needs: an election's own details while the public doesn't see it (never its status, announcement, freeze or review
-- rule, nor deleting it), its parties (never their programme's status, which the public sees and which reopens
-- checks), the files their logos are, changes proposed by its member (never a decision on one, nor withdrawing
-- someone else's), and what the database writes itself for those (the audit log, the public cache). A table added
-- later refuses it too, until a catalog test's list says otherwise.
CREATE FUNCTION private.needs_a_person() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
  BEGIN
    IF coalesce(current_setting('app.token_id', true), '') <> '' THEN
      RAISE EXCEPTION 'a member''s token can''t %: a person does it in the admin', TG_ARGV[0]
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END $$;
DO $$
  DECLARE
    t record;
  BEGIN
    FOR t IN SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
                AND c.relname NOT IN ('elections', 'parties', 'files', 'change_requests', 'audit_log',
                                      'public_versions')
    LOOP
      EXECUTE format('CREATE TRIGGER needs_a_person BEFORE INSERT OR UPDATE OR DELETE ON app.%I
                        FOR EACH ROW EXECUTE FUNCTION private.needs_a_person(%L)', t.relname, 'change ' || t.relname);
    END LOOP;
  END
  $$;
CREATE TRIGGER needs_a_person BEFORE UPDATE ON app.elections
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.announced IS DISTINCT FROM NEW.announced
                     OR OLD.frozen_from IS DISTINCT FROM NEW.frozen_from
                     OR OLD.frozen_until IS DISTINCT FROM NEW.frozen_until
                     OR OLD.require_second_reviewer IS DISTINCT FROM NEW.require_second_reviewer)
  EXECUTE FUNCTION private.needs_a_person('change when or whether an election is shown or reviewed');
CREATE TRIGGER needs_a_person_to_delete BEFORE DELETE ON app.elections
  FOR EACH ROW EXECUTE FUNCTION private.needs_a_person('delete an election');
-- One the public already sees (announced on the coming-soon page, or live and after): its name, date or address would
-- change there with no one deciding. A live one's changes go through change requests (change_control).
CREATE TRIGGER needs_a_person_once_public BEFORE UPDATE ON app.elections
  FOR EACH ROW WHEN (OLD.announced OR OLD.status IN ('live', 'archived'))
  EXECUTE FUNCTION private.needs_a_person('change an election the public sees');
CREATE TRIGGER needs_a_person BEFORE UPDATE ON app.parties
  FOR EACH ROW WHEN (OLD.programme_status IS DISTINCT FROM NEW.programme_status)
  EXECUTE FUNCTION private.needs_a_person('change whether a party''s programme is published');
-- Files are logos only: the public assets bucket, never a source's copy nor anything else.
CREATE TRIGGER needs_a_person BEFORE INSERT ON app.files
  FOR EACH ROW WHEN (NEW.bucket <> 'public_assets') EXECUTE FUNCTION private.needs_a_person('store this file');
CREATE TRIGGER needs_a_person_to_change BEFORE UPDATE OR DELETE ON app.files
  FOR EACH ROW WHEN (OLD.bucket <> 'public_assets') EXECUTE FUNCTION private.needs_a_person('store this file');
-- A change starts pending (the admin role has no grant on its state), so deciding is changing its state.
CREATE TRIGGER needs_a_person BEFORE UPDATE OF state ON app.change_requests
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION private.needs_a_person('decide on a change');
-- Withdrawing a change its own member proposed, never someone else's.
CREATE TRIGGER needs_a_person_to_withdraw BEFORE DELETE ON app.change_requests
  FOR EACH ROW WHEN (OLD.proposed_by IS DISTINCT FROM private.current_user_id())
  EXECUTE FUNCTION private.needs_a_person('withdraw someone else''s change');

-- The audit log names the token beside its member, for what a request carrying one wrote: the API's word, as the
-- member's id is (ADR-0002 §3). Its id only: the name its member gave it is theirs to change in `auth` (the admin shows
-- it from there), and may say more about them than the log should keep. `private.audit` is the log's only writer.
ALTER TABLE app.audit_log ADD COLUMN token_id uuid;

CREATE OR REPLACE FUNCTION private.audit() RETURNS trigger
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
    IF private.purging(TG_RELID) THEN
      RETURN NULL;  -- the tenant's audit rows are deleted with it
    END IF;
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

    INSERT INTO app.audit_log (tenant_id, actor_id, action, table_name, row_id, diff, token_id)
    VALUES (
      (CASE WHEN TG_TABLE_SCHEMA = 'app' AND TG_TABLE_NAME = 'tenants' THEN subject ->> 'id'
            ELSE subject ->> 'tenant_id' END)::uuid,
      private.current_user_id(),
      lower(TG_OP),
      TG_TABLE_NAME,
      CASE WHEN cardinality(key_columns) = 1 THEN subject ->> key_columns[1]
           ELSE (SELECT jsonb_object_agg(c, subject -> c) FROM unnest(key_columns) c)::text END,
      diff,
      nullif(current_setting('app.token_id', true), '')::uuid);
    RETURN NULL;
  END
  $$;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
