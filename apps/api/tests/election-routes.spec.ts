import { createDatabase } from '@aiontheballot/db/client';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminDataRoutes } from '../src/admin/routes.js';
import { ELECTIONS_A, OPERATOR_A, TENANT_A, USERS } from './fixtures.js';
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

/** The routes as the API mounts them, the actor named in a header (the sign-in tests cover sessions). */
const app = Fastify();
void app.register(
  adminDataRoutes({
    admin,
    profiles: async () => new Map(),
    adminOrigin: ORIGIN,
    actorFor: async (request) => {
      const user = request.headers['x-test-user'];
      return typeof user === 'string' ? { userId: user, aal: 2 } : undefined;
    },
  }),
  { prefix: '/api' },
);

const send = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  as: string,
  body?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: {
      'x-test-user': as,
      ...(method === 'GET' ? {} : { origin: ORIGIN }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });

/** Writes here commit: every test puts A's elections back as the fixtures left them, whatever happened. */
const created: string[] = [];
const cleanUp = async () => {
  await owner.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.user_id', ${USERS.platformAdmin}, true), set_config('app.aal', '2', true)`.execute(
      trx,
    );
    await sql`DELETE FROM app.methodology_reviewers WHERE methodology_id IN
                (SELECT id FROM app.methodologies WHERE election_id = ANY(${created}) OR election_id = ${ELECTIONS_A.empty.id})`.execute(
      trx,
    );
    await sql`DELETE FROM app.methodologies WHERE election_id = ANY(${created}) OR election_id = ${ELECTIONS_A.empty.id}`.execute(
      trx,
    );
    await sql`DELETE FROM app.parties WHERE (election_id = ANY(${created}) OR election_id = ${ELECTIONS_A.empty.id})`.execute(
      trx,
    );
    await sql`DELETE FROM app.criteria WHERE (election_id = ANY(${created}) OR election_id = ${ELECTIONS_A.empty.id})`.execute(
      trx,
    );
    await sql`DELETE FROM app.elections
               WHERE id = ANY(${created})
                  OR (tenant_id = ${TENANT_A} AND slug IN ('elecciones-de-ruta', 'elecciones-renombradas'))`.execute(
      trx,
    );
    await sql`UPDATE app.elections SET name = '{"es": "Elecciones de ejemplo municipales-de-ejemplo"}', slug = ${ELECTIONS_A.empty.slug},
                     election_date = NULL, announced = false, require_second_reviewer = true
               WHERE id = ${ELECTIONS_A.empty.id}`.execute(trx);
    await sql`UPDATE app.parties SET display_order = CASE id WHEN ${ELECTIONS_A.draft.parties[0]} THEN 1 ELSE 2 END
               WHERE election_id = ${ELECTIONS_A.draft.id}`.execute(trx);
  });
  created.length = 0;
};

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await admin.destroy();
  await owner.destroy();
});

describe('election routes (editorial workflow §6)', () => {
  it('list, create, read, change and delete an election, with the database deciding', async () => {
    try {
      const list = await send('GET', '/api/t/test-a/elections', USERS.reviewerA);
      expect(list.json()).toMatchObject({ canCreate: false });
      // A's live, draft, archived and empty elections, and the one in preview.
      expect(list.json<{ elections: unknown[] }>().elections).toHaveLength(5);

      const body = {
        slug: 'elecciones-de-ruta',
        type: 'regional',
        territoryCode: 'XA-02',
        name: { es: 'Elecciones de ruta' },
        date: '2030-10-04',
      };
      expect(
        (await send('POST', '/api/t/test-a/elections', USERS.reviewerA, body)).statusCode,
      ).toBe(403);
      const made = await send('POST', '/api/t/test-a/elections', USERS.editorA, body);
      expect(made.statusCode).toBe(201);
      const read = await send('GET', '/api/t/test-a/e/elecciones-de-ruta', USERS.editorA);
      const { election } = read.json<{ election: { id: string } }>();
      created.push(election.id);
      expect(read.json()).toMatchObject({
        election: {
          status: 'draft',
          territoryCode: 'XA-02',
          date: '2030-10-04',
          requireSecondReviewer: true,
        },
        canEdit: true,
        canAdminister: false,
        platformAdmin: false,
      });

      for (const [input, status, error, constraint] of [
        [{ ...body, slug: 'pt-br' }, 422, 'incomplete', 'elections_slug_check'],
        [{ ...body, slug: 'elecciones-de-ruta' }, 409, 'taken', 'elections_tenant_id_slug_key'],
        [
          { ...body, slug: 'otras', name: { en: 'Not a language of the site' } },
          400,
          'invalid',
          undefined,
        ],
        [{ ...body, slug: 'otras', name: { es: ' ' } }, 422, 'incomplete', undefined],
        [{ ...body, slug: 'otras', date: '2030-02-30' }, 400, 'invalid', undefined],
        [{ ...body, slug: 'otras', type: 'national' }, 400, undefined, undefined],
      ] as const) {
        const response = await send('POST', '/api/t/test-a/elections', USERS.editorA, input);
        expect(response.statusCode, JSON.stringify(input)).toBe(status);
        if (error) {
          expect(response.json()).toEqual({ error, ...(constraint ? { constraint } : {}) });
        }
      }

      // The intro (PLAN R217): Markdown per language, stored as typed; blank in every language, none.
      const intro = { es: 'Una introducción de ejemplo.\n\nCon **Markdown**.' };
      expect(
        (await send('PATCH', '/api/t/test-a/e/elecciones-de-ruta', USERS.editorA, { intro }))
          .statusCode,
      ).toBe(200);
      expect(
        (await send('GET', '/api/t/test-a/e/elecciones-de-ruta', USERS.editorA)).json(),
      ).toMatchObject({ election: { intro } });
      expect(
        (
          await send('PATCH', '/api/t/test-a/e/elecciones-de-ruta', USERS.editorA, {
            intro: { en: 'Not a language of the site' },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await send('PATCH', '/api/t/test-a/e/elecciones-de-ruta', USERS.editorA, {
            intro: { es: ' ' },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await send('GET', '/api/t/test-a/e/elecciones-de-ruta', USERS.editorA)).json(),
      ).toMatchObject({ election: { intro: null } });

      const renamed = await send('PATCH', '/api/t/test-a/e/elecciones-de-ruta', USERS.editorA, {
        slug: 'elecciones-renombradas',
        date: null,
      });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json()).toEqual({ slug: 'elecciones-renombradas' });
      const fourEyes = await send(
        'PATCH',
        '/api/t/test-a/e/elecciones-renombradas',
        USERS.countryAdminA,
        { requireSecondReviewer: false },
      );
      expect(fourEyes.statusCode).toBe(403);
      expect(
        (
          await send('PATCH', '/api/t/test-a/e/elecciones-renombradas', USERS.platformAdmin, {
            requireSecondReviewer: false,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await send('PATCH', '/api/t/test-a/e/elecciones-renombradas', USERS.editorA, {}))
          .statusCode,
      ).toBe(400);
      // Only properties the route doesn't know: Fastify drops them, and nothing is left to change.
      expect(
        (
          await send('PATCH', '/api/t/test-a/e/elecciones-renombradas', USERS.editorA, {
            colour: 'red',
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (await send('DELETE', '/api/t/test-a/e/elecciones-renombradas', USERS.editorA)).statusCode,
      ).toBe(403);
      expect(
        (await send('DELETE', '/api/t/test-a/e/elecciones-renombradas', USERS.countryAdminA))
          .statusCode,
      ).toBe(204);
      expect(
        (await send('GET', '/api/t/test-a/e/elecciones-renombradas', USERS.countryAdminA))
          .statusCode,
      ).toBe(404);
      const linked = await send(
        'DELETE',
        `/api/t/test-a/e/${ELECTIONS_A.draft.slug}`,
        USERS.countryAdminA,
      );
      expect(linked.statusCode).toBe(409);
      expect(linked.json()).toMatchObject({ error: 'linked' });
      // Back to draft isn't a status the route takes; nor is a freeze that isn't an instant with its offset.
      for (const body of [
        { status: 'draft' },
        { frozenFrom: 'infinity' },
        { frozenFrom: '30000-01-01T00:00:00Z' },
      ]) {
        expect(
          (
            await send(
              'PATCH',
              `/api/t/test-a/e/${ELECTIONS_A.live.slug}`,
              USERS.countryAdminA,
              body,
            )
          ).statusCode,
          JSON.stringify(body),
        ).toBe(400);
      }
      expect(
        (
          await send(
            'GET',
            `/api/t/test-a/e/${ELECTIONS_A.draft.slug}/checklist`,
            USERS.countryAdminB,
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await send(
            'GET',
            `/api/t/test-a/e/${ELECTIONS_A.draft.slug}/checklist`,
            USERS.countryAdminA,
          )
        ).json(),
      ).toMatchObject({ ready: true });
      const live = await send(
        'PATCH',
        `/api/t/test-a/e/${ELECTIONS_A.live.slug}`,
        USERS.countryAdminA,
        { name: { es: 'Otro nombre' } },
      );
      expect(live.statusCode).toBe(409);
      expect(live.json()).toEqual({ error: 'stale' });
      // Its intro too: once live, it changes through a change request (CR1).
      const liveIntro = await send(
        'PATCH',
        `/api/t/test-a/e/${ELECTIONS_A.live.slug}`,
        USERS.countryAdminA,
        { intro: { es: 'Otra introducción' } },
      );
      expect(liveIntro.statusCode).toBe(409);
      expect(liveIntro.json()).toEqual({ error: 'stale' });
      expect(
        (await send('GET', `/api/t/test-a/e/${ELECTIONS_A.live.slug}`, USERS.countryAdminB))
          .statusCode,
      ).toBe(404);
    } finally {
      await cleanUp();
    }
  });

  it('purge an election for good as a platform admin who types its short name (PLAN R212)', async () => {
    try {
      const body = {
        slug: 'elecciones-de-purga',
        type: 'general',
        territoryCode: null,
        name: { es: 'Elecciones de purga' },
        date: '2030-10-04',
      };
      expect(
        (await send('POST', '/api/t/test-a/elections', USERS.countryAdminA, body)).statusCode,
      ).toBe(201);
      const url = '/api/t/test-a/e/elecciones-de-purga';
      const { election } = (await send('GET', url, USERS.countryAdminA)).json<{
        election: { id: string };
      }>();
      created.push(election.id);
      // Not empty, so the draft's own delete refuses it.
      const party = {
        slug: 'partido-ejemplo-p',
        name: { es: 'Partido Ejemplo P' },
        shortName: { es: 'PEP' },
        colour: null,
        website: null,
        territoryCodes: null,
      };
      expect((await send('POST', `${url}/parties`, USERS.countryAdminA, party)).statusCode).toBe(
        201,
      );
      expect((await send('DELETE', url, USERS.countryAdminA)).statusCode).toBe(409);

      const purge = `${url}/purge`;
      expect(
        (await send('POST', purge, USERS.countryAdminA, { confirmation: 'elecciones-de-purga' }))
          .statusCode,
      ).toBe(403);
      const mistyped = await send('POST', purge, USERS.platformAdmin, {
        confirmation: 'elecciones-de-purg',
      });
      expect(mistyped.statusCode).toBe(400);
      expect(mistyped.json()).toMatchObject({ error: 'invalid' });
      expect((await send('POST', purge, USERS.platformAdmin, {})).statusCode).toBe(400);
      // Another site's page can't send it for a platform admin.
      const elsewhere = await app.inject({
        method: 'POST',
        url: purge,
        headers: {
          'x-test-user': USERS.platformAdmin,
          origin: 'https://otro-sitio.example.test',
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ confirmation: 'elecciones-de-purga' }),
      });
      expect(elsewhere.statusCode).toBe(403);
      expect(
        (await send('POST', purge, USERS.platformAdmin, { confirmation: 'elecciones-de-purga' }))
          .statusCode,
      ).toBe(204);
      expect((await send('GET', url, USERS.platformAdmin)).statusCode).toBe(404);
      const logged = await sql<{ slug: string }>`
        SELECT purged_election_slug AS slug FROM app.purge_log WHERE purged_election_id = ${election.id}`.execute(
        owner,
      );
      expect(logged.rows).toEqual([{ slug: 'elecciones-de-purga' }]);
    } finally {
      await cleanUp();
    }
  });

  it('write a draft election’s methodology and reviewers as a country admin', async () => {
    try {
      const base = `/api/t/test-a/e/${ELECTIONS_A.empty.slug}/methodology`;
      const before = await send('GET', base, USERS.editorA);
      expect(before.json()).toMatchObject({ methodology: null, kind: 'demands', canEdit: false });
      expect(
        before.json<{ demandsOwners: { id: string }[] }>().demandsOwners.map((o) => o.id),
      ).toContain(OPERATOR_A);

      const methodology = {
        demandsOwnerId: OPERATOR_A,
        body: { es: 'Metodología de ejemplo.' },
        admissibleSourceKinds: ['pdf'],
        notMentionedSourceKinds: ['pdf', 'web_page'],
      };
      expect((await send('PUT', base, USERS.editorA, methodology)).statusCode).toBe(403);
      expect(
        (
          await send('POST', `${base}/reviewers`, USERS.countryAdminA, {
            name: 'Persona',
            affiliation: 'Ejemplo',
            displayOrder: 0,
          })
        ).json(),
      ).toEqual({
        error: 'noMethodology',
      });
      expect((await send('PUT', base, USERS.countryAdminA, methodology)).statusCode).toBe(204);
      const empty = await send('PUT', base, USERS.countryAdminA, {
        ...methodology,
        admissibleSourceKinds: [],
      });
      expect(empty.json()).toEqual({ error: 'incomplete', constraint: 'methodologies_check1' });
      expect(
        (
          await send('PUT', base, USERS.countryAdminA, {
            ...methodology,
            admissibleSourceKinds: ['pdf', 'fax'],
          })
        ).statusCode,
      ).toBe(400);

      const reviewer = await send('POST', `${base}/reviewers`, USERS.countryAdminA, {
        name: ' Persona Revisora de Ejemplo ',
        affiliation: 'Universidad de ejemplo',
        displayOrder: 1,
      });
      expect(reviewer.statusCode).toBe(201);
      const { id } = reviewer.json<{ id: string }>();
      expect((await send('GET', base, USERS.countryAdminA)).json()).toMatchObject({
        methodology: { reviewers: [{ id, name: 'Persona Revisora de Ejemplo' }] },
      });
      const blank = await send('POST', `${base}/reviewers`, USERS.countryAdminA, {
        name: '  ',
        affiliation: 'Ejemplo',
        displayOrder: 0,
      });
      expect(blank.statusCode).toBe(422);
      expect(
        (
          await send('PATCH', `${base}/reviewers/${id}`, USERS.countryAdminA, {
            name: 'Persona Revisora',
            affiliation: 'Instituto',
            displayOrder: 2,
          })
        ).statusCode,
      ).toBe(204);
      const read = await send('GET', base, USERS.reviewerA);
      expect(read.json()).toMatchObject({
        methodology: {
          body: { es: 'Metodología de ejemplo.' },
          reviewers: [{ id, name: 'Persona Revisora', affiliation: 'Instituto' }],
        },
      });
      expect((await send('DELETE', base, USERS.countryAdminA)).statusCode).toBe(409);
      expect((await send('DELETE', `${base}/reviewers/${id}`, USERS.editorA)).statusCode).toBe(403);
      expect(
        (await send('DELETE', `${base}/reviewers/${id}`, USERS.countryAdminA)).statusCode,
      ).toBe(204);
      expect((await send('DELETE', base, USERS.countryAdminA)).statusCode).toBe(204);
      expect((await send('DELETE', base, USERS.countryAdminA)).statusCode).toBe(404);
    } finally {
      await cleanUp();
    }
  });

  it('add, change, reorder and delete parties and criteria as an editor', async () => {
    try {
      const parties = `/api/t/test-a/e/${ELECTIONS_A.empty.slug}/parties`;
      const party = {
        slug: 'partido-ejemplo-c',
        name: { es: 'Partido Ejemplo C' },
        shortName: { es: 'PEC' },
        colour: '#ABCDEF',
        website: '',
        territoryCodes: ['xa-01', ' ', 'XA-01'],
      };
      expect((await send('POST', parties, USERS.reviewerA, party)).statusCode).toBe(403);
      const made = await send('POST', parties, USERS.editorA, party);
      expect(made.statusCode).toBe(201);
      const { id } = made.json<{ id: string }>();
      const second = await send('POST', parties, USERS.editorA, {
        ...party,
        slug: 'partido-ejemplo-d',
        territoryCodes: [],
      });
      const secondId = second.json<{ id: string }>().id;
      const listed = (await send('GET', parties, USERS.reviewerA)).json<{
        parties: {
          id: string;
          colour: string;
          website: string | null;
          territoryCodes: string[] | null;
          displayOrder: number;
        }[];
      }>();
      expect(listed.parties).toEqual([
        expect.objectContaining({
          id,
          colour: '#abcdef',
          website: null,
          territoryCodes: ['XA-01'],
          displayOrder: 1,
        }),
        expect.objectContaining({ id: secondId, territoryCodes: null, displayOrder: 2 }),
      ]);
      const taken = await send('PUT', `${parties}/${secondId}`, USERS.editorA, {
        ...party,
        slug: 'partido-ejemplo-c',
      });
      expect(taken.json()).toEqual({ error: 'taken', constraint: 'parties_election_id_slug_key' });
      expect(
        (
          await send('PUT', `${parties}/order`, USERS.editorA, {
            shown: [id, secondId],
            ids: [secondId, id],
          })
        ).statusCode,
      ).toBe(204);
      expect(
        (
          await send('PUT', `${parties}/order`, USERS.editorA, {
            shown: [id, secondId],
            ids: [id, secondId],
          })
        ).json(),
      ).toEqual({ error: 'stale' });
      expect((await send('DELETE', `${parties}/${id}`, USERS.editorA)).statusCode).toBe(204);
      expect((await send('DELETE', `${parties}/${id}`, USERS.editorA)).statusCode).toBe(404);

      const criteria = `/api/t/test-a/e/${ELECTIONS_A.empty.slug}/criteria`;
      const criterion = {
        slug: 'criterio-3',
        title: { es: 'Criterio de ejemplo 3' },
        shortTitle: { es: ' ' },
        description: { es: 'Descripción de ejemplo.' },
        coreCriterionId: null,
      };
      const madeCriterion = await send('POST', criteria, USERS.editorA, criterion);
      expect(madeCriterion.statusCode).toBe(201);
      const read = (await send('GET', criteria, USERS.editorA)).json<{
        criteria: { shortTitle: unknown }[];
        coreCriteria: unknown[];
      }>();
      expect(read.criteria).toEqual([expect.objectContaining({ shortTitle: null })]);
      expect(read.coreCriteria.length).toBeGreaterThan(0);
      expect(
        (
          await send('POST', criteria, USERS.editorA, {
            ...criterion,
            slug: 'criterio-4',
            description: { es: '' },
          })
        ).statusCode,
      ).toBe(422);

      const live = await send(
        'POST',
        `/api/t/test-a/e/${ELECTIONS_A.live.slug}/parties`,
        USERS.editorA,
        { ...party, slug: 'nuevo' },
      );
      expect(live.json()).toEqual({ error: 'stale' });
    } finally {
      await cleanUp();
    }
  });
});
