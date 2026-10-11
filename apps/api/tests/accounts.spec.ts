import { createAuthPool } from '@aiontheballot/db/auth-pool';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { accountLink } from '../src/auth/accounts.js';
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
import './db.js';

const url = process.env.TEST_AUTH_DATABASE_URL;
if (!url) {
  throw new Error('TEST_AUTH_DATABASE_URL is not set. Copy .env.example to .env.');
}
const pool = createAuthPool({ connectionString: url, maxConnections: 4 });
const options = { pool, secret: SECRET, adminOrigin: ADMIN_ORIGIN, totpIssuer: TOTP_ISSUER };
const app = buildApp({ admin: { auth: { auth: createAuth(options), adminOrigin: ADMIN_ORIGIN } } });

const accounts: string[] = [];
const addresses: string[] = [];

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
