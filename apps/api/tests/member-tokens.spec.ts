import { createAuthPool } from '@aiontheballot/db/auth-pool';
import { createDatabase } from '@aiontheballot/db/client';
import { afterAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { createAuth } from '../src/auth/auth.js';
import { createMemberTokens, MAX_ACTIVE } from '../src/auth/member-tokens.js';
import {
  ADMIN_HOST,
  ADMIN_ORIGIN,
  browser,
  createAccount,
  deleteAccount,
  PASSWORD,
  SECRET,
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

const pool = createAuthPool({ connectionString: env('TEST_AUTH_DATABASE_URL'), maxConnections: 4 });
const admin = createDatabase({
  connectionString: env('TEST_ADMIN_DATABASE_URL'),
  maxConnections: 2,
});
const options = { pool, secret: SECRET, adminOrigin: ADMIN_ORIGIN, totpIssuer: TOTP_ISSUER };
const app = buildApp({
  admin: {
    auth: { auth: createAuth(options), adminOrigin: ADMIN_ORIGIN },
    admin,
    tokens: createMemberTokens(pool),
  },
});

const accounts: string[] = [];
afterAll(async () => {
  for (const id of accounts) {
    await deleteAccount(pool, id);
  }
  await app.close();
  await Promise.all([pool.end(), admin.destroy()]);
});

/** A member signed in with their second factor, in a browser of their own. */
const signedIn = async () => {
  const { id, email } = await createAccount(pool);
  accounts.push(id);
  const who = browser(app);
  expect(
    (await who.send('POST', '/api/auth/sign-in/email', { email, password: PASSWORD })).statusCode,
  ).toBe(200);
  const enabled = await who.send('POST', '/api/auth/two-factor/enable', { password: PASSWORD });
  const { totpURI } = enabled.json<{ totpURI: string }>();
  expect(
    (await who.send('POST', '/api/auth/two-factor/verify-totp', { code: totpCode(totpURI) }))
      .statusCode,
  ).toBe(200);
  return { id, who };
};

/** A tool's request with `token`: no cookie, no Origin. */
const asTool = (token: string, url = '/api/tenants', headers: Record<string, string> = {}) =>
  app.inject({
    method: 'GET',
    url,
    headers: { host: ADMIN_HOST, authorization: `Bearer ${token}`, ...headers },
  });

const minted = async (who: Awaited<ReturnType<typeof signedIn>>['who'], name = 'Herramienta') => {
  const response = await who.send('POST', '/api/tokens', { name, days: 30 });
  expect(response.statusCode).toBe(201);
  return response.json<{ token: string; id: string; name: string; expiresAt: string }>();
};

describe("a member's tokens, minted in the admin and used by a tool (ADR-0008, PLAN R203)", () => {
  it('is minted from the session, shown once, and lets a tool act as its member', async () => {
    const { who } = await signedIn();
    const token = await minted(who, '  Mi herramienta  ');
    expect(token.token).toMatch(/^aiontheballot_[\w-]{43}$/);
    expect(token.name).toBe('Mi herramienta');
    const used = await asTool(token.token);
    expect([used.statusCode, used.json()]).toEqual([200, { tenants: [], platformAdmin: false }]);
    // The scheme in any case, as HTTP has it.
    const lower = await app.inject({
      method: 'GET',
      url: '/api/tenants',
      headers: { host: ADMIN_HOST, authorization: `bearer ${token.token}` },
    });
    expect(lower.statusCode).toBe(200);
    // Listed by its member, with when it was last used, and never shown again.
    const listed = await who.send('GET', '/api/tokens');
    const [row] = listed.json<{ tokens: Record<string, unknown>[] }>().tokens;
    expect(row).toMatchObject({
      id: token.id,
      name: 'Mi herramienta',
      revokedAt: null,
      status: 'active',
    });
    expect(row?.['lastUsedAt']).not.toBeNull();
    expect(JSON.stringify(listed.json())).not.toContain(token.token);
  });

  it('stands for no one once revoked, beside a cookie, or malformed', async () => {
    const { who } = await signedIn();
    const token = await minted(who);
    const cookie = [...who.jar].map(([name, value]) => `${name}=${value}`).join('; ');
    expect((await asTool(token.token, '/api/tenants', { cookie })).statusCode).toBe(401);
    expect((await asTool(`${token.token}x`)).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/tenants',
          headers: { host: ADMIN_HOST, authorization: `Basic ${token.token}` },
        })
      ).statusCode,
    ).toBe(401);
    expect((await who.send('DELETE', `/api/tokens/${token.id}`)).statusCode).toBe(204);
    expect((await asTool(token.token)).statusCode).toBe(401);
  });

  it('is never minted, listed or revoked through a token, nor minted without the admin’s Origin', async () => {
    const { who } = await signedIn();
    const token = await minted(who);
    expect((await asTool(token.token, '/api/tokens')).statusCode).toBe(401);
    // Nor from the member's own session when the request carries a token too: minting is among the riskiest actions,
    // which no token runs (PLAN D23).
    const beside = await who.send(
      'POST',
      '/api/tokens',
      { name: 'Otra', days: 30 },
      { authorization: `Bearer ${token.token}` },
    );
    expect([beside.statusCode, beside.json()]).toEqual([403, { error: 'notForTokens' }]);
    expect(
      (
        await who.send(
          'POST',
          '/api/tokens',
          { name: 'Otra', days: 30 },
          { origin: 'https://otro.test' },
        )
      ).statusCode,
    ).toBe(403);
  });

  it('refuses a name left blank, more than 30 days, and more tokens than a member keeps at once', async () => {
    const { who } = await signedIn();
    expect((await who.send('POST', '/api/tokens', { name: '   ', days: 30 })).json()).toEqual({
      error: 'invalid',
      field: 'name',
    });
    expect((await who.send('POST', '/api/tokens', { name: 'Larga', days: 31 })).statusCode).toBe(
      400,
    );
    for (let made = 0; made < MAX_ACTIVE; made += 1) {
      await minted(who, `Herramienta ${made}`);
    }
    expect((await who.send('POST', '/api/tokens', { name: 'Una más', days: 30 })).json()).toEqual({
      error: 'tooManyTokens',
    });
  });

  it("stops standing for its member when their password changes (the database's revocation)", async () => {
    const { id, who } = await signedIn();
    const token = await minted(who);
    await pool.query(`UPDATE accounts SET password = 'otro-hash' WHERE user_id = $1`, [id]);
    expect((await asTool(token.token)).statusCode).toBe(401);
  });
});
