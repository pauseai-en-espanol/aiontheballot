import { createAuthPool } from '@aiontheballot/db/auth-pool';
import { createDatabase } from '@aiontheballot/db/client';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ProfileSource } from '../src/admin/profiles.js';

import { createProfileSource } from '../src/admin/profiles.js';
import { adminDataRoutes } from '../src/admin/routes.js';
import { createAccount, deleteAccount } from './auth-fixtures.js';
import { TENANT_A, USERS } from './fixtures.js';
import './db.js';

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.`);
  }
  return value;
};

const ORIGIN = 'https://admin.ejemplo.test';
const admin = createDatabase({
  connectionString: env('TEST_ADMIN_DATABASE_URL'),
  maxConnections: 2,
});
const owner = createDatabase({
  connectionString: env('TEST_SUPERUSER_DATABASE_URL'),
  maxConnections: 1,
});

/** What the routes asked the profile source for, so a test can see they asked for no more than RLS showed. */
const asked: { ids: readonly string[]; emails: boolean }[] = [];

/** Fictional names for the fixture users, who have no accounts; one is left without, as a deleted account would be. */
const profiles: ProfileSource = async (ids, { emails }) => {
  asked.push({ ids, emails });
  return new Map(
    ids
      .filter((id) => id !== USERS.editorAReviewerB)
      .map((id) => [
        id,
        {
          name: `Persona ${id.slice(-2)}`,
          ...(emails ? { email: `persona-${id.slice(-2)}@example.org` } : {}),
        },
      ]),
  );
};

/**
 * The routes as the API mounts them, with the actor a test names in a header standing in for the session, which the
 * sign-in tests cover (auth.spec.ts). Writes here commit, so each test puts back what it changed.
 */
const build = (options: { withAdmin?: boolean } = {}): FastifyInstance => {
  const app = Fastify();
  void app.register(
    adminDataRoutes({
      admin: options.withAdmin === false ? undefined : admin,
      profiles,
      adminOrigin: ORIGIN,
      actorFor: async (request) => {
        const user = request.headers['x-test-user'];
        return typeof user === 'string' ? { userId: user, aal: 2 } : undefined;
      },
    }),
    { prefix: '/api' },
  );
  return app;
};
const app = build();

const send = (
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  as: string | undefined,
  { body, origin = ORIGIN }: { body?: unknown; origin?: string | null } = {},
) =>
  app.inject({
    method,
    url,
    headers: {
      ...(as ? { 'x-test-user': as } : {}),
      ...(method !== 'GET' && origin !== null ? { origin } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });

/** A role as the owner adds one, stamped as the member's own, to put back what a test removed. */
const restoreRole = (userId: string, role: 'country_admin' | 'editor' | 'reviewer') =>
  owner.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.user_id', ${userId}, true)`.execute(trx);
    await sql`INSERT INTO app.memberships (user_id, tenant_id, role)
              VALUES (${userId}, ${TENANT_A}, ${role}) ON CONFLICT DO NOTHING`.execute(trx);
  });

const rolesOf = async (userId: string) =>
  (
    await sql<{ role: string }>`SELECT role FROM app.memberships
                                 WHERE user_id = ${userId} AND tenant_id = ${TENANT_A} ORDER BY role`.execute(
      owner,
    )
  ).rows.map((row) => row.role);

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await admin.destroy();
  await owner.destroy();
});

describe('the signed-in data routes', () => {
  it('answer 401 without an actor, and 503 without the admin role', async () => {
    expect((await send('GET', '/api/tenants', undefined)).statusCode).toBe(401);
    const unconfigured = build({ withAdmin: false });
    const response = await unconfigured.inject({
      method: 'GET',
      url: '/api/tenants',
      headers: { 'x-test-user': USERS.editorA },
    });
    expect(response.statusCode).toBe(503);
    await unconfigured.close();
  });

  it('list the tenants RLS shows, and say whether the user is a platform admin (A6)', async () => {
    const member = await send('GET', '/api/tenants', USERS.editorAReviewerB);
    expect(member.json()).toEqual({
      tenants: [
        { slug: 'test-a', name: expect.any(Object), defaultLocale: 'es' },
        { slug: 'test-b', name: expect.any(Object), defaultLocale: 'es' },
      ],
      platformAdmin: false,
    });
    const platform = await send('GET', '/api/tenants', USERS.platformAdmin);
    expect(platform.json()).toMatchObject({ platformAdmin: true });
    expect(platform.json<{ tenants: unknown[] }>().tenants).toHaveLength(3);
  });

  it("give a tenant's settings and the actor's roles there, and 404 for a tenant RLS hides", async () => {
    const overview = await send('GET', '/api/t/test-a', USERS.countryAdminA);
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({
      tenant: {
        slug: 'test-a',
        defaultLocale: 'es',
        enabledLocales: expect.arrayContaining(['es']),
        methodologyKind: expect.any(String),
        active: true,
        reportRetentionDays: expect.any(Number),
        liveEditsNeedSecondApprover: expect.any(Boolean),
      },
      roles: ['country_admin'],
      platformAdmin: false,
    });
    const hidden = await send('GET', '/api/t/test-a', USERS.countryAdminB);
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toEqual({ error: 'notFound' });
    expect((await send('GET', '/api/t/no-existe', USERS.platformAdmin)).statusCode).toBe(404);
    expect((await send('GET', '/api/t/Not_A_Slug', USERS.platformAdmin)).statusCode).toBe(400);
  });
});

describe('members (editorial workflow A7)', () => {
  it('give every member names and roles, and emails only to country and platform admins', async () => {
    const editor = (await send('GET', '/api/t/test-a/members', USERS.editorA)).json<{
      members: Record<string, unknown>[];
      canManage: boolean;
      emailsShown: boolean;
    }>();
    expect(editor).toMatchObject({ canManage: false, emailsShown: false });
    expect(editor.members).toHaveLength(4);
    expect(editor.members).toContainEqual({
      userId: USERS.reviewerA,
      name: 'Persona 03',
      roles: ['reviewer'],
    });
    for (const member of editor.members) {
      expect(member).not.toHaveProperty('email');
    }
    for (const manager of [USERS.countryAdminA, USERS.platformAdmin]) {
      const managed = (await send('GET', '/api/t/test-a/members', manager)).json<{
        members: Record<string, unknown>[];
        canManage: boolean;
      }>();
      expect(managed.canManage).toBe(true);
      expect(managed.members).toContainEqual({
        userId: USERS.reviewerA,
        name: 'Persona 03',
        email: 'persona-03@example.org',
        roles: ['reviewer'],
      });
      // An account that is gone keeps its roles, with neither name nor email.
      expect(managed.members).toContainEqual({
        userId: USERS.editorAReviewerB,
        name: null,
        email: null,
        roles: ['editor'],
      });
    }
    expect((await send('GET', '/api/t/test-a/members', USERS.countryAdminB)).statusCode).toBe(404);
  });

  it("ask Better Auth's role only for the members RLS showed, and for emails only when they are shown", async () => {
    asked.length = 0;
    await send('GET', '/api/t/test-a/members', USERS.editorA);
    await send('GET', '/api/t/test-a/members', USERS.countryAdminA);
    await send('GET', '/api/t/test-a/members', USERS.countryAdminB);
    expect(asked).toHaveLength(2);
    const members = [USERS.editorA, USERS.reviewerA, USERS.countryAdminA, USERS.editorAReviewerB];
    expect([...(asked[0]?.ids ?? [])].sort()).toEqual([...members].sort());
    expect(asked.map((call) => call.emails)).toEqual([false, true]);
  });

  it('remove a role, as a country admin, and take it from the member at once', async () => {
    try {
      const removed = await send(
        'DELETE',
        `/api/t/test-a/members/${USERS.editorAReviewerB}/roles/editor`,
        USERS.countryAdminA,
      );
      expect(removed.statusCode).toBe(204);
      expect(await rolesOf(USERS.editorAReviewerB)).toEqual([]);
      // No role left in A: the tenant is gone for them, and B is still theirs.
      expect((await send('GET', '/api/t/test-a', USERS.editorAReviewerB)).statusCode).toBe(404);
      expect((await send('GET', '/api/t/test-b', USERS.editorAReviewerB)).statusCode).toBe(200);
    } finally {
      await restoreRole(USERS.editorAReviewerB, 'editor');
    }
  });

  // Each refusal test puts the role back too, so a build that wrongly allows the write can't break the next tests.
  it("refuse the tenant's last country admin, and change nothing", async () => {
    try {
      const refused = await send(
        'DELETE',
        `/api/t/test-a/members/${USERS.countryAdminA}/roles/country_admin`,
        USERS.platformAdmin,
      );
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toEqual({ error: 'lastCountryAdmin' });
      expect(await rolesOf(USERS.countryAdminA)).toEqual(['country_admin']);
    } finally {
      await restoreRole(USERS.countryAdminA, 'country_admin');
    }
  });

  it('refuse an editor, a missing role, a write from another origin, and a role that is no role', async () => {
    try {
      await refusals();
    } finally {
      await restoreRole(USERS.reviewerA, 'reviewer');
    }
  });

  const refusals = async () => {
    const url = `/api/t/test-a/members/${USERS.reviewerA}/roles/reviewer`;
    const editor = await send('DELETE', url, USERS.editorA);
    expect(editor.statusCode).toBe(403);
    expect(editor.json()).toEqual({ error: 'forbidden' });
    const missing = await send(
      'DELETE',
      `/api/t/test-a/members/${USERS.reviewerA}/roles/editor`,
      USERS.countryAdminA,
    );
    expect(missing.statusCode).toBe(404);
    for (const origin of [null, 'https://otro.ejemplo.test']) {
      expect((await send('DELETE', url, USERS.countryAdminA, { origin })).statusCode).toBe(403);
    }
    expect(
      (
        await send(
          'DELETE',
          `/api/t/test-a/members/${USERS.reviewerA}/roles/owner`,
          USERS.countryAdminA,
        )
      ).statusCode,
    ).toBe(400);
    expect(await rolesOf(USERS.reviewerA)).toEqual(['reviewer']);
  };

  it('give an existing member another role, and refuse what the database or the API refuses', async () => {
    const url = (userId: string) => `/api/t/test-a/members/${userId}/roles`;
    try {
      const added = await send('POST', url(USERS.editorA), USERS.countryAdminA, {
        body: { role: 'reviewer' },
      });
      expect(added.statusCode).toBe(204);
      expect(await rolesOf(USERS.editorA)).toEqual(['editor', 'reviewer']);

      const again = await send('POST', url(USERS.editorA), USERS.countryAdminA, {
        body: { role: 'reviewer' },
      });
      expect(again.statusCode).toBe(409);
      expect(again.json()).toEqual({ error: 'taken', constraint: 'memberships_pkey' });

      const stranger = await send('POST', url(USERS.countryAdminB), USERS.countryAdminA, {
        body: { role: 'editor' },
      });
      expect(stranger.statusCode).toBe(409);
      expect(stranger.json()).toEqual({ error: 'notMember' });

      const editor = await send('POST', url(USERS.reviewerA), USERS.editorA, {
        body: { role: 'editor' },
      });
      expect(editor.statusCode).toBe(403);
      expect(editor.json()).toEqual({ error: 'forbidden' });

      const odd = await send('POST', url(USERS.reviewerA), USERS.countryAdminA, {
        body: { role: 'platform_admin' },
      });
      expect(odd.statusCode).toBe(400);
      expect(await rolesOf(USERS.reviewerA)).toEqual(['reviewer']);
    } finally {
      await sql`DELETE FROM app.memberships
                 WHERE user_id = ${USERS.editorA} AND tenant_id = ${TENANT_A} AND role = 'reviewer'`.execute(
        owner,
      );
      await sql`DELETE FROM app.memberships
                 WHERE user_id IN (${USERS.countryAdminB}, ${USERS.reviewerA}) AND tenant_id = ${TENANT_A}
                   AND role = 'editor'`.execute(owner);
    }
  });
});

describe("members' names and emails (PLAN R94)", () => {
  const authPool = createAuthPool({
    connectionString: env('TEST_AUTH_DATABASE_URL'),
    maxConnections: 1,
  });

  afterAll(async () => {
    await authPool.end();
  });

  it("are read by id from Better Auth's tables, for real accounts only", async () => {
    const { id, email } = await createAccount(authPool);
    try {
      const source = createProfileSource(authPool);
      const ids = [id, crypto.randomUUID(), 'not-an-id', id];
      expect([...(await source(ids, { emails: true }))]).toEqual([
        [id, { name: 'Persona de ejemplo', email }],
      ]);
      expect([...(await source(ids, { emails: false }))]).toEqual([
        [id, { name: 'Persona de ejemplo' }],
      ]);
      expect(await source([], { emails: true })).toEqual(new Map());
    } finally {
      await deleteAccount(authPool, id);
    }
  });
});
