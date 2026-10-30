import { createAuthPool } from '@aiontheballot/db/auth-pool';
import { createDatabase } from '@aiontheballot/db/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TOKEN_ROUTES } from '../src/admin/routes.js';
import { buildApp } from '../src/app.js';
import { createAuth } from '../src/auth/auth.js';
import { createMemberTokens } from '../src/auth/member-tokens.js';
import { STEP_UP_ATTEMPTS } from '../src/auth/step-up.js';
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
const admin = createDatabase({
  connectionString: env('TEST_ADMIN_DATABASE_URL'),
  maxConnections: 2,
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
    admin,
    tokens,
  },
});

/** Every route under /api, as `METHOD /pattern`, and how it is marked (PLAN D23): always, or for some bodies. */
const marks = new Map<string, 'always' | 'some bodies'>();
app.addHook('onRoute', (route) => {
  const marked = route.config?.recentSecondFactor;
  if (marked === undefined) {
    return;
  }
  for (const method of [route.method].flat()) {
    if (method !== 'HEAD') {
      marks.set(`${method} ${route.url}`, marked === true ? 'always' : 'some bodies');
    }
  }
});

const accounts: string[] = [];
const addresses: string[] = [];

type Visitor = ReturnType<typeof browser>;

const visitor = (): Visitor => {
  const address = testAddress();
  addresses.push(address);
  return browser(app, address);
};

/** Another address for the next attempt, so Better Auth's limit per address (3 codes in 10 seconds) stays out of it. */
const elsewhere = () => {
  const address = testAddress();
  addresses.push(address);
  return { 'x-forwarded-for': address };
};

/** A member, enrolled and signed in with a code, and the authenticator's key to make more. */
const signedIn = async () => {
  const created = await createAccount(authPool);
  accounts.push(created.id);
  const who = visitor();
  await who.send('POST', '/api/auth/sign-in/email', { email: created.email, password: PASSWORD });
  const enabled = await who.send('POST', '/api/auth/two-factor/enable', { password: PASSWORD });
  const { totpURI } = enabled.json<{ totpURI: string }>();
  expect(
    (await who.send('POST', '/api/auth/two-factor/verify-totp', { code: totpCode(totpURI) }))
      .statusCode,
  ).toBe(200);
  return { ...created, who, totpURI };
};

/** The account's sessions signed in 13 hours ago, never confirmed since: their second factor is no longer recent. */
const ageSessions = async (userId: string) => {
  await authPool.query(
    `UPDATE sessions SET created_at = now() - interval '13 hours', expires_at = now() + interval '1 hour'
      WHERE user_id = $1`,
    [userId],
  );
  await authPool.query(
    'DELETE FROM session_step_ups WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1)',
    [userId],
  );
};

const ID = '0190f8c4-0000-7000-8000-00000000ffff';
const SITE = '/api/t/sitio-de-ejemplo';
const ELECTION = `${SITE}/e/elecciones-de-ejemplo`;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** The riskiest actions (PLAN D23), by pattern, as the admin calls them: each with a request that is one. */
const RISKIEST: readonly { route: string; method: Method; path: string; body?: object }[] = [
  // Who has access to a site.
  { route: 'POST /api/t/:tenant/invitations', method: 'POST', path: `${SITE}/invitations` },
  {
    route: 'POST /api/t/:tenant/invitations/:id/revoke',
    method: 'POST',
    path: `${SITE}/invitations/${ID}/revoke`,
  },
  {
    route: 'DELETE /api/t/:tenant/invitations/:id',
    method: 'DELETE',
    path: `${SITE}/invitations/${ID}`,
  },
  {
    route: 'POST /api/t/:tenant/members/:userId/roles',
    method: 'POST',
    path: `${SITE}/members/${ID}/roles`,
  },
  {
    route: 'DELETE /api/t/:tenant/members/:userId/roles/:role',
    method: 'DELETE',
    path: `${SITE}/members/${ID}/roles/editor`,
  },
  {
    route: 'POST /api/t/:tenant/members/:userId/password-reset',
    method: 'POST',
    path: `${SITE}/members/${ID}/password-reset`,
  },
  // A site's settings, and the platform's sites and who runs them.
  { route: 'PATCH /api/t/:tenant/settings', method: 'PATCH', path: `${SITE}/settings` },
  { route: 'POST /api/sites', method: 'POST', path: '/api/sites' },
  { route: 'PATCH /api/sites/:site', method: 'PATCH', path: '/api/sites/sitio-de-ejemplo' },
  {
    route: 'PUT /api/sites/:site/active',
    method: 'PUT',
    path: '/api/sites/sitio-de-ejemplo/active',
  },
  { route: 'PUT /api/sites/:site/open', method: 'PUT', path: '/api/sites/sitio-de-ejemplo/open' },
  {
    route: 'PUT /api/sites/:site/indexing',
    method: 'PUT',
    path: '/api/sites/sitio-de-ejemplo/indexing',
  },
  {
    route: 'PUT /api/sites/:site/analytics',
    method: 'PUT',
    path: '/api/sites/sitio-de-ejemplo/analytics',
  },
  { route: 'POST /api/organizations', method: 'POST', path: '/api/organizations' },
  { route: 'PUT /api/organizations/:id', method: 'PUT', path: `/api/organizations/${ID}` },
  // What the public sees, and the rules for it: going live, announcing, freezing, the review rule; a programme;
  // deciding a change, or applying one as it is proposed.
  ...(['status', 'announced', 'requireSecondReviewer', 'frozenFrom', 'frozenUntil'] as const).map(
    (field) => ({
      route: 'PATCH /api/t/:tenant/e/:election',
      method: 'PATCH' as const,
      path: ELECTION,
      body: { [field]: null },
    }),
  ),
  {
    route: 'PUT /api/t/:tenant/e/:election/parties/:id/programme',
    method: 'PUT',
    path: `${ELECTION}/parties/${ID}/programme`,
  },
  {
    route: 'POST /api/t/:tenant/e/:election/changes/:id/decision',
    method: 'POST',
    path: `${ELECTION}/changes/${ID}/decision`,
  },
  {
    route: 'POST /api/t/:tenant/e/:election/changes',
    method: 'POST',
    path: `${ELECTION}/changes`,
    body: { apply: true },
  },
  // Erasure.
  { route: 'POST /api/t/:tenant/e/:election/purge', method: 'POST', path: `${ELECTION}/purge` },
  { route: 'DELETE /api/t/:tenant/e/:election', method: 'DELETE', path: ELECTION },
  {
    route: 'POST /api/t/:tenant/reports/:id/anonymize',
    method: 'POST',
    path: `${SITE}/reports/${ID}/anonymize`,
  },
  // The audit logs.
  { route: 'GET /api/t/:tenant/audit', method: 'GET', path: `${SITE}/audit` },
  { route: 'GET /api/platform/audit', method: 'GET', path: '/api/platform/audit' },
  // Minting a member's token (ADR-0008).
  { route: 'POST /api/tokens', method: 'POST', path: '/api/tokens' },
];

/** Marked only for some bodies: these are not among the riskiest actions, and so reach the route itself. */
const NOT_RISKIEST: readonly { method: Method; path: string; body: object }[] = [
  { method: 'PATCH', path: ELECTION, body: { name: { es: 'Elecciones de ejemplo' } } },
  { method: 'POST', path: `${ELECTION}/changes`, body: { apply: false } },
  { method: 'POST', path: `${ELECTION}/changes`, body: {} },
];

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
  await authPool.end();
});

describe('the riskiest actions (PLAN D23)', () => {
  it('are exactly these routes, and none of them a member’s token reaches (ADR-0008)', () => {
    expect(Object.fromEntries(marks)).toEqual(
      Object.fromEntries(
        RISKIEST.map(({ route }) => [
          route,
          RISKIEST.some((risky) => risky.route === route && risky.body !== undefined)
            ? 'some bodies'
            : 'always',
        ]),
      ),
    );
    // Those marked for some bodies may be a token's (proposing a change), never in the bodies that are the riskiest.
    const always = [...marks].filter(([, how]) => how === 'always').map(([route]) => route);
    expect(always.filter((route) => TOKEN_ROUTES.has(route))).toEqual([]);
  });

  it('stop once the second factor is over 12 hours old, before anything else, and nothing else does', async () => {
    const member = await signedIn();
    expect((await member.who.send('GET', '/api/session')).json()).toMatchObject({
      recentSecondFactor: true,
    });
    await ageSessions(member.id);
    expect((await member.who.send('GET', '/api/session')).json()).toMatchObject({
      stage: 'signed-in',
      recentSecondFactor: false,
    });
    for (const { method, path, body } of RISKIEST) {
      const answer = await member.who.send(
        method,
        path,
        method === 'GET' ? undefined : (body ?? {}),
      );
      expect({ method, path, body, status: answer.statusCode, json: answer.json() }).toEqual({
        method,
        path,
        body,
        status: 403,
        json: { error: 'stepUp' },
      });
    }
    for (const passkey of ['generate-register-options', 'verify-registration']) {
      const answer = await member.who.send(
        passkey === 'generate-register-options' ? 'GET' : 'POST',
        `/api/auth/passkey/${passkey}`,
        passkey === 'generate-register-options' ? undefined : { response: {} },
      );
      expect([passkey, answer.statusCode, answer.json()]).toEqual([
        passkey,
        403,
        { error: 'stepUp' },
      ]);
    }
    for (const { method, path, body } of NOT_RISKIEST) {
      const answer = await member.who.send(method, path, body);
      expect([method, path, body, answer.json()]).not.toEqual([
        method,
        path,
        body,
        { error: 'stepUp' },
      ]);
    }
    // Everyday work goes on.
    expect((await member.who.send('GET', '/api/tenants')).statusCode).toBe(200);
    expect((await member.who.send('GET', '/api/tokens')).statusCode).toBe(200);
    expect((await member.who.send('GET', '/api/passkeys')).statusCode).toBe(200);
  });

  it('answer as they always do without a signed-in session: never asking to confirm', async () => {
    const stranger = visitor();
    for (const { method, path, body } of RISKIEST) {
      const answer = await stranger.send(method, path, method === 'GET' ? undefined : (body ?? {}));
      expect([method, path, answer.statusCode]).not.toEqual([method, path, 403]);
    }
  });

  it('never run through a member’s token, whatever its route lets it do', async () => {
    const member = await signedIn();
    const minted = await member.who.send('POST', '/api/tokens', { name: 'Herramienta', days: 1 });
    const { token } = minted.json<{ token: string }>();
    for (const { method, path, body } of RISKIEST) {
      const answer = await app.inject({
        method,
        url: path,
        headers: {
          host: ADMIN_HOST,
          authorization: `Bearer ${token}`,
          ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
        },
        ...(method === 'GET' ? {} : { payload: JSON.stringify(body ?? {}) }),
      });
      expect([method, path, body, answer.statusCode, answer.json()]).toEqual([
        method,
        path,
        body,
        403,
        { error: 'notForTokens' },
      ]);
    }
  });
});

describe('confirming it’s you again (PLAN D23)', () => {
  it('lets them run again for 12 hours after a code typed again', async () => {
    const member = await signedIn();
    await ageSessions(member.id);
    expect((await member.who.send('GET', '/api/platform/audit')).statusCode).toBe(403);
    const confirmed = await member.who.send(
      'POST',
      '/api/step-up',
      { code: totpCode(member.totpURI) },
      elsewhere(),
    );
    expect(confirmed.statusCode).toBe(204);
    expect((await member.who.send('GET', '/api/session')).json()).toMatchObject({
      recentSecondFactor: true,
    });
    // On to the route itself, which says this member is no platform admin.
    expect((await member.who.send('GET', '/api/platform/audit')).statusCode).toBe(404);
    // The confirmation lasts 12 hours too.
    await authPool.query(
      `UPDATE session_step_ups SET second_factor_at = now() - interval '12 hours 1 minute'
        WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1)`,
      [member.id],
    );
    expect((await member.who.send('GET', '/api/platform/audit')).statusCode).toBe(403);
  });

  it(`ends the session at the ${STEP_UP_ATTEMPTS}th wrong code, and counts attempts sent at once`, async () => {
    const member = await signedIn();
    await ageSessions(member.id);
    const wrong = String((Number(totpCode(member.totpURI)) + 500_000) % 1_000_000).padStart(6, '0');
    for (let attempt = 1; attempt < STEP_UP_ATTEMPTS; attempt += 1) {
      const answer = await member.who.send('POST', '/api/step-up', { code: wrong }, elsewhere());
      expect(answer.json()).toEqual({ error: 'invalidCode' });
    }
    const last = await member.who.send('POST', '/api/step-up', { code: wrong }, elsewhere());
    expect(last.statusCode).toBe(401);
    expect(last.json()).toEqual({ error: 'tooManyCodes' });
    expect((await member.who.send('GET', '/api/session')).statusCode).toBe(401);

    // Sent all at once, they still count one each: never more than the budget is checked.
    const other = await signedIn();
    await ageSessions(other.id);
    const answers = await Promise.all(
      Array.from({ length: STEP_UP_ATTEMPTS + 3 }, () =>
        other.who.send('POST', '/api/step-up', { code: wrong }, elsewhere()),
      ),
    );
    const checked = answers.filter(
      (answer) => answer.json<{ error: string }>().error === 'invalidCode',
    );
    expect(checked.length).toBeLessThanOrEqual(STEP_UP_ATTEMPTS);
    expect((await other.who.send('GET', '/api/session')).statusCode).toBe(401);
  });

  it('asks a code only from a signed-in session on the admin origin, never through a token', async () => {
    const member = await signedIn();
    expect(
      (await visitor().send('POST', '/api/step-up', { code: totpCode(member.totpURI) })).statusCode,
    ).toBe(401);
    expect(
      (
        await member.who.send(
          'POST',
          '/api/step-up',
          { code: totpCode(member.totpURI) },
          { origin: 'https://otro.ejemplo.test' },
        )
      ).statusCode,
    ).toBe(403);
    const minted = await member.who.send('POST', '/api/tokens', { name: 'Herramienta', days: 1 });
    const { token } = minted.json<{ token: string }>();
    expect(
      (
        await member.who.send(
          'POST',
          '/api/step-up',
          { code: totpCode(member.totpURI) },
          { authorization: `Bearer ${token}` },
        )
      ).statusCode,
    ).toBe(401);
  });

  it('never lets a signed-in session check codes through Better Auth, where nothing counts them', async () => {
    const member = await signedIn();
    for (const path of [
      '/api/auth/two-factor/verify-totp',
      '/api/auth/two-factor/verify-backup-code',
    ]) {
      expect((await member.who.send('POST', path, { code: '000000' })).statusCode).toBe(403);
    }
  });

  it('lets a session signed in days ago add a passkey once confirmed: the code counts, not the sign-in', async () => {
    const member = await signedIn();
    await authPool.query(
      `UPDATE sessions SET created_at = now() - interval '2 days', expires_at = now() + interval '1 hour'
        WHERE user_id = $1`,
      [member.id],
    );
    expect(
      (
        await member.who.send(
          'POST',
          '/api/step-up',
          { code: totpCode(member.totpURI) },
          elsewhere(),
        )
      ).statusCode,
    ).toBe(204);
    const device = createPasskeyDevice();
    const options = await member.who.send('GET', '/api/auth/passkey/generate-register-options');
    expect(options.statusCode).toBe(200);
    expect(
      (
        await member.who.send('POST', '/api/auth/passkey/verify-registration', {
          response: device.register(options.json()),
        })
      ).statusCode,
    ).toBe(200);
  });

  it('takes a passkey instead, which signs in afresh', async () => {
    const member = await signedIn();
    const device = createPasskeyDevice();
    const options = await member.who.send('GET', '/api/auth/passkey/generate-register-options');
    expect(
      (
        await member.who.send('POST', '/api/auth/passkey/verify-registration', {
          response: device.register(options.json()),
        })
      ).statusCode,
    ).toBe(200);
    await ageSessions(member.id);
    expect((await member.who.send('GET', '/api/platform/audit')).statusCode).toBe(403);
    const challenge = await member.who.send(
      'GET',
      '/api/auth/passkey/generate-authenticate-options',
    );
    expect(
      (
        await member.who.send('POST', '/api/auth/passkey/verify-authentication', {
          response: device.authenticate(challenge.json()),
        })
      ).statusCode,
    ).toBe(200);
    expect((await member.who.send('GET', '/api/session')).json()).toMatchObject({
      recentSecondFactor: true,
    });
    expect((await member.who.send('GET', '/api/platform/audit')).statusCode).toBe(404);
  });
});
