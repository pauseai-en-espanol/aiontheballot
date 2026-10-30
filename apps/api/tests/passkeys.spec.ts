import { createAuthPool } from '@aiontheballot/db/auth-pool';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import {
  createAuth,
  keepSessionAlive,
  SESSION_SECONDS,
  USER_NOT_VERIFIED,
} from '../src/auth/auth.js';
import { createMemberTokens } from '../src/auth/member-tokens.js';
import { resetAuthenticator } from '../src/auth/reset-authenticator.js';
import {
  ADMIN_HOST,
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
import { createPasskeyDevice } from './passkey-fixtures.js';
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

const tokens = createMemberTokens(authPool);
const app = buildApp({
  admin: {
    auth: {
      auth: createAuth({
        pool: authPool,
        secret: SECRET,
        adminOrigin: ADMIN_ORIGIN,
        totpIssuer: TOTP_ISSUER,
      }),
      adminOrigin: ADMIN_ORIGIN,
    },
    tokens,
  },
});

const accounts: string[] = [];
const addresses: string[] = [];

type Visitor = ReturnType<typeof browser>;

const visitor = (): Visitor => {
  const address = testAddress();
  addresses.push(address);
  return browser(app, address);
};

/** A new account, enrolled through the endpoints as the enrolment page does, and signed in with its code. */
const enrolled = async () => {
  const created = await createAccount(authPool);
  accounts.push(created.id);
  const who = visitor();
  expect(
    (
      await who.send('POST', '/api/auth/sign-in/email', {
        email: created.email,
        password: PASSWORD,
      })
    ).statusCode,
  ).toBe(200);
  const enabled = await who.send('POST', '/api/auth/two-factor/enable', { password: PASSWORD });
  const { totpURI } = enabled.json<{ totpURI: string }>();
  const verified = await who.send('POST', '/api/auth/two-factor/verify-totp', {
    code: totpCode(totpURI),
  });
  expect(verified.statusCode).toBe(200);
  return { ...created, who, cookie: String(verified.headers['set-cookie']) };
};

/** Adds a passkey on `device` to the signed-in `who`'s account, as the passkeys page does. */
const addPasskey = async (
  who: Visitor,
  device: ReturnType<typeof createPasskeyDevice>,
  { verified = true, name = 'Portátil' } = {},
) => {
  const options = await who.send('GET', '/api/auth/passkey/generate-register-options');
  expect(options.statusCode).toBe(200);
  return who.send('POST', '/api/auth/passkey/verify-registration', {
    response: device.register(options.json(), { verified }),
    name,
  });
};

/** Signs `who` in with `device`'s passkey, as the sign-in page does. */
const signInWith = async (
  who: Visitor,
  device: ReturnType<typeof createPasskeyDevice>,
  { verified = true } = {},
) => {
  const options = await who.send('GET', '/api/auth/passkey/generate-authenticate-options');
  expect(options.statusCode).toBe(200);
  return who.send('POST', '/api/auth/passkey/verify-authentication', {
    response: device.authenticate(options.json(), { verified }),
  });
};

/** The account's sessions, newest first, as the database has them. */
const sessionsOf = async (userId: string) =>
  (
    await authPool.query<{ id: string; aal: number; ends_in: number; lasts: number }>(
      `SELECT id, aal, extract(epoch FROM expires_at - now())::int AS ends_in,
              extract(epoch FROM expires_at - created_at)::int AS lasts
         FROM sessions WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    )
  ).rows;

/** The account's passkeys, as the passkeys page lists them. */
const listed = async (who: Visitor) =>
  (await who.send('GET', '/api/passkeys')).json<{ passkeys: { id: string; name: string }[] }>()
    .passkeys;

const HOURS = 60 * 60;

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
  await authPool.end();
});

describe('passkeys (PLAN D22)', () => {
  it('are added from a signed-in session, and then sign in alone, at the second factor’s level', async () => {
    const account = await enrolled();
    const device = createPasskeyDevice();
    const added = await addPasskey(account.who, device);
    expect(added.statusCode).toBe(200);

    // The passkeys page lists what tells them apart, never a key.
    const list = await account.who.send('GET', '/api/passkeys');
    expect(list.json()).toEqual({
      passkeys: [
        {
          id: expect.any(String),
          name: 'Portátil',
          provider: null,
          synced: true,
          createdAt: expect.any(String),
        },
      ],
    });
    // Counted against the visitor's own address, as every request Better Auth limits: never a bucket all share.
    const { rows } = await authPool.query<{ count: number }>(
      'SELECT count FROM rate_limits WHERE key = $1',
      [`${limiterAddress(account.who.address)}|/passkey/list-user-passkeys`],
    );
    expect(rows).toEqual([{ count: 1 }]);

    const elsewhere = visitor();
    const signedIn = await signInWith(elsewhere, device);
    expect(signedIn.statusCode).toBe(200);
    // The session's token stays in its cookie, out of the page's reach.
    expect(signedIn.body).not.toContain('token');
    expect(signedIn.json()).not.toHaveProperty('session');
    expect((await elsewhere.send('GET', '/api/session')).json()).toMatchObject({
      stage: 'signed-in',
      user: { id: account.id },
    });
    expect((await sessionsOf(account.id))[0]?.aal).toBe(2);
  });

  it('count only when the device checked who holds it: one that didn’t is neither added nor let in', async () => {
    const account = await enrolled();
    const unverified = await addPasskey(account.who, createPasskeyDevice(), { verified: false });
    expect(unverified.statusCode).toBe(401);
    expect(unverified.json()).toMatchObject({ code: USER_NOT_VERIFIED });
    expect(await listed(account.who)).toEqual([]);

    const device = createPasskeyDevice();
    expect((await addPasskey(account.who, device)).statusCode).toBe(200);
    const before = (await sessionsOf(account.id)).length;
    const elsewhere = visitor();
    const refused = await signInWith(elsewhere, device, { verified: false });
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toMatchObject({ code: USER_NOT_VERIFIED });
    expect(await sessionsOf(account.id)).toHaveLength(before);
    expect((await elsewhere.send('GET', '/api/session')).statusCode).toBe(401);
  });

  it('are added, listed and removed only by a signed-in session, never one a password alone opened', async () => {
    const stranger = visitor();
    expect(
      (await stranger.send('GET', '/api/auth/passkey/generate-register-options')).statusCode,
    ).toBe(401);
    expect((await stranger.send('GET', '/api/passkeys')).statusCode).toBe(401);
    expect(
      (await stranger.send('POST', '/api/auth/passkey/delete-passkey', { id: 'cualquiera' }))
        .statusCode,
    ).toBe(401);

    // An account still to enrol has a session after its password, which reaches the enrolment and nothing else.
    const created = await createAccount(authPool);
    accounts.push(created.id);
    const enrolling = visitor();
    await enrolling.send('POST', '/api/auth/sign-in/email', {
      email: created.email,
      password: PASSWORD,
    });
    expect((await enrolling.send('GET', '/api/session')).json()).toMatchObject({ stage: 'enrol' });
    expect(
      (await enrolling.send('GET', '/api/auth/passkey/generate-register-options')).statusCode,
    ).toBe(401);
    expect(
      (await enrolling.send('POST', '/api/auth/passkey/verify-registration', { response: {} }))
        .statusCode,
    ).toBe(401);
    // And Better Auth's other passkey endpoints stay out of reach.
    for (const path of ['/passkey/list-user-passkeys', '/passkey/update-passkey']) {
      expect((await enrolling.send('GET', `/api/auth${path}`)).statusCode).toBe(404);
      expect((await enrolling.send('POST', `/api/auth${path}`, {})).statusCode).toBe(404);
    }
  });

  it('are neither listed nor removed by a session opened with a password before enrolling elsewhere', async () => {
    const created = await createAccount(authPool);
    accounts.push(created.id);
    const early = visitor();
    await early.send('POST', '/api/auth/sign-in/email', {
      email: created.email,
      password: PASSWORD,
    });
    const who = visitor();
    await who.send('POST', '/api/auth/sign-in/email', { email: created.email, password: PASSWORD });
    const enabled = await who.send('POST', '/api/auth/two-factor/enable', { password: PASSWORD });
    await who.send('POST', '/api/auth/two-factor/verify-totp', {
      code: totpCode(enabled.json<{ totpURI: string }>().totpURI),
    });
    expect((await addPasskey(who, createPasskeyDevice())).statusCode).toBe(200);
    const passkeys = await listed(who);
    expect(passkeys).toHaveLength(1);

    // The early session is still there, at aal1 for life: Better Auth alone would let it do both.
    expect((await early.send('GET', '/api/session')).json()).toEqual({ stage: 'signed-out' });
    expect((await early.send('GET', '/api/passkeys')).statusCode).toBe(401);
    expect(
      (await early.send('POST', '/api/auth/passkey/delete-passkey', { id: passkeys[0]?.id }))
        .statusCode,
    ).toBe(401);
    expect(await listed(who)).toEqual(passkeys);
  });

  it('are never added, listed or removed through a member’s token, nor beside one', async () => {
    const account = await enrolled();
    expect((await addPasskey(account.who, createPasskeyDevice())).statusCode).toBe(200);
    const minted = await account.who.send('POST', '/api/tokens', { name: 'Herramienta', days: 1 });
    const { token } = minted.json<{ token: string }>();
    const bearer = { authorization: `Bearer ${token}` };
    const cookie = [...account.who.jar].map(([name, value]) => `${name}=${value}`).join('; ');
    // A tool's request carries the token alone; one beside the session stands for no one either.
    for (const headers of [bearer, { ...bearer, cookie }]) {
      const asTool = (method: 'GET' | 'POST', url: string, payload?: object) =>
        app.inject({
          method,
          url,
          headers: {
            host: ADMIN_HOST,
            ...headers,
            ...(payload ? { 'content-type': 'application/json', origin: ADMIN_ORIGIN } : {}),
          },
          ...(payload ? { payload: JSON.stringify(payload) } : {}),
        });
      expect((await asTool('GET', '/api/passkeys')).statusCode).toBe(401);
      expect((await asTool('GET', '/api/auth/passkey/generate-register-options')).statusCode).toBe(
        401,
      );
      expect(
        (await asTool('POST', '/api/auth/passkey/delete-passkey', { id: 'cualquiera' })).statusCode,
      ).toBe(401);
    }
    expect(await listed(account.who)).toHaveLength(1);
  });

  it('are added only within 12 hours of a second factor (PLAN D23)', async () => {
    const account = await enrolled();
    const [session] = await sessionsOf(account.id);
    await authPool.query(
      `UPDATE sessions SET created_at = now() - interval '13 hours', expires_at = now() + interval '1 hour'
        WHERE id = $1`,
      [session?.id],
    );
    const options = await account.who.send('GET', '/api/auth/passkey/generate-register-options');
    expect(options.statusCode).toBe(403);
    expect(options.json()).toEqual({ error: 'stepUp' });
  });

  it('once removed, let nobody in, and end their member’s sessions and tokens, as a new password does', async () => {
    const account = await enrolled();
    const kept = createPasskeyDevice();
    const removed = createPasskeyDevice();
    expect((await addPasskey(account.who, kept, { name: 'Teléfono' })).statusCode).toBe(200);
    expect((await addPasskey(account.who, removed, { name: 'Portátil' })).statusCode).toBe(200);
    const laptop = (await listed(account.who)).find((passkey) => passkey.name === 'Portátil');
    const minted = await account.who.send('POST', '/api/tokens', { name: 'Herramienta', days: 1 });
    const { token } = minted.json<{ token: string }>();
    // A session the passkey opened elsewhere (a laptop now lost, say).
    const lost = visitor();
    expect((await signInWith(lost, removed)).statusCode).toBe(200);

    expect(
      (await account.who.send('POST', '/api/auth/passkey/delete-passkey', { id: laptop?.id }))
        .statusCode,
    ).toBe(200);
    // Every session ended, this one too, and the token stands for no one.
    expect((await lost.send('GET', '/api/session')).statusCode).toBe(401);
    expect((await account.who.send('GET', '/api/session')).statusCode).toBe(401);
    expect(await tokens.find(token)).toBeUndefined();
    expect((await signInWith(visitor(), removed)).statusCode).toBe(401);
    expect((await signInWith(visitor(), kept)).statusCode).toBe(200);
  });

  it('go with the owner’s reset of a lost authenticator', async () => {
    const account = await enrolled();
    const device = createPasskeyDevice();
    expect((await addPasskey(account.who, device)).statusCode).toBe(200);
    expect(await resetAuthenticator(authPool, account.id)).toMatchObject({ kind: 'reset' });
    expect(
      (await authPool.query('SELECT 1 FROM passkeys WHERE user_id = $1', [account.id])).rowCount,
    ).toBe(0);
    expect((await signInWith(visitor(), device)).statusCode).toBe(401);
  });
});

describe('sessions (PLAN D22)', () => {
  it('start with 48 hours, move on as they are used, and end a week after sign-in at the latest', async () => {
    const account = await enrolled();
    const [session] = await sessionsOf(account.id);
    expect(session?.ends_in).toBeGreaterThan(48 * HOURS - 60);
    expect(session?.ends_in).toBeLessThanOrEqual(48 * HOURS);

    // The cookie lasts the week; the row's end decides.
    expect(account.cookie).toContain(`Max-Age=${SESSION_SECONDS}`);

    // Used an hour before it would end: it lives 48 hours from now again.
    await authPool.query(
      `UPDATE sessions SET expires_at = now() + interval '1 hour' WHERE id = $1`,
      [session?.id],
    );
    expect((await account.who.send('GET', '/api/session')).statusCode).toBe(200);
    const moved = (await sessionsOf(account.id)).find((row) => row.id === session?.id);
    expect(moved?.ends_in).toBeGreaterThan(48 * HOURS - 60);

    // Near the end of its week, use moves it only to the week's end.
    await authPool.query(
      `UPDATE sessions SET created_at = now() - interval '6 days 23 hours', expires_at = now() + interval '5 minutes'
        WHERE id = $1`,
      [session?.id],
    );
    expect((await account.who.send('GET', '/api/session')).statusCode).toBe(200);
    const capped = (await sessionsOf(account.id)).find((row) => row.id === session?.id);
    expect(capped?.lasts).toBe(SESSION_SECONDS);

    // Unused past its end, it is over.
    await authPool.query(
      `UPDATE sessions SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [session?.id],
    );
    expect((await account.who.send('GET', '/api/session')).json()).toEqual({ stage: 'signed-out' });
  });

  it('are moved on at most once a minute, not on every request', async () => {
    const account = await enrolled();
    const [session] = await sessionsOf(account.id);
    await authPool.query(
      `UPDATE sessions SET expires_at = now() + interval '48 hours' - interval '30 seconds' WHERE id = $1`,
      [session?.id],
    );
    const end = async () =>
      (
        await authPool.query<{ end: string }>(
          'SELECT expires_at::text AS end FROM sessions WHERE id = $1',
          [session?.id],
        )
      ).rows[0]?.end;
    const before = await end();
    expect((await account.who.send('GET', '/api/session')).statusCode).toBe(200);
    expect(await end()).toBe(before);
  });

  it('stay ended once over, even if one was found a moment before it ended', async () => {
    const account = await enrolled();
    const [session] = await sessionsOf(account.id);
    await authPool.query(
      `UPDATE sessions SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [session?.id],
    );
    await keepSessionAlive(authPool, session?.id ?? '');
    expect((await sessionsOf(account.id))[0]?.ends_in).toBeLessThanOrEqual(0);
  });
});
