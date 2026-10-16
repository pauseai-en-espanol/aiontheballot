import { createAuthPool } from '@aiontheballot/db/auth-pool';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { createAuth } from '../src/auth/auth.js';
import { findAuthenticatorAccount, resetAuthenticator } from '../src/auth/reset-authenticator.js';
import {
  ADMIN_ORIGIN,
  browser,
  createAccount,
  deleteAccount,
  limiterAddress,
  PASSWORD,
  SECRET,
  testAddress,
  TOTP_ISSUER,
  totpCode,
} from './auth-fixtures.js';
import './db.js';

const url = process.env.TEST_AUTH_DATABASE_URL;
if (!url) {
  throw new Error('TEST_AUTH_DATABASE_URL is not set. Copy .env.example to .env.');
}
const pool = createAuthPool({ connectionString: url, maxConnections: 4 });
const options = { pool, secret: SECRET, adminOrigin: ADMIN_ORIGIN, totpIssuer: TOTP_ISSUER };
const app = buildApp({ admin: { auth: { auth: createAuth(options), adminOrigin: ADMIN_ORIGIN } } });

// The command as it is, its own imports resolved as the build would (tests/ts-resolve.mjs).
const TS_RESOLVE = fileURLToPath(new URL('./ts-resolve.mjs', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../src/reset-authenticator.ts', import.meta.url));

/** Runs the command with sign-in's settings, answering its questions with `answers`, one per line. */
const command = (answers: string[], databaseUrl = url) =>
  new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, ['--import', TS_RESOLVE, SCRIPT], {
      env: {
        PATH: process.env.PATH ?? '',
        ADMIN_ORIGIN,
        AUTH_DATABASE_URL: databaseUrl,
        BETTER_AUTH_SECRET: SECRET,
        PLATFORM_NAME: TOTP_ISSUER,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(answers.map((answer) => `${answer}\n`).join(''));
  });

const accounts: string[] = [];
const addresses: string[] = [];

const account = async () => {
  const created = await createAccount(pool);
  accounts.push(created.id);
  return created;
};

const visitor = () => {
  const address = testAddress();
  addresses.push(address);
  return browser(app, address);
};
type Visitor = ReturnType<typeof visitor>;

const signIn = (who: Visitor, email: string) =>
  who.send('POST', '/api/auth/sign-in/email', { email, password: PASSWORD });

const stage = async (who: Visitor) => {
  const response = await who.send('GET', '/api/session');
  return response.statusCode === 200
    ? response.json<{ stage: string }>().stage
    : String(response.statusCode);
};

/** Signs in and enrols TOTP through the endpoints, as the admin's enrolment page does. */
const enrol = async (who: Visitor, email: string) => {
  expect((await signIn(who, email)).statusCode).toBe(200);
  const enabled = await who.send('POST', '/api/auth/two-factor/enable', { password: PASSWORD });
  expect(enabled.statusCode).toBe(200);
  const { totpURI, backupCodes } = enabled.json<{ totpURI: string; backupCodes: string[] }>();
  const verified = await who.send('POST', '/api/auth/two-factor/verify-totp', {
    code: totpCode(totpURI),
  });
  expect(verified.statusCode).toBe(200);
  return { totpURI, backupCodes };
};

/** Signs in with the password and a code, as the challenge page does. */
const signInWithCode = async (who: Visitor, email: string, totpURI: string) => {
  expect((await signIn(who, email)).statusCode).toBe(200);
  return who.send('POST', '/api/auth/two-factor/verify-totp', { code: totpCode(totpURI) });
};

const stored = async (userId: string) =>
  (
    await pool.query<{
      enabled: boolean | null;
      factors: number;
      sessions: number;
      pending: number;
    }>(
      `SELECT u.two_factor_enabled AS enabled,
              (SELECT count(*)::int FROM two_factors f WHERE f.user_id = u.id) AS factors,
              (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id) AS sessions,
              (SELECT count(*)::int FROM verifications v
                WHERE v.value = u.id::text
                  AND (v.identifier LIKE '2fa-%' OR v.identifier LIKE 'trust-device-%')) AS pending
         FROM users u WHERE u.id = $1`,
      [userId],
    )
  ).rows[0];

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  for (const id of accounts) {
    await deleteAccount(pool, id);
  }
  for (const address of addresses) {
    await pool.query(`DELETE FROM rate_limits WHERE key LIKE $1 || '|%' OR key LIKE $2 || '|%'`, [
      address,
      limiterAddress(address),
    ]);
  }
  await app.close();
  await pool.end();
});

describe("the owner's reset of a lost authenticator (editorial workflow A5.4, ADR-0002 §10)", () => {
  it('finds the account by its address as Better Auth keeps it, and tells nothing else about it', async () => {
    const { id, email } = await account();
    await enrol(visitor(), email);
    const found = await findAuthenticatorAccount(pool, `  ${email.toUpperCase()} `);
    expect(found).toEqual({ userId: id, enrolled: true, sessions: 1 });
    expect(await findAuthenticatorAccount(pool, `nadie-${crypto.randomUUID()}@example.org`)).toBe(
      undefined,
    );
  });

  it('removes the authenticator, its backup codes and every session, so the next sign-in enrols again', async () => {
    const { id, email } = await account();
    const first = visitor();
    const { totpURI, backupCodes } = await enrol(first, email);
    const second = visitor();
    expect((await signInWithCode(second, email, totpURI)).statusCode).toBe(200);
    // A sign-in waiting for its code when the reset comes, and a trusted device Better Auth would honour (the admin
    // never asks for one, R85, but the reset doesn't rely on that).
    const waiting = visitor();
    expect((await signIn(waiting, email)).statusCode).toBe(200);
    await pool.query(
      `INSERT INTO verifications (identifier, value, expires_at)
       VALUES ('trust-device-' || gen_random_uuid(), $1, now() + interval '30 days')`,
      [id],
    );
    expect(await stage(first)).toBe('signed-in');
    expect(await stored(id)).toMatchObject({ enabled: true, factors: 1, sessions: 2, pending: 2 });

    expect(await resetAuthenticator(pool, id)).toEqual({ kind: 'reset', sessions: 2 });
    expect(await stored(id)).toEqual({ enabled: false, factors: 0, sessions: 0, pending: 0 });
    // Both sessions are over, and the waiting sign-in can't finish with the old code or a backup code.
    expect(await stage(first)).toBe('401');
    expect(await stage(second)).toBe('401');
    for (const [path, body] of [
      ['/api/auth/two-factor/verify-totp', { code: totpCode(totpURI) }],
      ['/api/auth/two-factor/verify-backup-code', { code: backupCodes[0] }],
    ] as const) {
      expect((await waiting.send('POST', path, body)).statusCode, path).not.toBe(200);
    }
    expect(await stage(waiting)).not.toBe('signed-in');

    // The password still works, and leads to enrolment: a new secret, and only its codes count.
    const next = visitor();
    expect((await signIn(next, email)).statusCode).toBe(200);
    expect(await stage(next)).toBe('enrol');
    const enabled = await next.send('POST', '/api/auth/two-factor/enable', { password: PASSWORD });
    expect(enabled.statusCode).toBe(200);
    const fresh = enabled.json<{ totpURI: string }>().totpURI;
    expect(new URL(fresh).searchParams.get('secret')).not.toBe(
      new URL(totpURI).searchParams.get('secret'),
    );
    expect(
      (await next.send('POST', '/api/auth/two-factor/verify-totp', { code: totpCode(fresh) }))
        .statusCode,
    ).toBe(200);
    expect(await stage(next)).toBe('signed-in');
  });

  it("forgets the account's unused links to choose a password, which would hand it to whoever reads its mail", async () => {
    // A link is sent only to an account with its second factor (ADR-0002 §10); once that is gone, a new password
    // would let the mailbox's reader enrol an authenticator of their own.
    const { id, email } = await account();
    await enrol(visitor(), email);
    const other = await account();
    const link = async (userId: string) => {
      const token = crypto.randomUUID();
      await pool.query(
        `INSERT INTO verifications (identifier, value, expires_at) VALUES ($1, $2, now() + interval '1 hour')`,
        [createHash('sha256').update(`reset-password:${token}`).digest('base64url'), userId],
      );
      return token;
    };
    const token = await link(id);
    const othersToken = await link(other.id);

    expect(await resetAuthenticator(pool, id)).toMatchObject({ kind: 'reset' });
    const reset = await visitor().send('POST', '/api/auth/reset-password', {
      token,
      newPassword: 'otra contraseña de ejemplo',
    });
    expect(reset.statusCode).not.toBe(200);
    expect((await signIn(visitor(), email)).statusCode).toBe(200);
    // Another account's link is its own.
    const stored = await pool.query(`SELECT 1 FROM verifications WHERE identifier = $1`, [
      createHash('sha256').update(`reset-password:${othersToken}`).digest('base64url'),
    ]);
    expect(stored.rowCount).toBe(1);
  });

  it('changes nothing for an account without an authenticator, or one that is gone', async () => {
    const { id, email } = await account();
    const who = visitor();
    expect((await signIn(who, email)).statusCode).toBe(200);
    expect(await findAuthenticatorAccount(pool, email)).toEqual({
      userId: id,
      enrolled: false,
      sessions: 1,
    });
    expect(await resetAuthenticator(pool, id)).toEqual({ kind: 'not-enrolled' });
    expect(await stored(id)).toMatchObject({ sessions: 1 });
    expect(await stage(who)).toBe('enrol');
    expect(await resetAuthenticator(pool, crypto.randomUUID())).toEqual({ kind: 'unknown' });
  });

  it('resets an account whose factor is stored though it says it has none, which enrolment could never replace', async () => {
    const { id, email } = await account();
    const { totpURI } = await enrol(visitor(), email);
    await pool.query('UPDATE users SET two_factor_enabled = false WHERE id = $1', [id]);
    // Stuck: no code is asked at sign-in, and enrolment refuses a second factor.
    const stuck = visitor();
    expect((await signIn(stuck, email)).statusCode).toBe(200);
    expect(
      (await stuck.send('POST', '/api/auth/two-factor/enable', { password: PASSWORD })).statusCode,
    ).not.toBe(200);
    expect(await findAuthenticatorAccount(pool, email)).toMatchObject({ enrolled: true });
    expect(await resetAuthenticator(pool, id)).toMatchObject({ kind: 'reset' });
    const next = visitor();
    const fresh = await enrol(next, email);
    expect(fresh.totpURI).not.toBe(totpURI);
    expect(await stage(next)).toBe('signed-in');
  });

  describe('against a code checked at the same moment (migration aal2_needs_second_factor)', () => {
    /** An aal2 session as Better Auth inserts one when a code is right. */
    const insertSession = (client: { query: typeof pool.query }, userId: string) =>
      client.query(
        `INSERT INTO sessions (expires_at, token, updated_at, user_id, aal)
         VALUES (now() + interval '12 hours', gen_random_uuid()::text, now(), $1, 2)`,
        [userId],
      );

    it('refuses a session a code would open once the reset has deleted the factor', async () => {
      const { id, email } = await account();
      await enrol(visitor(), email);
      const reset = await pool.connect();
      try {
        // The reset's transaction as it runs, its locks taken and the factor deleted, not yet committed: the session
        // waits for it, then finds no factor.
        await reset.query('BEGIN');
        await reset.query('SELECT 1 FROM two_factors WHERE user_id = $1 FOR UPDATE', [id]);
        await reset.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [id]);
        await reset.query('DELETE FROM two_factors WHERE user_id = $1', [id]);
        const inserted = insertSession(pool, id).then(
          () => 'inserted',
          (error: { code?: string }) => error.code,
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
        await reset.query('COMMIT');
        expect(await inserted).toBe('42501');
      } finally {
        reset.release();
      }
      // With no factor at all, no aal2 session can be written either.
      await expect(insertSession(pool, id)).rejects.toMatchObject({ code: '42501' });
    });

    it('ends a session whose code was checked just before, with the others', async () => {
      const { id, email } = await account();
      await enrol(visitor(), email);
      const code = await pool.connect();
      try {
        // A code's session being written: the reset waits for it, then ends it too.
        await code.query('BEGIN');
        await insertSession(code, id);
        const outcome = resetAuthenticator(pool, id);
        await new Promise((resolve) => setTimeout(resolve, 200));
        await code.query('COMMIT');
        expect(await outcome).toEqual({ kind: 'reset', sessions: 2 });
      } finally {
        code.release();
      }
      expect(await stored(id)).toMatchObject({ factors: 0, sessions: 0 });
    });
  });

  it('is run by the owner, asks before it changes anything, and prints no personal data', async () => {
    const { id, email } = await account();
    await enrol(visitor(), email);

    const mistyped = await command([email, `x${email}`]);
    expect(mistyped.code).toBe(1);
    expect(mistyped.stderr).toContain('The two addresses differ. Nothing was changed.');
    expect(mistyped.stdout).toBe('');

    const declined = await command([email, email, 'no']);
    expect(declined.code).toBe(1);
    expect(declined.stdout).toContain(`Account ${id} has an authenticator and 1 open session(s).`);
    expect(declined.stderr).toContain('Not confirmed. Nothing was changed.');
    expect(await stored(id)).toMatchObject({ enabled: true, sessions: 1 });

    const done = await command([email.toUpperCase(), ` ${email}`, 'reset']);
    expect(done.code).toBe(0);
    expect(done.stdout).toContain(
      `Done: account ${id} has no authenticator now, and 1 session(s) ended.`,
    );
    expect(await stored(id)).toEqual({ enabled: false, factors: 0, sessions: 0, pending: 0 });

    const again = await command([email, email]);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain(`Account ${id} has no authenticator`);
    const nobody = `nadie-${crypto.randomUUID()}@example.org`;
    const unknown = await command([nobody, nobody]);
    expect(unknown.stderr).toContain('No account has that email address. Nothing was changed.');
    // A fault is told by its code alone.
    const unreachable = new URL(url);
    unreachable.port = '1';
    const failed = await command([email, email], unreachable.toString());
    expect(failed.code).toBe(1);
    expect(failed.stderr).toMatch(/The reset failed \(\w+\), and may not have been applied/);
    for (const [run, address] of [
      [mistyped, email],
      [declined, email],
      [done, email],
      [again, email],
      [unknown, nobody],
      [failed, email],
    ] as const) {
      const printed = `${run.stdout}${run.stderr}`.toLowerCase();
      expect(printed).not.toContain(address.split('@')[0]);
      expect(printed).not.toContain('persona de ejemplo');
    }
  });
});
