import { createAuthPool } from '@aiontheballot/db/auth-pool';
import { createDatabase } from '@aiontheballot/db/client';
import Fastify from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { createAuth } from '../src/auth/auth.js';
import { invitationRoutes } from '../src/auth/invitation-routes.js';
import { createInvitedAccounts } from '../src/auth/invited-accounts.js';
import {
  ADMIN_HOST,
  ADMIN_ORIGIN,
  browser,
  createAccount,
  deleteAccount,
  SECRET,
  testAddress,
  TOTP_ISSUER,
} from './auth-fixtures.js';
import { TENANT_A } from './fixtures.js';
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
const accounts = createInvitedAccounts(options);
const app = buildApp({
  admin: {
    auth: { auth: createAuth(options), adminOrigin: ADMIN_ORIGIN },
    admin,
    invitations: { accounts, send: async () => undefined },
  },
});

const PASSWORD = 'una contraseña nueva de ejemplo';
const made: { users: string[]; emails: string[] } = { users: [], emails: [] };

/** A pending invitation to tenant A, as the owner makes it in these tests: its raw token. */
const invite = async (email: string): Promise<string> => {
  const token = randomBytes(32).toString('base64url');
  made.emails.push(email);
  const client = await superuser.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', '00000000-0000-0000-0000-000000000000', true)`,
    );
    await client.query(
      `INSERT INTO app.invitations (tenant_id, email, role, token_hash, expires_at)
       VALUES ($1, $2, 'reviewer', $3, now() + interval '7 days')`,
      [TENANT_A, email, createHash('sha256').update(token).digest('hex')],
    );
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  return token;
};

afterAll(async () => {
  await superuser.query('DELETE FROM app.memberships WHERE user_id = ANY($1::uuid[])', [
    made.users,
  ]);
  await superuser.query('DELETE FROM app.invitations WHERE email = ANY($1::text[])', [made.emails]);
  for (const id of made.users) {
    await deleteAccount(authPool, id);
  }
  await app.close();
  await Promise.all([authPool.end(), superuser.end(), admin.destroy()]);
});

describe('accepting an invitation (editorial workflow A3; PLAN R114)', () => {
  it('creates the account with the invited email verified and the password chosen, and accepts at once', async () => {
    const email = `invitada-${crypto.randomUUID()}@example.org`;
    const token = await invite(email);
    const who = browser(app);
    const offer = await who.send('POST', '/api/invitations/lookup', { token });
    expect(offer.statusCode).toBe(200);
    expect(offer.json()).toEqual({ email, role: 'reviewer', account: false, session: 'none' });

    const short = await who.send('POST', '/api/invitations/accept', {
      token,
      name: 'Persona invitada',
      password: 'corta',
    });
    expect(short.statusCode).toBe(400);
    expect(short.json()).toEqual({ error: 'password' });

    const created = await who.send('POST', '/api/invitations/accept', {
      token,
      name: '  Persona invitada  ',
      password: PASSWORD,
    });
    expect(created.statusCode).toBe(201);
    const { rows } = await superuser.query<{ id: string; name: string; email_verified: boolean }>(
      'SELECT id, name, email_verified FROM auth.users WHERE email = $1',
      [email],
    );
    expect(rows).toEqual([
      { id: expect.any(String), name: 'Persona invitada', email_verified: true },
    ]);
    const userId = rows[0]?.id ?? '';
    made.users.push(userId);
    const membership = await superuser.query(
      `SELECT m.role, i.accepted_by FROM app.memberships m
         JOIN app.invitations i ON i.tenant_id = m.tenant_id AND i.email = $2
        WHERE m.user_id = $1 AND m.tenant_id = $3`,
      [userId, email, TENANT_A],
    );
    expect(membership.rows).toEqual([{ role: 'reviewer', accepted_by: userId }]);

    // The password works: signing in leads to TOTP enrolment, before which the membership grants nothing.
    const signIn = await who.send('POST', '/api/auth/sign-in/email', { email, password: PASSWORD });
    expect(signIn.statusCode).toBe(200);
    expect((await who.send('GET', '/api/session')).json()).toMatchObject({ stage: 'enrol' });

    // The link is spent.
    expect((await browser(app).send('POST', '/api/invitations/lookup', { token })).statusCode).toBe(
      404,
    );
    expect(
      (
        await browser(app).send('POST', '/api/invitations/accept', {
          token,
          name: 'X',
          password: PASSWORD,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('asks an existing account to sign in first, and never makes a second one', async () => {
    const existing = await createAccount(authPool);
    made.users.push(existing.id);
    const token = await invite(existing.email);
    const who = browser(app);
    expect((await who.send('POST', '/api/invitations/lookup', { token })).json()).toMatchObject({
      account: true,
      session: 'none',
    });
    const answer = await who.send('POST', '/api/invitations/accept', {
      token,
      name: 'Otra persona',
      password: PASSWORD,
    });
    expect(answer.statusCode).toBe(409);
    expect(answer.json()).toEqual({ error: 'signInFirst' });
    const { rows } = await superuser.query('SELECT 1 FROM auth.users WHERE email = $1', [
      existing.email,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('answers every token that names no pending invitation the same, and only to the admin pages', async () => {
    const who = browser(app);
    for (const token of ['un-token-inventado', randomBytes(32).toString('base64url')]) {
      const answer = await who.send('POST', '/api/invitations/lookup', { token });
      expect(answer.statusCode).toBe(404);
      expect(answer.json()).toEqual({ error: 'invalid' });
    }
    const elsewhere = await who.send(
      'POST',
      '/api/invitations/lookup',
      { token: 'x' },
      { origin: 'https://otro.example.test' },
    );
    expect(elsewhere.statusCode).toBe(403);
  });

  it('limits the attempts of each visitor', async () => {
    const limited = Fastify();
    await limited.register(
      invitationRoutes({
        admin,
        accounts,
        adminOrigin: ADMIN_ORIGIN,
        findSession: async () => null,
        attemptsPerVisitor: 2,
      }),
    );
    const attempt = (address: string) =>
      limited.inject({
        method: 'POST',
        url: '/invitations/lookup',
        headers: { host: ADMIN_HOST, origin: ADMIN_ORIGIN, 'x-forwarded-for': address },
        payload: { token: 'un-token-inventado' },
      });
    const address = testAddress();
    const statuses = [];
    for (let n = 0; n < 3; n += 1) {
      statuses.push((await attempt(address)).statusCode);
    }
    statuses.push((await attempt(testAddress())).statusCode);
    await limited.close();
    expect(statuses).toEqual([404, 404, 429, 404]);
  });
});
