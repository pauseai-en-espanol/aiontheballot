import { createAuthPool } from '@aiontheballot/db/auth-pool';
import { createDatabase } from '@aiontheballot/db/client';
import { betterAuth } from 'better-auth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { authOptions, createAuth, SESSION_COOKIE, TWO_FACTOR_COOKIE } from '../src/auth/auth.js';
import { deleteExpiredAuthRows, RATE_LIMIT_KEEP_MS } from '../src/auth/cleanup.js';
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

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.`);
  }
  return value;
};

const authPool = createAuthPool({
  connectionString: env('TEST_AUTH_DATABASE_URL'),
  maxConnections: 4,
});
// Only for what the test sets up in `app`: names are schema-qualified, whatever the pool's search path.
const superuser = createAuthPool({
  connectionString: env('TEST_SUPERUSER_DATABASE_URL'),
  maxConnections: 1,
});
const admin = createDatabase({
  connectionString: env('TEST_ADMIN_DATABASE_URL'),
  maxConnections: 2,
});
const options = {
  pool: authPool,
  secret: SECRET,
  adminOrigin: ADMIN_ORIGIN,
  totpIssuer: TOTP_ISSUER,
};
const app = buildApp({
  admin: { auth: { auth: createAuth(options), adminOrigin: ADMIN_ORIGIN }, admin },
});

const accounts: string[] = [];
const addresses: string[] = [];

const account = async (password?: string) => {
  const created = await createAccount(authPool, password);
  accounts.push(created.id);
  return created;
};

const visitor = (address = testAddress()) => {
  addresses.push(address);
  return browser(app, address);
};

/** A membership as the owner adds it, stamped as added by the member themselves. */
const addMembership = async (userId: string, tenantId: string) => {
  const client = await superuser.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query(
      `INSERT INTO app.memberships (user_id, tenant_id, role) VALUES ($1, $2, 'editor')`,
      [userId, tenantId],
    );
    await client.query('COMMIT');
  } finally {
    client.release();
  }
};

const sessionsOf = async (userId: string) =>
  (
    await authPool.query<{ aal: number; seconds: number; token: string }>(
      `SELECT aal, extract(epoch FROM expires_at - created_at)::int AS seconds, token
         FROM sessions WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    )
  ).rows;

type Visitor = ReturnType<typeof visitor>;

const signIn = (who: Visitor, email: string, password = PASSWORD, extra: object = {}) =>
  who.send('POST', '/api/auth/sign-in/email', { email, password, ...extra });

/** Signs a new account in and enrols TOTP through the endpoints, as the admin's enrolment page does. */
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

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  for (const id of accounts) {
    await deleteAccount(authPool, id);
  }
  for (const address of addresses) {
    await authPool.query(
      `DELETE FROM rate_limits WHERE key LIKE $1 || '|%' OR key LIKE $2 || '|%'`,
      [address, limiterAddress(address)],
    );
  }
  await app.close();
  await admin.destroy();
  await superuser.end();
  await authPool.end();
});

describe('sign-in under /api/auth (ADR-0003 §2, editorial workflow A4)', () => {
  it('answers only on the admin host', async () => {
    const { email } = await account();
    for (const [method, url] of [
      ['POST', '/api/auth/sign-in/email'],
      ['GET', '/api/session'],
      ['GET', '/api/tenants'],
    ] as const) {
      const response = await visitor().send(
        method,
        url,
        method === 'POST' ? { email, password: PASSWORD } : undefined,
        { host: 'ejemplo-a.localhost' },
      );
      expect(response.statusCode, url).toBe(404);
      expect(response.headers['set-cookie'], url).toBeUndefined();
    }
  });

  it('exposes only the endpoints the admin uses: no sign-up, no turning TOTP off', async () => {
    const who = visitor();
    const email = `persona-${crypto.randomUUID()}@example.org`;
    for (const path of [
      '/sign-up/email',
      '/two-factor/disable',
      '/two-factor/get-totp-uri',
      '/two-factor/send-otp',
      '/get-session',
      '/change-password',
      '/request-password-reset',
      '/update-user',
      '/list-sessions',
    ]) {
      const response = await who.send('POST', `/api/auth${path}`, {
        name: 'Persona de ejemplo',
        email,
        password: PASSWORD,
      });
      expect(response.statusCode, path).toBe(404);
    }
    expect((await who.send('GET', '/api/auth/get-session')).statusCode).toBe(404);
    const { rows } = await authPool.query('SELECT 1 FROM users WHERE email = $1', [email]);
    expect(rows).toHaveLength(0);
  });

  it('opens a 12-hour aal1 session in a __Host- cookie for an account still to enrol', async () => {
    const { id, email } = await account();
    const who = visitor();
    const response = await signIn(who, email);
    expect(response.statusCode).toBe(200);
    // The token stays in the HttpOnly cookie: page scripts never see it.
    expect(response.json()).not.toHaveProperty('token');
    const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cookie).toMatchObject({
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: 43_200,
    });
    expect(cookie).not.toHaveProperty('domain');
    expect(SESSION_COOKIE.startsWith('__Host-')).toBe(true);
    expect(await sessionsOf(id)).toEqual([expect.objectContaining({ aal: 1, seconds: 43_200 })]);

    const session = await who.send('GET', '/api/session');
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({
      stage: 'enrol',
      user: { id, name: 'Persona de ejemplo', email },
    });
    expect(session.headers['cache-control']).toBe('no-store');
    expect((await who.send('GET', '/api/tenants')).statusCode).toBe(401);
  });

  it('has no "remember me": rememberMe false still gives a 12-hour session in a lasting cookie', async () => {
    const { id, email } = await account();
    const who = visitor();
    const response = await signIn(who, email, PASSWORD, { rememberMe: false });
    expect(response.statusCode).toBe(200);
    expect(response.cookies.find((c) => c.name === SESSION_COOKIE)?.maxAge).toBe(43_200);
    expect(response.cookies.map((c) => c.name)).toEqual([SESSION_COOKIE]);
    expect(await sessionsOf(id)).toEqual([expect.objectContaining({ seconds: 43_200 })]);
  });

  it('enrols TOTP under the configured issuer, and reaches aal2 only with a valid code', async () => {
    const { id, email } = await account();
    const who = visitor();
    expect((await signIn(who, email)).statusCode).toBe(200);
    // A client can't pick the issuer, nor codes sent by email instead.
    const enabled = await who.send('POST', '/api/auth/two-factor/enable', {
      password: PASSWORD,
      issuer: 'Otra plataforma',
      method: 'otp',
    });
    expect(enabled.statusCode).toBe(200);
    const { method, totpURI, backupCodes } = enabled.json<{
      method: string;
      totpURI: string;
      backupCodes: string[];
    }>();
    expect(method).toBe('totp');
    expect(new URL(totpURI).searchParams.get('issuer')).toBe(TOTP_ISSUER);
    expect(backupCodes).toHaveLength(10);

    const wrong = await who.send('POST', '/api/auth/two-factor/verify-totp', { code: '000000' });
    expect(wrong.statusCode).toBe(401);
    expect((await sessionsOf(id)).map((s) => s.aal)).toEqual([1]);

    const verified = await who.send('POST', '/api/auth/two-factor/verify-totp', {
      code: totpCode(totpURI),
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).not.toHaveProperty('token');
    // The enrolment's session is replaced by an aal2 one.
    expect((await sessionsOf(id)).map((s) => s.aal)).toEqual([2]);
    expect((await who.send('GET', '/api/session')).json()).toMatchObject({ stage: 'signed-in' });
  });

  it('never raises a session opened before enrolment, even once its user has enrolled elsewhere', async () => {
    const { id, email } = await account();
    const before = visitor();
    expect((await signIn(before, email)).statusCode).toBe(200);
    const { totpURI } = await enrol(visitor(), email);
    // Not even with a valid code: verifying with a session in hand opens no new one.
    const verified = await before.send('POST', '/api/auth/two-factor/verify-totp', {
      code: totpCode(totpURI),
    });
    expect(verified.statusCode).toBe(200);
    expect((await sessionsOf(id)).map((s) => s.aal).sort((a, b) => a - b)).toEqual([1, 2]);

    const session = await before.send('GET', '/api/session');
    expect(session.statusCode).toBe(401);
    expect(session.json()).toEqual({ stage: 'signed-out' });
    expect((await before.send('GET', '/api/tenants')).statusCode).toBe(401);
    // Nor can it enrol a second authenticator over the first.
    expect(
      (await before.send('POST', '/api/auth/two-factor/enable', { password: PASSWORD })).statusCode,
    ).toBe(400);
  });

  it('asks an enrolled account for a code at every sign-in, and never trusts the device', async () => {
    const { id, email } = await account();
    const { totpURI } = await enrol(visitor(), email);
    await authPool.query('DELETE FROM sessions WHERE user_id = $1', [id]);

    const who = visitor();
    const response = await signIn(who, email);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ twoFactorRedirect: true });
    // A short-lived __Host- cookie holds the sign-in until the code, and no session exists yet.
    const pending = response.cookies.find((c) => c.name === TWO_FACTOR_COOKIE);
    expect(pending).toMatchObject({
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: 600,
    });
    expect(TWO_FACTOR_COOKIE.startsWith('__Host-')).toBe(true);
    expect(who.jar.has(SESSION_COOKIE)).toBe(false);
    expect(await sessionsOf(id)).toEqual([]);
    expect((await who.send('GET', '/api/session')).json()).toEqual({ stage: 'challenge' });

    const verified = await who.send('POST', '/api/auth/two-factor/verify-totp', {
      code: totpCode(totpURI),
      trustDevice: true,
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.cookies.map((c) => c.name)).not.toContain('__Host-admin.trust_device');
    expect((await sessionsOf(id)).map((s) => s.aal)).toEqual([2]);

    // Signing out ends the session; signing in again asks for a code again.
    const out = await who.send('POST', '/api/auth/sign-out', {});
    expect(out.statusCode).toBe(200);
    expect(await sessionsOf(id)).toEqual([]);
    expect(who.jar.has(SESSION_COOKIE)).toBe(false);
    expect((await signIn(who, email)).json()).toMatchObject({ twoFactorRedirect: true });
  });

  it('gives no second factor to a backup code used before enrolment ends', async () => {
    const { id, email } = await account();
    const who = visitor();
    expect((await signIn(who, email)).statusCode).toBe(200);
    const enabled = await who.send('POST', '/api/auth/two-factor/enable', { password: PASSWORD });
    const [code] = enabled.json<{ backupCodes: string[] }>().backupCodes;
    await who.send('POST', '/api/auth/two-factor/verify-backup-code', { code });
    expect((await sessionsOf(id)).map((s) => s.aal)).toEqual([1]);
    expect((await who.send('GET', '/api/session')).json()).toMatchObject({ stage: 'enrol' });
    expect((await who.send('GET', '/api/tenants')).statusCode).toBe(401);
  });

  it('accepts each backup code once, at aal2', async () => {
    const { id, email } = await account();
    const { backupCodes } = await enrol(visitor(), email);
    await authPool.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    const [code] = backupCodes;

    const who = visitor();
    expect((await signIn(who, email)).json()).toMatchObject({ twoFactorRedirect: true });
    const used = await who.send('POST', '/api/auth/two-factor/verify-backup-code', { code });
    expect(used.statusCode).toBe(200);
    expect((await sessionsOf(id)).map((s) => s.aal)).toEqual([2]);

    const again = visitor();
    expect((await signIn(again, email)).json()).toMatchObject({ twoFactorRedirect: true });
    const reused = await again.send('POST', '/api/auth/two-factor/verify-backup-code', { code });
    expect(reused.statusCode).toBe(401);
  });

  it('never extends a session', async () => {
    const { id, email } = await account();
    const who = visitor();
    await enrol(who, email);
    await authPool.query(
      `UPDATE sessions SET expires_at = now() + interval '1 minute' WHERE user_id = $1`,
      [id],
    );
    const before = await authPool.query<{ expires_at: Date }>(
      'SELECT expires_at FROM sessions WHERE user_id = $1',
      [id],
    );
    expect((await who.send('GET', '/api/session')).statusCode).toBe(200);
    const after = await authPool.query<{ expires_at: Date }>(
      'SELECT expires_at FROM sessions WHERE user_id = $1',
      [id],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("limits attempts by the gateway's address, the last X-Forwarded-For entry", async () => {
    const { email } = await account();
    const address = testAddress();
    addresses.push(address);
    const attempt = (forwardedFor: string, headers: Record<string, string> = {}) =>
      browser(app, forwardedFor).send(
        'POST',
        '/api/auth/sign-in/email',
        { email, password: 'una contraseña equivocada' },
        headers,
      );
    const statuses = [];
    for (let i = 0; i < 3; i += 1) {
      statuses.push((await attempt(`192.0.2.${i + 1}, ${address}`)).statusCode);
    }
    // Counted by the address's /64, in the database the replicas share.
    const { rows } = await authPool.query<{ count: number }>(
      'SELECT count FROM rate_limits WHERE key = $1',
      [`${limiterAddress(address)}|/sign-in/email`],
    );
    expect(rows).toEqual([{ count: 3 }]);
    expect(statuses).toEqual([401, 401, 401]);
    // An earlier entry, or the header Better Auth reads, is the client's to write: neither escapes the limit.
    const limited = await attempt(`192.0.2.99, ${address}`, {
      'x-aiontheballot-visitor': testAddress(),
    });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['x-retry-after'])).toBeGreaterThan(0);
    expect(Number(limited.headers['x-retry-after'])).toBeLessThanOrEqual(10);
    // Another address is counted apart.
    const other = testAddress();
    addresses.push(other);
    expect((await attempt(`${address}, ${other}`)).statusCode).toBe(401);
  });
});

describe('the database sees aal2 only after TOTP (ADR-0002 §9)', () => {
  it("lists a signed-in member's tenants, as RLS shows them", async () => {
    const { id, email } = await account();
    const who = visitor();
    await enrol(who, email);
    const empty = await who.send('GET', '/api/tenants');
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ tenants: [] });

    const { rows } = await superuser.query<{ id: string; slug: string }>(
      `SELECT id, slug FROM app.tenants WHERE active ORDER BY slug LIMIT 1`,
    );
    const tenant = rows[0];
    if (!tenant) {
      throw new Error('The matrix fixtures have no active tenant');
    }
    await addMembership(id, tenant.id);
    try {
      const listed = await who.send('GET', '/api/tenants');
      expect(listed.json<{ tenants: { slug: string }[] }>().tenants.map((t) => t.slug)).toEqual([
        tenant.slug,
      ]);
      // The same membership gives a session without TOTP nothing: the API refuses it before any query.
      const before = visitor();
      const { email: other, id: otherId } = await account();
      expect((await signIn(before, other)).statusCode).toBe(200);
      await addMembership(otherId, tenant.id);
      expect((await before.send('GET', '/api/tenants')).statusCode).toBe(401);
    } finally {
      await superuser.query('DELETE FROM app.memberships WHERE user_id = ANY($1)', [accounts]);
    }
  });
});

describe('Better Auth options', () => {
  it('refuse sign-up, and passwords shorter than 12 characters', async () => {
    let token = '';
    const base = authOptions(options);
    const raw = betterAuth({
      ...base,
      emailAndPassword: {
        ...base.emailAndPassword,
        enabled: true,
        sendResetPassword: async (data) => {
          token = data.token;
        },
      },
    });
    await expect(
      raw.api.signUpEmail({
        body: { name: 'Persona de ejemplo', email: 'nueva@example.org', password: PASSWORD },
      }),
    ).rejects.toThrow();

    const { email } = await account();
    await raw.api.requestPasswordReset({ body: { email } });
    expect(token).not.toBe('');
    await expect(
      raw.api.resetPassword({ body: { token, newPassword: 'once letras' } }),
    ).rejects.toThrow(/short/i);
    await expect(
      raw.api.resetPassword({ body: { token, newPassword: 'doce letras!' } }),
    ).resolves.toEqual({ status: true });
  });
});

describe('the daily clean-up (delete-expired-sessions)', () => {
  it('deletes expired sessions and verifications and day-old limiter rows, and nothing else', async () => {
    const { id } = await account();
    const now = new Date();
    const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);
    const { rows: sessions } = await authPool.query<{ id: string }>(
      `INSERT INTO sessions (expires_at, token, updated_at, user_id, aal)
       VALUES ($2, $3, now(), $1, 1), ($4, $5, now(), $1, 1) RETURNING id`,
      [id, at(-1_000), crypto.randomUUID(), at(60_000), crypto.randomUUID()],
    );
    const tag = crypto.randomUUID();
    await authPool.query(
      `INSERT INTO verifications (identifier, value, expires_at)
       VALUES ($1 || '-old', $2, $3), ($1 || '-new', $2, $4)`,
      [tag, id, at(-1_000), at(60_000)],
    );
    const address = testAddress();
    addresses.push(address);
    await authPool.query(
      `INSERT INTO rate_limits (key, count, last_request)
       VALUES ($1 || '|/old', 1, $2), ($1 || '|/new', 1, $3)`,
      [
        address,
        now.getTime() - RATE_LIMIT_KEEP_MS - 1,
        now.getTime() - RATE_LIMIT_KEEP_MS + 60_000,
      ],
    );

    const deleted = await deleteExpiredAuthRows(authPool, now);
    expect(deleted.sessions).toBeGreaterThanOrEqual(1);
    expect(deleted.verifications).toBeGreaterThanOrEqual(1);
    expect(deleted.rateLimits).toBeGreaterThanOrEqual(1);

    const left = await authPool.query<{ what: string }>(
      `SELECT 'session ' || id AS what FROM sessions WHERE user_id = $1
       UNION ALL SELECT identifier FROM verifications WHERE identifier LIKE $2 || '%'
       UNION ALL SELECT key FROM rate_limits WHERE key LIKE $3 || '|%'
       ORDER BY 1`,
      [id, tag, address],
    );
    expect(left.rows.map((row) => row.what)).toEqual(
      [`session ${sessions[1]?.id}`, `${tag}-new`, `${address}|/new`].sort(),
    );
  });
});
