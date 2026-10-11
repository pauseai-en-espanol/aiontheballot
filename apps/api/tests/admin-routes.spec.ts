import { createAuthPool } from '@aiontheballot/db/auth-pool';
import { createDatabase } from '@aiontheballot/db/client';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ProfileSource } from '../src/admin/profiles.js';

import { createProfileSource } from '../src/admin/profiles.js';
import { adminDataRoutes } from '../src/admin/routes.js';
import { createAccount, deleteAccount } from './auth-fixtures.js';
import {
  OPERATOR_A,
  SHARED_BRAND_ASSET,
  TENANT_A,
  UNLINKED_ORGANIZATION,
  USERS,
} from './fixtures.js';
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
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
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

describe('settings and policy texts (editorial workflow §5, P1)', () => {
  /** A's fixture texts: a published privacy policy and a newer draft of it. */
  const PUBLISHED_A = '0190f8c4-0000-7000-8000-000000000501';
  const DRAFT_A = '0190f8c4-0000-7000-8000-000000000502';

  const settingsOfA = async () =>
    (
      await sql<{ days: number; second: boolean }>`
        SELECT report_retention_days AS days, live_edits_need_second_approver AS second
          FROM app.tenants WHERE id = ${TENANT_A}`.execute(owner)
    ).rows[0];

  it("change a tenant's settings as the database allows, and refuse what doesn't fit", async () => {
    const before = await settingsOfA();
    try {
      const url = '/api/t/test-a/settings';
      const days = await send('PATCH', url, USERS.countryAdminA, {
        body: { reportRetentionDays: 90 },
      });
      expect(days.statusCode).toBe(204);
      expect((await settingsOfA())?.days).toBe(90);
      const second = await send('PATCH', url, USERS.countryAdminA, {
        body: { liveEditsNeedSecondApprover: true },
      });
      expect(second.statusCode).toBe(403);
      expect(second.json()).toEqual({ error: 'forbidden' });
      expect(
        (await send('PATCH', url, USERS.editorA, { body: { reportRetentionDays: 7 } })).statusCode,
      ).toBe(403);
      for (const body of [
        {},
        { reportRetentionDays: 0 },
        { reportRetentionDays: 36_501 },
        { reportRetentionDays: 1.5 },
        { theme: {} },
      ]) {
        expect(
          (await send('PATCH', url, USERS.countryAdminA, { body })).statusCode,
          JSON.stringify(body),
        ).toBe(400);
      }
      const platform = await send('PATCH', url, USERS.platformAdmin, {
        body: { liveEditsNeedSecondApprover: true },
      });
      expect(platform.statusCode).toBe(204);
      expect((await settingsOfA())?.second).toBe(true);
    } finally {
      // As the fixture platform admin: the tenant's trigger leaves that setting to platform admins, the owner included.
      await owner.transaction().execute(async (trx) => {
        await sql`SELECT set_config('app.user_id', ${USERS.platformAdmin}, true),
                         set_config('app.aal', '2', true)`.execute(trx);
        await sql`UPDATE app.tenants SET report_retention_days = ${before?.days ?? 365},
                         live_edits_need_second_approver = ${before?.second ?? false}
                   WHERE id = ${TENANT_A}`.execute(trx);
      });
    }
  });

  it('start, save, publish and delete versions of a text, as a country admin', async () => {
    const created: string[] = [];
    try {
      const base = '/api/t/test-a/documents';
      const list = await send('GET', base, USERS.editorA);
      expect(list.json()).toMatchObject({ canEdit: false });
      expect(list.json<{ documents: unknown[] }>().documents).toHaveLength(2);

      // A draft of the privacy policy already exists.
      const blocked = await send('POST', base, USERS.countryAdminA, {
        body: { kind: 'privacy_policy', body: { es: 'Texto de ejemplo' } },
      });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json()).toEqual({ error: 'draftExists' });

      const draft = await send('POST', base, USERS.countryAdminA, {
        body: { kind: 'about_operator', body: { es: 'Sobre la organización de ejemplo' } },
      });
      expect(draft.statusCode).toBe(201);
      const { id } = draft.json<{ id: string }>();
      created.push(id);
      for (const [body, status] of [
        // A language the tenant doesn't enable (A's is Spanish only), and nothing but blanks.
        [{ body: { en: 'Example text' } }, 400],
        [{ body: { es: '  ' } }, 422],
      ] as const) {
        expect(
          (await send('PATCH', `${base}/${id}`, USERS.countryAdminA, { body })).statusCode,
        ).toBe(status);
      }
      const published = await send('PATCH', `${base}/${id}`, USERS.countryAdminA, {
        body: { body: { es: 'Sobre la organización de ejemplo, publicado' }, publish: true },
      });
      expect(published.statusCode).toBe(204);
      const again = await send('PATCH', `${base}/${id}`, USERS.countryAdminA, {
        body: { body: { es: 'Otro texto' } },
      });
      expect(again.statusCode).toBe(409);
      expect((await send('DELETE', `${base}/${id}`, USERS.countryAdminA)).statusCode).toBe(409);
      expect(
        (await send('DELETE', `${base}/${crypto.randomUUID()}`, USERS.countryAdminA)).statusCode,
      ).toBe(404);
      // B's published text, named through A.
      expect(
        (await send('DELETE', `${base}/0190f8c4-0000-7000-8000-000000000503`, USERS.countryAdminA))
          .statusCode,
      ).toBe(404);
      expect((await send('DELETE', `${base}/${id}`, USERS.editorA)).statusCode).toBe(409);

      const second = await send('POST', base, USERS.countryAdminA, {
        body: { kind: 'about_operator', body: { es: 'Segunda versión de ejemplo' } },
      });
      const secondId = second.json<{ id: string }>().id;
      created.push(secondId);
      expect((await send('DELETE', `${base}/${secondId}`, USERS.editorA)).statusCode).toBe(403);
      expect((await send('DELETE', `${base}/${secondId}`, USERS.countryAdminA)).statusCode).toBe(
        204,
      );
    } finally {
      // Everything but A's two fixture texts, whatever a broken build let through.
      await sql`DELETE FROM app.tenant_documents
                 WHERE tenant_id = ${TENANT_A} AND (id = ANY(${created}) OR id NOT IN (${PUBLISHED_A}, ${DRAFT_A}))`.execute(
        owner,
      );
    }
  });
});

describe('the signup list (PLAN R119)', () => {
  it('give country admins and platform admins counts, never addresses, and refuse anyone else', async () => {
    const counts = { unconfirmed: 1, confirmed: 0, futureElections: 0 };
    for (const user of [USERS.countryAdminA, USERS.platformAdmin]) {
      const response = await send('GET', '/api/t/test-a/signups', user);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(counts);
    }
    for (const user of [USERS.editorA, USERS.reviewerA]) {
      expect((await send('GET', '/api/t/test-a/signups', user)).statusCode).toBe(403);
    }
    expect((await send('GET', '/api/t/test-b/signups', USERS.countryAdminA)).statusCode).toBe(404);
  });
});

describe('organizations (editorial workflow P2)', () => {
  const BODY = {
    displayName: { es: 'Organización de ejemplo' },
    legalName: '  Organización de Ejemplo  ',
    taxId: '',
    address: null,
    registryEntry: '   ',
    contactEmail: ' Contacto@Ejemplo.ORG ',
    privacyEmail: null,
    url: 'https://ejemplo.org',
    newsletterUrl: null,
    // A's operator is a PauseAI chapter, and A uses a restricted brand asset, which needs one (P3).
    isPauseaiChapter: true,
  };

  const organization = async (id: string) =>
    (
      await sql<Record<string, unknown>>`
        SELECT display_name, legal_name, tax_id, address, registry_entry, contact_email, privacy_email, url,
               newsletter_url, is_pauseai_chapter
          FROM app.organizations WHERE id = ${id}`.execute(owner)
    ).rows[0];

  it("are for platform admins only: anyone else gets a 404, as for a page they can't open", async () => {
    const listed = await send('GET', '/api/organizations', USERS.platformAdmin);
    expect(listed.statusCode).toBe(200);
    const body = listed.json<{ organizations: { id: string }[]; languages: string[] }>();
    expect(body.organizations.map(({ id }) => id)).toContain(UNLINKED_ORGANIZATION);
    expect(body.languages).toContain('es');
    for (const user of [USERS.countryAdminA, USERS.editorA, USERS.noMembership]) {
      expect((await send('GET', '/api/organizations', user)).statusCode).toBe(404);
      expect((await send('GET', `/api/organizations/${OPERATOR_A}`, user)).statusCode).toBe(404);
      expect(
        (await send('PUT', `/api/organizations/${OPERATOR_A}`, user, { body: BODY })).statusCode,
      ).toBe(404);
      expect((await send('POST', '/api/organizations', user, { body: BODY })).statusCode).toBe(404);
    }
    const one = await send('GET', `/api/organizations/${OPERATOR_A}`, USERS.platformAdmin);
    expect(one.statusCode).toBe(200);
    expect(one.json()).toMatchObject({
      organization: { id: OPERATOR_A, tenants: [{ slug: 'test-a', role: 'operator' }] },
      languages: ['es'],
    });
    expect(
      (
        await send(
          'GET',
          '/api/organizations/0190f8c4-0000-7000-8000-000000000399',
          USERS.platformAdmin,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await send(
          'PUT',
          '/api/organizations/0190f8c4-0000-7000-8000-000000000399',
          USERS.platformAdmin,
          {
            body: BODY,
          },
        )
      ).statusCode,
    ).toBe(404);
  });

  it('change every field at once, trimmed, blank as unset, emails in lowercase', async () => {
    const before = await organization(OPERATOR_A);
    try {
      const url = `/api/organizations/${OPERATOR_A}`;
      expect((await send('PUT', url, USERS.platformAdmin, { body: BODY })).statusCode).toBe(204);
      expect(await organization(OPERATOR_A)).toEqual({
        display_name: { es: 'Organización de ejemplo' },
        legal_name: 'Organización de Ejemplo',
        tax_id: null,
        address: null,
        registry_entry: null,
        contact_email: 'contacto@ejemplo.org',
        privacy_email: null,
        url: 'https://ejemplo.org',
        newsletter_url: null,
        is_pauseai_chapter: true,
      });
      expect(
        (
          await send('PUT', url, USERS.platformAdmin, {
            body: BODY,
            origin: 'https://otro.example',
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await owner
        .updateTable('app.organizations')
        .set({
          display_name: JSON.stringify(before?.display_name),
          legal_name: before?.legal_name as string,
          tax_id: before?.tax_id as string | null,
          address: before?.address as string | null,
          registry_entry: before?.registry_entry as string | null,
          contact_email: before?.contact_email as string | null,
          privacy_email: before?.privacy_email as string | null,
          url: before?.url as string | null,
          newsletter_url: before?.newsletter_url as string | null,
          is_pauseai_chapter: before?.is_pauseai_chapter as boolean,
        })
        .where('id', '=', OPERATOR_A)
        .execute();
    }
  });

  it("refuse what the database or the form's shape refuses, and change nothing", async () => {
    const before = await organization(OPERATOR_A);
    const url = `/api/organizations/${OPERATOR_A}`;
    const put = (body: unknown) => send('PUT', url, USERS.platformAdmin, { body });
    for (const [body, status, constraint] of [
      [{ ...BODY, url: 'http://ejemplo.org' }, 422, 'organizations_url_check'],
      [{ ...BODY, newsletterUrl: 'ejemplo.org' }, 422, 'organizations_newsletter_url_check'],
      [{ ...BODY, contactEmail: 'no es un correo' }, 422, 'organizations_contact_email_check'],
      [{ ...BODY, privacyEmail: 'privacidad@' }, 422, 'organizations_privacy_email_check'],
      [{ ...BODY, legalName: '   ' }, 422, undefined],
      [{ ...BODY, displayName: { es: '  ' } }, 422, undefined],
      [{ ...BODY, displayName: { xx: 'Otra' } }, 400, undefined],
      // A tenant of its uses a restricted brand asset, which only a PauseAI chapter's tenants may.
      [{ ...BODY, isPauseaiChapter: false }, 422, undefined],
      [(({ taxId: _, ...rest }) => rest)(BODY), 400, undefined],
    ] as const) {
      const answer = await put(body);
      expect(answer.statusCode, JSON.stringify(body)).toBe(status);
      if (constraint !== undefined) {
        expect(answer.json()).toMatchObject({ error: 'incomplete', constraint });
      }
    }
    expect(await organization(OPERATOR_A)).toEqual(before);
  });

  it("keep what the form doesn't show: the logo, and a language no site has but the name does", async () => {
    const {
      id: _,
      created_at: __,
      ...before
    } = await owner
      .selectFrom('app.organizations')
      .selectAll()
      .where('id', '=', OPERATOR_A)
      .executeTakeFirstOrThrow();
    try {
      await owner
        .updateTable('app.organizations')
        .set({
          display_name: JSON.stringify({ fr: "Organisation d'exemple" }),
          logo_asset_id: SHARED_BRAND_ASSET,
        })
        .where('id', '=', OPERATOR_A)
        .execute();
      const url = `/api/organizations/${OPERATOR_A}`;
      const shown = await send('GET', url, USERS.platformAdmin);
      expect(shown.json<{ languages: string[] }>().languages).toEqual(['es', 'fr']);
      const body = {
        ...BODY,
        displayName: { fr: "Organisation d'exemple", es: 'Organización de ejemplo' },
      };
      expect((await send('PUT', url, USERS.platformAdmin, { body })).statusCode).toBe(204);
      expect(await organization(OPERATOR_A)).toMatchObject({
        display_name: { fr: "Organisation d'exemple", es: 'Organización de ejemplo' },
      });
      expect(
        (
          await sql<{ logo: string | null }>`
            SELECT logo_asset_id AS logo FROM app.organizations WHERE id = ${OPERATOR_A}`.execute(
            owner,
          )
        ).rows[0]?.logo,
      ).toBe(SHARED_BRAND_ASSET);
      // A new one may only be named in the sites' languages.
      expect(
        (await send('POST', '/api/organizations', USERS.platformAdmin, { body })).statusCode,
      ).toBe(400);
    } finally {
      await owner
        .updateTable('app.organizations')
        .set({ ...before, display_name: JSON.stringify(before.display_name) })
        .where('id', '=', OPERATOR_A)
        .execute();
    }
  });

  it('create one, as a platform admin', async () => {
    const created = await send('POST', '/api/organizations', USERS.platformAdmin, { body: BODY });
    expect(created.statusCode).toBe(201);
    const { id } = created.json<{ id: string }>();
    try {
      expect(await organization(id)).toMatchObject({
        legal_name: 'Organización de Ejemplo',
        contact_email: 'contacto@ejemplo.org',
      });
    } finally {
      await owner.deleteFrom('app.organizations').where('id', '=', id).execute();
    }
  });
});
