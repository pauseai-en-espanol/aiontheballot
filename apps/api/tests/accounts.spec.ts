import { createAuthPool } from '@aiontheballot/db/auth-pool';
import { sql } from 'kysely';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { accountLink, findAccount } from '../src/auth/accounts.js';
import { createAuth, SESSION_COOKIE } from '../src/auth/auth.js';
import {
  ADMIN_ORIGIN,
  browser,
  deleteAccount,
  limiterAddress,
  PASSWORD,
  SECRET,
  testAddress,
  TOTP_ISSUER,
} from './auth-fixtures.js';
import { inRolledBackTransaction } from './db.js';
import { TENANT_A, USERS } from './fixtures.js';

const url = process.env.TEST_AUTH_DATABASE_URL;
if (!url) {
  throw new Error('TEST_AUTH_DATABASE_URL is not set. Copy .env.example to .env.');
}
const pool = createAuthPool({ connectionString: url, maxConnections: 4 });
const options = { pool, secret: SECRET, adminOrigin: ADMIN_ORIGIN, totpIssuer: TOTP_ISSUER };
const app = buildApp({ admin: { auth: { auth: createAuth(options), adminOrigin: ADMIN_ORIGIN } } });

const accounts: string[] = [];
const addresses: string[] = [];

// The command as it is, its own imports resolved as the build would (tests/ts-resolve.mjs).
const TS_RESOLVE = fileURLToPath(new URL('./ts-resolve.mjs', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../src/create-account.ts', import.meta.url));

/** Runs the command with sign-in's settings, answering its questions with `answers`, one per line. */
const command = (answers: string[]) =>
  new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, ['--import', TS_RESOLVE, SCRIPT], {
      env: {
        PATH: process.env.PATH ?? '',
        ADMIN_ORIGIN,
        AUTH_DATABASE_URL: url,
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

const newAccount = async () => {
  const email = `Persona-${crypto.randomUUID()}@Example.org`;
  const created = await accountLink(options, { email, name: ' Persona de ejemplo ' });
  accounts.push(created.userId);
  return { ...created, email: email.toLowerCase() };
};

const visitor = () => {
  const address = testAddress();
  addresses.push(address);
  return browser(app, address);
};

const tokenOf = (link: string) =>
  new URLSearchParams(new URL(link).hash.slice(1)).get('token') ?? '';

/** How Better Auth keeps a reset token's identifier: hashed (auth.ts). */
const storedIdentifier = (token: string) =>
  createHash('sha256').update(`reset-password:${token}`).digest('base64url');

const setPassword = (who: ReturnType<typeof visitor>, token: string, newPassword = PASSWORD) =>
  who.send('POST', '/api/auth/reset-password', { token, newPassword });

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  for (const id of accounts) {
    await deleteAccount(pool, id);
  }
  for (const address of addresses) {
    await pool.query(`DELETE FROM rate_limits WHERE key LIKE $1 || '|%'`, [
      limiterAddress(address),
    ]);
  }
  await app.close();
  await pool.end();
});

describe("the owner's create-account command (editorial workflow A1, PLAN R93)", () => {
  it('creates a verified account with no password, no TOTP and no role, and a link to the admin', async () => {
    const { userId, link, email, created } = await newAccount();
    expect(created).toBe(true);
    // In the fragment, which browsers send to no server.
    expect(link.startsWith(`${ADMIN_ORIGIN}/set-password#token=`)).toBe(true);
    expect(new URL(link).search).toBe('');
    const { rows } = await pool.query(
      `SELECT u.email, u.name, u.email_verified, u.two_factor_enabled,
              (SELECT count(*)::int FROM accounts a WHERE a.user_id = u.id) AS accounts,
              (SELECT extract(epoch FROM v.expires_at - v.created_at)::int FROM verifications v
                WHERE v.value = u.id::text) AS seconds,
              (SELECT v.identifier FROM verifications v WHERE v.value = u.id::text) AS identifier
         FROM users u WHERE u.id = $1`,
      [userId],
    );
    expect(rows[0]).toMatchObject({
      email,
      name: 'Persona de ejemplo',
      email_verified: true,
      two_factor_enabled: false,
      accounts: 0,
    });
    expect(rows[0]?.seconds).toBeGreaterThan(3_590);
    expect(rows[0]?.seconds).toBeLessThanOrEqual(3_600);
    // The token is kept only as its hash.
    expect(rows[0]?.identifier).toBe(storedIdentifier(tokenOf(link)));
  });

  it('refuses an address Better Auth would refuse, and makes nothing', async () => {
    for (const email of ['josé@ejemplo.es', 'ana@ejemplo.es.', 'a@b.c', 'sin-arroba', '']) {
      await expect(accountLink(options, { email, name: 'Persona' }), email).rejects.toThrow(
        /not an email address/,
      );
    }
    const { rows } = await pool.query(
      `SELECT 1 FROM users WHERE email IN ('josé@ejemplo.es', 'a@b.c')`,
    );
    expect(rows).toEqual([]);
  });

  it('gives a new link to an account that never set its password, and only to such an account', async () => {
    const { userId, email, link } = await newAccount();
    const again = await accountLink(options, { email, name: '' });
    expect(again).toMatchObject({ userId, created: false });
    expect(tokenOf(again.link)).not.toBe(tokenOf(link));
    // The new link replaces the old one, which may have gone astray.
    const old = await setPassword(visitor(), tokenOf(link));
    expect(old.json()).toMatchObject({ code: 'INVALID_TOKEN' });
    expect((await setPassword(visitor(), tokenOf(again.link))).statusCode).toBe(200);
    await expect(accountLink(options, { email, name: '' })).rejects.toThrow(/has a password/);
  });

  it('refuses an email whose account has a password, whatever its case', async () => {
    const { email, link } = await newAccount();
    expect((await setPassword(visitor(), tokenOf(link))).statusCode).toBe(200);
    await expect(
      accountLink(options, { email: email.toUpperCase(), name: 'Otra persona' }),
    ).rejects.toThrow(/already exists/);
  });

  it('sets the password once, through the link, then signs in to enrolment', async () => {
    const { link, email } = await newAccount();
    const who = visitor();
    // A short password is refused, and leaves the link usable.
    const short = await setPassword(who, tokenOf(link), 'once letras');
    expect(short.statusCode).toBe(400);
    expect(short.json()).toMatchObject({ code: 'PASSWORD_TOO_SHORT' });
    const set = await setPassword(who, tokenOf(link));
    expect(set.statusCode).toBe(200);
    expect(set.headers['set-cookie']).toBeUndefined();
    // Once only.
    const again = await setPassword(who, tokenOf(link), 'otra contraseña de ejemplo');
    expect(again.statusCode).toBe(400);
    expect(again.json()).toMatchObject({ code: 'INVALID_TOKEN' });

    const signedIn = await who.send('POST', '/api/auth/sign-in/email', {
      email,
      password: PASSWORD,
    });
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.cookies.map((c) => c.name)).toEqual([SESSION_COOKIE]);
    expect((await who.send('GET', '/api/session')).json()).toMatchObject({ stage: 'enrol' });
  });

  it("ends the account's other sessions when a password is set", async () => {
    const { userId, link, email } = await newAccount();
    const who = visitor();
    expect((await setPassword(who, tokenOf(link))).statusCode).toBe(200);
    expect(
      (await who.send('POST', '/api/auth/sign-in/email', { email, password: PASSWORD })).statusCode,
    ).toBe(200);
    // A second link, as a reset would make, ends the session the first password opened.
    const second = await createAccountLink(email);
    expect((await setPassword(visitor(), second, 'otra contraseña de ejemplo')).statusCode).toBe(
      200,
    );
    const { rows } = await pool.query('SELECT 1 FROM sessions WHERE user_id = $1', [userId]);
    expect(rows).toEqual([]);
    expect((await who.send('GET', '/api/session')).statusCode).toBe(401);
  });

  it('spends every other link of the account when one sets its password', async () => {
    const { link, email } = await newAccount();
    const other = await createAccountLink(email);
    expect((await setPassword(visitor(), tokenOf(link))).statusCode).toBe(200);
    const late = await setPassword(visitor(), other, 'otra contraseña de ejemplo');
    expect(late.statusCode).toBe(400);
    expect(late.json()).toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('gives an account with a password and no second factor a new link, only when asked to reset it (D19)', async () => {
    const { userId, email, link } = await newAccount();
    expect((await setPassword(visitor(), tokenOf(link))).statusCode).toBe(200);
    expect(await findAccount(options, email.toUpperCase())).toEqual({
      userId,
      hasPassword: true,
      enrolled: false,
    });
    // Not without asking: the command does so only after the identity check (incidents §5b).
    await expect(accountLink(options, { email, name: '' })).rejects.toThrow(/has a password/);
    // Its person signed in once, and was left at enrolment.
    const before = visitor();
    expect(
      (await before.send('POST', '/api/auth/sign-in/email', { email, password: PASSWORD }))
        .statusCode,
    ).toBe(200);
    const reset = await accountLink(options, { email, name: '', reset: true });
    expect(reset).toMatchObject({ userId, created: false, reset: true });
    // Its sessions end with the link, and the old password signs in no more: until the person uses the link, nobody
    // who knew the old one can enrol an authenticator.
    expect((await before.send('GET', '/api/session')).statusCode).toBe(401);
    expect(
      (await visitor().send('POST', '/api/auth/sign-in/email', { email, password: PASSWORD }))
        .statusCode,
    ).toBe(401);
    // Run again, it still sees an account with a password and no second factor.
    expect(await findAccount(options, email)).toEqual({
      userId,
      hasPassword: true,
      enrolled: false,
    });
    // A new password, through the link, once; the next sign-in still leads to enrolment.
    expect(
      (await setPassword(visitor(), tokenOf(reset.link), 'otra contraseña de ejemplo')).statusCode,
    ).toBe(200);
    const after = visitor();
    expect(
      (
        await after.send('POST', '/api/auth/sign-in/email', {
          email,
          password: 'otra contraseña de ejemplo',
        })
      ).statusCode,
    ).toBe(200);
    expect((await after.send('GET', '/api/session')).json()).toMatchObject({ stage: 'enrol' });
    const again = await setPassword(visitor(), tokenOf(reset.link), PASSWORD);
    expect(again.json()).toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('never gives the owner a link for an account with its second factor, which resets its own (D19)', async () => {
    const { userId, email, link } = await newAccount();
    expect((await setPassword(visitor(), tokenOf(link))).statusCode).toBe(200);
    await pool.query('UPDATE users SET two_factor_enabled = true WHERE id = $1', [userId]);
    expect(await findAccount(options, email)).toEqual({
      userId,
      hasPassword: true,
      enrolled: true,
    });
    await expect(accountLink(options, { email, name: '', reset: true })).rejects.toThrow(
      /second factor/,
    );
    const { rows } = await pool.query('SELECT 1 FROM verifications WHERE value = $1', [userId]);
    expect(rows).toEqual([]);
    expect(await findAccount(options, `nadie-${crypto.randomUUID()}@example.org`)).toBeUndefined();
  });

  it('counts a stored factor as one, as the reset of a lost authenticator does, even with the flag off', async () => {
    const { userId, email, link } = await newAccount();
    expect((await setPassword(visitor(), tokenOf(link))).statusCode).toBe(200);
    // Enrolment couldn't replace a stored factor, so its person goes through incidents §5a instead.
    await pool.query(
      `INSERT INTO two_factors (secret, backup_codes, user_id, verified) VALUES ('secreto', '[]', $1, true)`,
      [userId],
    );
    expect(await findAccount(options, email)).toMatchObject({ enrolled: true });
    await expect(accountLink(options, { email, name: '', reset: true })).rejects.toThrow(
      /second factor/,
    );
  });

  it('accepts no made-up token', async () => {
    const response = await setPassword(visitor(), 'a-made-up-token-of-24-chs');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'INVALID_TOKEN' });
  });
});

/** A further single-use token for an existing account, kept as Better Auth keeps one for a reset. */
const createAccountLink = async (email: string): Promise<string> => {
  const token = crypto.randomUUID().replaceAll('-', '').slice(0, 24);
  await pool.query(
    `INSERT INTO verifications (identifier, value, expires_at)
     SELECT $1, id::text, now() + interval '1 hour' FROM users WHERE email = $2`,
    [storedIdentifier(token), email],
  );
  return token;
};

describe("the owner's command for a forgotten password with no second factor (D19, incidents §5b)", () => {
  it('asks for the address again and a typed "link" before it makes one, and prints no personal data', async () => {
    const { userId, email, link } = await newAccount();
    expect((await setPassword(visitor(), tokenOf(link))).statusCode).toBe(200);
    const links = async () =>
      (await pool.query('SELECT 1 FROM verifications WHERE value = $1', [userId])).rows.length;
    const differ = await command([email, `otra-${email}`]);
    expect([differ.code, differ.stderr]).toEqual([
      1,
      expect.stringContaining('The two addresses differ'),
    ]);
    const unconfirmed = await command([email, email, 'si']);
    expect([unconfirmed.code, unconfirmed.stderr]).toEqual([
      1,
      expect.stringContaining('Not confirmed'),
    ]);
    expect(await links()).toBe(0);
    const made = await command([email, email.toUpperCase(), 'link']);
    expect(made.code).toBe(0);
    expect(made.stdout).toContain(`Account ${userId}: a link for a new password.`);
    // Before anything changes, what the owner checks: the account's roles, by its id, and who asked.
    expect(made.stdout).toContain(
      `FROM app.memberships m JOIN app.tenants t ON t.id = m.tenant_id WHERE m.user_id = '${userId}'`,
    );
    expect(made.stdout).toContain(`FROM app.platform_admins WHERE user_id = '${userId}'`);
    expect(made.stderr).toContain('incidents §5b');
    const printed = /#token=(\S+)/u.exec(made.stdout)?.[1] ?? '';
    expect(printed).not.toBe('');
    for (const output of [made.stdout, made.stderr]) {
      expect(output).not.toContain(email.split('@')[0]);
    }
    expect(
      (await setPassword(visitor(), decodeURIComponent(printed), 'otra contraseña de ejemplo'))
        .statusCode,
    ).toBe(200);
  });

  it("prints a query of the account's roles that the owner runs as it is (incidents §5b, step 3)", async () => {
    const { userId, email, link } = await newAccount();
    expect((await setPassword(visitor(), tokenOf(link))).statusCode).toBe(200);
    // Stopped at the second question: nothing changed, the query printed.
    const asked = await command([email]);
    expect(asked.code).toBe(1);
    const query = asked.stdout
      .split('\n')
      .filter((line) => /^ {2}(?:SELECT|UNION ALL) /u.test(line))
      .join('\n');
    expect(query).toContain(userId);
    // An editor of one site whose authenticator the owner reset (§5a), which keeps its platform-admin row: both listed.
    const rows = await inRolledBackTransaction(async (trx) => {
      await sql`SET LOCAL session_replication_role = replica`.execute(trx);
      await sql`
        INSERT INTO app.memberships (user_id, tenant_id, role, created_by)
        VALUES (${userId}, ${TENANT_A}, 'editor', ${USERS.countryAdminA})`.execute(trx);
      await sql`INSERT INTO app.platform_admins (user_id) VALUES (${userId})`.execute(trx);
      await sql`SET LOCAL session_replication_role = origin`.execute(trx);
      return (await sql<{ slug: string; role: string }>`${sql.raw(query)}`.execute(trx)).rows;
    });
    expect(rows).toEqual([
      { slug: expect.any(String), role: 'editor' },
      { slug: 'platform', role: 'platform_admin' },
    ]);
  });

  it('refuses an account with its second factor, and makes a new account only with a name', async () => {
    const { userId, email, link } = await newAccount();
    expect((await setPassword(visitor(), tokenOf(link))).statusCode).toBe(200);
    await pool.query('UPDATE users SET two_factor_enabled = true WHERE id = $1', [userId]);
    const refused = await command([email]);
    expect([refused.code, refused.stderr]).toEqual([
      1,
      expect.stringContaining('has a second factor'),
    ]);
    const fresh = `persona-${crypto.randomUUID()}@example.org`;
    const created = await command([fresh, 'Persona de ejemplo']);
    expect(created.code).toBe(0);
    const id = /Account created: (\S+)/u.exec(created.stdout)?.[1] ?? '';
    expect(id).not.toBe('');
    accounts.push(id);
    expect(created.stdout).toContain('INSERT INTO app.platform_admins');
    // Run again before a password is set: a new link, and the same SQL (R93).
    const again = await command([fresh]);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain(`Account ${id} has no password yet: a new link.`);
    expect(again.stdout).toContain('INSERT INTO app.platform_admins');
    // A new address with no name: nothing is made.
    const nameless = await command([`persona-${crypto.randomUUID()}@example.org`, '']);
    expect([nameless.code, nameless.stderr]).toEqual([1, expect.stringContaining('needs a name')]);
    // Said before the name is asked for, so a slip in a forgotten password's address is seen.
    expect(nameless.stderr).toContain('No account has this address');
  });
});
