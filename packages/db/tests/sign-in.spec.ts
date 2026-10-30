import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';

const CHECK_VIOLATION = '23514';
const INSUFFICIENT_PRIVILEGE = '42501';

/**
 * A fictional account with a password and a session, written as `client` (the superuser): `enrolled` says whether it
 * has its second factor, as Better Auth marks it on the account and keeps it in `two_factors`.
 */
const account = async (client: pg.Client, { enrolled = true } = {}) => {
  const user = crypto.randomUUID();
  await client.query(
    `INSERT INTO auth.users (id, name, email, email_verified, two_factor_enabled)
     VALUES ($1, 'Persona de ejemplo', $2, true, $3)`,
    [user, `persona-${user}@example.org`, enrolled ? true : null],
  );
  await client.query(
    `INSERT INTO auth.accounts (account_id, provider_id, user_id, password, updated_at)
     VALUES ($1::text, 'credential', $1::uuid, 'hash-de-ejemplo', now())`,
    [user],
  );
  if (enrolled) {
    await client.query(
      `INSERT INTO auth.two_factors (secret, backup_codes, user_id, verified) VALUES ('secreto', '[]', $1, true)`,
      [user],
    );
  }
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO auth.sessions (expires_at, token, updated_at, user_id, aal)
     VALUES (now() + interval '1 hour', $2, now(), $1, $3) RETURNING id`,
    [user, `sesion-${user}`, enrolled ? 2 : 1],
  );
  return { user, session: rows[0]!.id };
};

/** A passkey row as Better Auth's plugin writes one, for `user`. */
const passkeySql = (user: string) =>
  `INSERT INTO auth.passkeys (name, public_key, user_id, credential_id, counter, device_type, backed_up, created_at)
   VALUES ('Portátil', 'clave-publica-de-ejemplo', '${user}', gen_random_uuid()::text, 0, 'multiDevice', true, now())`;

/** A session of `user` created `ago` and ending `until`, both SQL intervals from now. */
const sessionSql = (user: string, ago: string, until: string) =>
  `INSERT INTO auth.sessions (created_at, expires_at, token, updated_at, user_id, aal)
   VALUES (now() - interval '${ago}', now() + interval '${until}', gen_random_uuid()::text, now(), '${user}', 1)`;

const count = async (client: pg.Client, sql: string, user: string): Promise<number> =>
  (await client.query<{ count: number }>(sql, [user])).rows[0]!.count;

describe('passkeys (PLAN D22)', () => {
  it('belong only to an account with its second factor, as Better Auth’s role', async () => {
    await inRolledBackTransaction(async (client) => {
      const enrolled = await account(client);
      const newcomer = await account(client, { enrolled: false });
      const reset = await account(client);
      // The owner's authenticator reset leaves an account without one; a new account has none yet.
      await client.query('UPDATE auth.users SET two_factor_enabled = false WHERE id = $1', [
        reset.user,
      ]);
      await client.query('SET LOCAL ROLE aiontheballot_auth');
      expect(await errorCode(client, passkeySql(enrolled.user))).toBeNull();
      expect(await errorCode(client, passkeySql(reset.user))).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await errorCode(client, passkeySql(newcomer.user))).toBe(INSUFFICIENT_PRIVILEGE);
      // Nor can one be moved to such an account.
      expect(
        await errorCode(
          client,
          `UPDATE auth.passkeys SET user_id = '${newcomer.user}' WHERE user_id = '${enrolled.user}'`,
        ),
      ).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });

  it('once removed, revoke their member’s tokens and end their sessions, as a changed password does', async () => {
    await inRolledBackTransaction(async (client) => {
      const owner = await account(client);
      const other = await account(client);
      await client.query('SET LOCAL ROLE aiontheballot_auth');
      for (const { user, session } of [owner, other]) {
        await client.query(passkeySql(user));
        await client.query(
          `INSERT INTO auth.member_tokens (user_id, session_id, name, token_hash, expires_at)
           VALUES ($1, $2, 'Herramienta de ejemplo', $3, now() + interval '30 days')`,
          [user, session, crypto.randomUUID().replaceAll('-', '').repeat(2)],
        );
      }
      const tokens = `SELECT count(*)::int AS count FROM auth.member_tokens
                       WHERE user_id = $1 AND revoked_at IS NULL`;
      const sessions = 'SELECT count(*)::int AS count FROM auth.sessions WHERE user_id = $1';
      // Adding one takes nothing away.
      await client.query(passkeySql(owner.user));
      expect(await count(client, tokens, owner.user)).toBe(1);
      expect(await count(client, sessions, owner.user)).toBe(1);

      await client.query(
        `DELETE FROM auth.passkeys WHERE id = (SELECT id FROM auth.passkeys WHERE user_id = $1 LIMIT 1)`,
        [owner.user],
      );
      expect(await count(client, tokens, owner.user)).toBe(0);
      expect(await count(client, sessions, owner.user)).toBe(0);
      // Someone else's are left as they were.
      expect(await count(client, tokens, other.user)).toBe(1);
      expect(await count(client, sessions, other.user)).toBe(1);
    });
  });
});

describe('sessions (PLAN D22)', () => {
  it('last a week from sign-in at most, whoever writes them', async () => {
    await inRolledBackTransaction(async (client) => {
      const { user } = await account(client);
      await client.query('SET LOCAL ROLE aiontheballot_auth');
      expect(await errorCode(client, sessionSql(user, '0 seconds', '48 hours'))).toBeNull();
      expect(await errorCode(client, sessionSql(user, '6 days', '1 day'))).toBeNull();
      expect(await errorCode(client, sessionSql(user, '6 days', '1 day 1 second'))).toBe(
        CHECK_VIOLATION,
      );
      expect(await errorCode(client, sessionSql(user, '0 seconds', '8 days'))).toBe(
        CHECK_VIOLATION,
      );
      // Moving one's end on stops at the week too, and so does moving its start back.
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO auth.sessions (expires_at, token, updated_at, user_id, aal)
         VALUES (now() + interval '48 hours', gen_random_uuid()::text, now(), $1, 1) RETURNING id`,
        [user],
      );
      const id = rows[0]!.id;
      expect(
        await errorCode(
          client,
          `UPDATE auth.sessions SET expires_at = created_at + interval '7 days' WHERE id = '${id}'`,
        ),
      ).toBeNull();
      expect(
        await errorCode(
          client,
          `UPDATE auth.sessions SET expires_at = created_at + interval '7 days 1 second' WHERE id = '${id}'`,
        ),
      ).toBe(CHECK_VIOLATION);
      expect(
        await errorCode(
          client,
          `UPDATE auth.sessions SET created_at = created_at - interval '1 second' WHERE id = '${id}'`,
        ),
      ).toBe(CHECK_VIOLATION);
    });
  });
});
