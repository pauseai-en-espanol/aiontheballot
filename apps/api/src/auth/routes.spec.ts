import type { FastifyInstance } from 'fastify';

import { createDatabase } from '@aiontheballot/db/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { Auth } from './auth.js';
import type { FoundSession } from './session.js';

import { buildApp } from '../app.js';
import { TWO_FACTOR_COOKIE, VISITOR_ADDRESS_HEADER } from './auth.js';

const ORIGIN = 'https://admin.example.test';
const HOST = 'admin.example.test';
const SESSION_ID = '0199c7a0-0000-7000-8000-0000000000aa';

/** A stand-in for Better Auth that records what reaches it. */
const fakeAuth = (
  respond: (request: Request) => Response = () => Response.json({ ok: true }),
  session: FoundSession | null = null,
) => {
  const seen: { request: Request; body: unknown }[] = [];
  const auth: Auth = {
    handler: async (request) => {
      seen.push({ request, body: await request.clone().json() });
      return respond(request);
    },
    api: { getSession: async () => session },
  };
  return { auth, seen };
};

const apps: FastifyInstance[] = [];
const appWith = (auth?: Auth, withAdminDatabase = false) => {
  const app = buildApp({
    admin: {
      auth: auth ? { auth, adminOrigin: ORIGIN } : undefined,
      // Never connected: these tests stop before any query.
      admin: withAdminDatabase
        ? createDatabase({ connectionString: 'postgres://nobody@127.0.0.1:1/none' })
        : undefined,
    },
  });
  apps.push(app);
  return app;
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const post = (
  app: FastifyInstance,
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  app.inject({
    method: 'POST',
    url,
    headers: { host: HOST, 'content-type': 'application/json', ...headers },
    payload: JSON.stringify(body),
  });

describe('/api (admin host)', () => {
  it('answers 503 everywhere while sign-in is not configured', async () => {
    const app = appWith();
    for (const url of ['/api/auth/sign-in/email', '/api/session', '/api/tenants']) {
      const response = await app.inject({ method: 'GET', url, headers: { host: HOST } });
      expect(response.statusCode, url).toBe(503);
    }
  });

  it('answers 404 on any other host, before Better Auth sees the request', async () => {
    const { auth, seen } = fakeAuth();
    const app = appWith(auth);
    for (const host of [
      'ejemplo-a.localhost',
      'admin.example.test.evil.test',
      `${HOST}:8443`,
      'ADMIN.EXAMPLE.TEST',
      `${HOST}.`,
      '',
    ]) {
      const response = await post(app, '/api/auth/sign-in/email', {}, { host });
      expect(response.statusCode, host).toBe(404);
      expect(response.headers).toMatchObject({
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'same-origin',
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      });
    }
    const session = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { host: 'x.test' },
    });
    expect(session.statusCode).toBe(404);
    expect(seen).toEqual([]);
  });

  it('passes on only the endpoints the admin uses', async () => {
    const { auth, seen } = fakeAuth();
    const app = appWith(auth);
    for (const path of [
      '/sign-up/email',
      '/two-factor/disable',
      '/get-session',
      '/sign-in/social',
    ]) {
      expect((await post(app, `/api/auth${path}`, {})).statusCode, path).toBe(404);
    }
    const get = await app.inject({
      method: 'GET',
      url: '/api/auth/sign-in/email',
      headers: { host: HOST },
    });
    expect(get.statusCode).toBe(404);
    expect(seen).toEqual([]);
  });

  it('refuses bodies that are not JSON, so a cross-site form can never post one', async () => {
    const { auth, seen } = fakeAuth();
    const app = appWith(auth);
    for (const [type, payload] of [
      ['application/x-www-form-urlencoded', 'email=a%40example.org&password=x'],
      ['text/plain', '{"email":"a@example.org","password":"x"}'],
      ['text/plain;charset=UTF-8', '{}'],
      ['multipart/form-data; boundary=x', '--x--'],
    ]) {
      for (const path of ['/sign-in/email', '/sign-out']) {
        const response = await app.inject({
          method: 'POST',
          url: `/api/auth${path}`,
          headers: { host: HOST, 'content-type': type },
          payload,
        });
        expect(response.statusCode, `${type} ${path}`).toBe(415);
      }
    }
    expect(seen).toEqual([]);
  });

  it('passes on only the fields each endpoint needs: no remember-me, trusted device, issuer or callback', async () => {
    const { auth, seen } = fakeAuth();
    const app = appWith(auth);
    await post(app, '/api/auth/sign-in/email', {
      email: 'persona@example.org',
      password: 'una contraseña de ejemplo',
      rememberMe: false,
      callbackURL: 'https://evil.test',
    });
    await post(app, '/api/auth/two-factor/verify-totp', { code: '123456', trustDevice: true });
    await post(app, '/api/auth/two-factor/verify-backup-code', {
      code: 'abcde-fghij',
      trustDevice: true,
    });
    await post(app, '/api/auth/two-factor/enable', {
      password: 'x',
      issuer: 'Otra',
      method: 'otp',
    });
    await post(app, '/api/auth/sign-out', { anything: 1 });
    await post(app, '/api/auth/reset-password', {
      token: 't',
      newPassword: 'una contraseña de ejemplo',
      callbackURL: 'https://evil.test',
    });
    await post(app, '/api/auth/request-password-reset', {
      email: 'persona@example.org',
      redirectTo: 'https://evil.test',
    });
    expect(seen.map(({ request, body }) => [new URL(request.url).pathname, body])).toEqual([
      [
        '/api/auth/sign-in/email',
        { email: 'persona@example.org', password: 'una contraseña de ejemplo' },
      ],
      ['/api/auth/two-factor/verify-totp', { code: '123456' }],
      ['/api/auth/two-factor/verify-backup-code', { code: 'abcde-fghij' }],
      ['/api/auth/two-factor/enable', { password: 'x' }],
      ['/api/auth/sign-out', {}],
      ['/api/auth/reset-password', { token: 't', newPassword: 'una contraseña de ejemplo' }],
      ['/api/auth/request-password-reset', { email: 'persona@example.org' }],
    ]);
  });

  it("addresses Better Auth by the configured origin, with the browser's headers it needs and the visitor's address", async () => {
    const { auth, seen } = fakeAuth();
    await post(
      appWith(auth),
      '/api/auth/sign-in/email?callbackURL=https://evil.test',
      {},
      {
        cookie: '__Host-admin.session_token=abc',
        origin: ORIGIN,
        'accept-language': 'es-ES,es;q=0.9',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Navegador de ejemplo',
        'x-forwarded-for': '192.0.2.1, 203.0.113.7',
        'x-forwarded-host': 'evil.test',
        authorization: 'Bearer abc',
        [VISITOR_ADDRESS_HEADER]: '192.0.2.99',
      },
    );
    const [{ request }] = seen as [(typeof seen)[number]];
    expect(request.url).toBe(`${ORIGIN}/api/auth/sign-in/email`);
    expect(Object.fromEntries(request.headers)).toEqual({
      'content-type': 'application/json',
      'accept-language': 'es-ES,es;q=0.9',
      cookie: '__Host-admin.session_token=abc',
      origin: ORIGIN,
      'sec-fetch-site': 'same-origin',
      'user-agent': 'Navegador de ejemplo',
      [VISITOR_ADDRESS_HEADER]: '203.0.113.7',
    });
  });

  it('returns the status, cookies, wait and body, without the session token', async () => {
    const { auth } = fakeAuth(() => {
      const headers = new Headers({ 'content-type': 'application/json', 'x-retry-after': '7' });
      headers.append(
        'set-cookie',
        '__Host-admin.session_token=t; Path=/; HttpOnly; Secure; SameSite=Lax',
      );
      headers.append('set-cookie', '__Host-admin.two_factor=; Max-Age=0; Path=/; HttpOnly; Secure');
      headers.append('location', 'https://evil.test');
      return new Response(JSON.stringify({ token: 'secret-token', user: { id: 'u' } }), {
        status: 200,
        headers,
      });
    });
    const response = await post(appWith(auth), '/api/auth/sign-in/email', {});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user: { id: 'u' } });
    expect(response.headers['set-cookie']).toEqual([
      '__Host-admin.session_token=t; Path=/; HttpOnly; Secure; SameSite=Lax',
      '__Host-admin.two_factor=; Max-Age=0; Path=/; HttpOnly; Secure',
    ]);
    expect(response.headers['x-retry-after']).toBe('7');
    expect(response.headers.location).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('passes errors on as they are', async () => {
    const { auth } = fakeAuth(() =>
      Response.json(
        { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
        { status: 401 },
      ),
    );
    const response = await post(appWith(auth), '/api/auth/sign-in/email', {});
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: 'INVALID_EMAIL_OR_PASSWORD',
      message: 'Invalid email or password',
    });
  });
});

describe('/api/session', () => {
  const user = {
    id: '0199c7a0-0000-7000-8000-000000000001',
    name: 'Persona',
    email: 'p@example.org',
  };
  const get = (auth: Auth, cookie?: string) =>
    appWith(auth).inject({
      method: 'GET',
      url: '/api/session',
      headers: { host: HOST, ...(cookie ? { cookie } : {}) },
    });

  it('names the stage and the user, never the session itself', async () => {
    const signedIn = await get(
      fakeAuth(undefined, {
        session: { id: SESSION_ID, aal: 2 },
        user: { ...user, twoFactorEnabled: true },
      }).auth,
    );
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json()).toEqual({ stage: 'signed-in', user });
    const enrol = await get(
      fakeAuth(undefined, {
        session: { id: SESSION_ID, aal: 1 },
        user: { ...user, twoFactorEnabled: false },
      }).auth,
    );
    expect(enrol.json()).toEqual({ stage: 'enrol', user });
  });

  it('answers 401 short of that: a pending challenge, or nothing', async () => {
    const stale = await get(
      fakeAuth(undefined, {
        session: { id: SESSION_ID, aal: 1 },
        user: { ...user, twoFactorEnabled: true },
      }).auth,
    );
    expect([stale.statusCode, stale.json()]).toEqual([401, { stage: 'signed-out' }]);
    const challenge = await get(fakeAuth().auth, `a=1; ${TWO_FACTOR_COOKIE}=signed`);
    expect([challenge.statusCode, challenge.json()]).toEqual([401, { stage: 'challenge' }]);
    const none = await get(fakeAuth().auth, `x${TWO_FACTOR_COOKIE}=1`);
    expect([none.statusCode, none.json()]).toEqual([401, { stage: 'signed-out' }]);
  });
});

describe('/api faults and unknown routes (PLAN R208)', () => {
  const HEADERS = {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'same-origin',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  };

  it('answers a fault as unexpected, never with its message: a token checked while its database is down', async () => {
    const app = buildApp({
      admin: {
        auth: { auth: fakeAuth().auth, adminOrigin: ORIGIN },
        admin: createDatabase({ connectionString: 'postgres://nobody@127.0.0.1:1/none' }),
        tokens: {
          find: async () => {
            throw Object.assign(new Error('getaddrinfo ENOTFOUND auth-db.internal.test'), {
              code: 'ENOTFOUND',
            });
          },
          mint: async () => {
            throw new Error('not in this test');
          },
          list: async () => [],
          revoke: async () => false,
        },
      },
    });
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/tenants',
      headers: { host: HOST, authorization: `Bearer aiontheballot_${'a'.repeat(43)}` },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'unexpected' });
    expect(response.headers).toMatchObject(HEADERS);
  });

  it("answers an unknown route as data, with the scope's headers, saying nothing of the server", async () => {
    const app = appWith(fakeAuth().auth);
    for (const [method, url] of [
      ['GET', '/api/nonexistent'],
      ['GET', '/api/auth/sign-in/email'],
      ['DELETE', '/api/session'],
    ] as const) {
      const response = await app.inject({ method, url, headers: { host: HOST } });
      expect(response.statusCode, url).toBe(404);
      expect(response.json(), url).toEqual({ error: 'Not found' });
      expect(response.headers, url).toMatchObject(HEADERS);
    }
  });
});

describe('/api/tenants', () => {
  it('answers 503 without the admin database, and 401 to any session short of aal2', async () => {
    const enrolling = fakeAuth(undefined, {
      session: { id: SESSION_ID, aal: 1 },
      user: { id: '0199c7a0-0000-7000-8000-000000000001', name: 'P', email: 'p@example.org' },
    }).auth;
    const get = (app: FastifyInstance) =>
      app.inject({ method: 'GET', url: '/api/tenants', headers: { host: HOST } });
    expect((await get(appWith(enrolling))).statusCode).toBe(503);
    expect((await get(appWith(enrolling, true))).statusCode).toBe(401);
    expect((await get(appWith(fakeAuth().auth, true))).statusCode).toBe(401);
  });
});
