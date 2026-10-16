import type { DB } from '@aiontheballot/db/generated/db';

import { createDatabase } from '@aiontheballot/db/client';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql, type Transaction } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminDataRoutes } from '../src/admin/routes.js';
import { MAX_LINKS, submitReport } from '../src/reports.js';
import { inRolledBackTransaction } from './db.js';
import { ELECTIONS_A, LIVE_A, LIVE_B, TENANT_A, USERS } from './fixtures.js';

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.`);
  }
  return value;
};

const asPublic = (trx: Transaction<DB>) => sql`SET LOCAL ROLE aiontheballot_web`.execute(trx);

/** A cell of A's live election by its party's and criterion's slugs, read as the owner. */
const slugsOf = async (trx: Transaction<DB>, cell: string) => {
  const { rows } = await sql<{ party: string; criterion: string }>`
    SELECT p.slug AS party, c.slug AS criterion
      FROM app.assessments a JOIN app.parties p ON p.id = a.party_id JOIN app.criteria c ON c.id = a.criterion_id
     WHERE a.id = ${cell}`.execute(trx);
  const [row] = rows;
  if (!row) {
    throw new Error(`No fixture cell ${cell}`);
  }
  return row;
};

const MESSAGE =
  'Un mensaje inventado: la valoración de ejemplo cita una página que no es la del programa.';

describe('the right-of-reply form, as the public (PLAN R149)', () => {
  it('takes a report on an election or a published cell, with what the public can see', async () => {
    await inRolledBackTransaction(async (trx) => {
      const published = await slugsOf(trx, LIVE_A.cells.published);
      const pending = await slugsOf(trx, LIVE_A.cells.draft);
      await asPublic(trx);
      const base = { kind: 'error_report' as const, message: MESSAGE, election: LIVE_A.slug };
      expect(
        await submitReport(trx, 'test-a', {
          ...base,
          ...published,
          name: '  Persona de Ejemplo  ',
          email: ' Persona@Ejemplo.TEST ',
          organization: 'Organización inventada',
          partyRepresentative: true,
        }),
      ).toBe('accepted');
      expect(await submitReport(trx, 'test-a', { ...base, kind: 'party_response' })).toBe(
        'accepted',
      );
      // A cell with no published rating isn't one the public sees: its slugs go into the message.
      expect(await submitReport(trx, 'test-a', { ...base, ...pending })).toBe('accepted');
      await sql`RESET ROLE`.execute(trx);
      const { rows } = await sql<{
        assessment_id: string | null;
        election_id: string;
        name: string | null;
        email: string | null;
        is_party_representative: boolean;
        message: string;
        kind: string;
        status: string;
      }>`SELECT assessment_id, election_id, name, email, is_party_representative, message, kind, status
           FROM app.reports WHERE tenant_id = ${TENANT_A} AND message LIKE ${`%${MESSAGE}`}
          ORDER BY created_at, id`.execute(trx);
      expect(rows).toEqual([
        {
          assessment_id: LIVE_A.cells.published,
          election_id: LIVE_A.id,
          name: 'Persona de Ejemplo',
          email: 'persona@ejemplo.test',
          is_party_representative: true,
          message: MESSAGE,
          kind: 'error_report',
          status: 'new',
        },
        expect.objectContaining({ assessment_id: null, kind: 'party_response', message: MESSAGE }),
        expect.objectContaining({
          assessment_id: null,
          message: `${pending.party} · ${pending.criterion}\n\n${MESSAGE}`,
        }),
      ]);
    });
  });

  it("refuses what isn't public, what it can't take, and a message made of links", async () => {
    await inRolledBackTransaction(async (trx) => {
      const published = await slugsOf(trx, LIVE_A.cells.published);
      await asPublic(trx);
      const base = { kind: 'error_report' as const, message: MESSAGE, election: LIVE_A.slug };
      for (const [outcome, slug, input] of [
        ['not-found', 'no-existe', base],
        ['not-found', 'test-a', { ...base, election: 'no-existe' }],
        // A draft election isn't public: nobody reports on it.
        ['not-found', 'test-a', { ...base, election: ELECTIONS_A.draft.slug }],
        ['not-found', 'test-a', { ...base, party: published.party, criterion: 'no-existe' }],
        ['invalid', 'test-a', { ...base, message: '   ' }],
        ['invalid', 'test-a', { ...base, message: 'x'.repeat(4_801) }],
        ['invalid', 'test-a', { ...base, message: `${MESSAGE}\u0000` }],
        ['invalid', 'test-a', { ...base, email: 'no es una dirección' }],
        ['invalid', 'test-a', { ...base, name: 'x'.repeat(201) }],
        // Characters that change how text shows without being seen: none in a name, no direction overrides.
        ['invalid', 'test-a', { ...base, name: 'Persona\u200Bde ejemplo' }],
        ['invalid', 'test-a', { ...base, organization: 'Organización\u202Einventada' }],
        ['invalid', 'test-a', { ...base, message: `${MESSAGE} \u2066https://ejemplo.test\u2069` }],
        ['invalid', 'test-a', { ...base, party: published.party }],
        ['invalid', 'test-a', { ...base, election: '../otra' }],
        [
          'links',
          'test-a',
          {
            ...base,
            message: Array.from(
              { length: MAX_LINKS + 1 },
              (_, i) => `https://ejemplo.test/${i}`,
            ).join(' '),
          },
        ],
      ] as const) {
        expect(await submitReport(trx, slug, input), JSON.stringify(input)).toBe(outcome);
      }
      // A few links are a party's answer citing its pages.
      expect(
        await submitReport(trx, 'test-a', {
          ...base,
          message: `${MESSAGE} https://ejemplo.test/programa https://ejemplo.test/nota`,
        }),
      ).toBe('accepted');
    });
  });
});

const ORIGIN = 'https://admin.ejemplo.test';
const admin = createDatabase({
  connectionString: env('TEST_ADMIN_DATABASE_URL'),
  maxConnections: 2,
});
const owner = createDatabase({
  connectionString: env('TEST_SUPERUSER_DATABASE_URL'),
  maxConnections: 1,
});
let app: FastifyInstance;
const made: { reports: string[]; changes: string[] } = { reports: [], changes: [] };
/** What the public site's replicas were told changed (R151). */
const revalidated: { tenant: string; election?: string }[] = [];

beforeAll(async () => {
  app = Fastify();
  await app.register(
    adminDataRoutes({
      admin,
      adminOrigin: ORIGIN,
      revalidate: (target) => revalidated.push(target),
      actorFor: async (request) => {
        const user = request.headers['x-test-user'];
        return typeof user === 'string' ? { userId: user, aal: 2 } : undefined;
      },
    }),
    { prefix: '/api' },
  );
});

afterAll(async () => {
  await app.close();
  for (const id of made.changes) {
    await sql`DELETE FROM app.change_requests WHERE id = ${id}`.execute(owner);
  }
  for (const id of made.reports) {
    await sql`DELETE FROM app.reports WHERE id = ${id}`.execute(owner);
  }
  await Promise.all([admin.destroy(), owner.destroy()]);
});

const send = (method: 'GET' | 'POST', url: string, as: string, body?: unknown) =>
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

/** A report as the public's form sends it, through the database's own function. */
const report = async (): Promise<string> => {
  const { rows } = await sql<{ id: string }>`
    SELECT app.submit_report(${TENANT_A}::uuid, 'error_report', ${MESSAGE}, ${LIVE_A.id}::uuid,
                             ${LIVE_A.cells.published}::uuid, 'Persona de Ejemplo', 'persona@ejemplo.test') AS id`.execute(
    owner,
  );
  const id = rows[0]?.id ?? '';
  made.reports.push(id);
  return id;
};

const queue = '/api/t/test-a/reports';

/** A report on site B's live election, as B's public would send it. */
const reportOnB = async (): Promise<string> => {
  const { rows } = await sql<{ id: string }>`
    SELECT app.submit_report(e.tenant_id, 'party_response', ${MESSAGE}, e.id) AS id
      FROM app.elections e WHERE e.id = ${LIVE_B.id}`.execute(owner);
  const id = rows[0]?.id ?? '';
  made.reports.push(id);
  return id;
};

describe('the reports queue (editorial workflow H2)', () => {
  it("shows the site's reports to its members, never to a platform admin or another site", async () => {
    const id = await report();
    const list = await send('GET', queue, USERS.editorA);
    expect(list.statusCode).toBe(200);
    const body = list.json<{
      reports: { id: string; status: string; cell: unknown; excerpt: string }[];
      counts: Record<string, number>;
      canTriage: boolean;
      canAnonymize: boolean;
    }>();
    expect(body.reports.find((r) => r.id === id)).toMatchObject({
      status: 'new',
      cell: { party: expect.any(String), criterion: expect.any(String) },
      excerpt: MESSAGE,
    });
    expect(body.counts.new).toBeGreaterThan(0);
    expect(body).toMatchObject({ canTriage: true, canAnonymize: false });
    expect(
      (await send('GET', `${queue}?status=accepted`, USERS.editorA))
        .json<{ reports: { id: string }[] }>()
        .reports.some((r) => r.id === id),
    ).toBe(false);
    // Platform admins never read reports (PLAN P11); another site's admin can't open the site at all.
    const platform = await send('GET', queue, USERS.platformAdmin);
    expect(platform.json<{ reports: unknown[] }>().reports).toEqual([]);
    expect((await send('GET', `${queue}/${id}`, USERS.platformAdmin)).statusCode).toBe(404);
    expect((await send('GET', queue, USERS.countryAdminB)).statusCode).toBe(404);
    expect((await send('GET', `${queue}?status=nuevo`, USERS.editorA)).statusCode).toBe(400);
  });

  it('moves a report on as the rules allow, with an internal note, and says who triaged it', async () => {
    const id = await report();
    const move = (as: string, status: string, resolutionNote?: string) =>
      send('POST', `${queue}/${id}/status`, as, {
        status,
        ...(resolutionNote ? { resolutionNote } : {}),
      });
    // Triaged, then decided: two steps the rules allow (R16).
    expect((await move(USERS.reviewerA, 'triaged')).statusCode).toBe(204);
    expect(
      (await move(USERS.editorA, 'accepted', '  Corregido en la revisión siguiente.  ')).statusCode,
    ).toBe(204);
    expect((await move(USERS.editorA, 'spam')).statusCode).toBe(409);
    const detail = await send('GET', `${queue}/${id}`, USERS.reviewerA);
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ report: Record<string, unknown> }>().report).toMatchObject({
      status: 'accepted',
      triagedBy: USERS.reviewerA,
      resolutionNote: 'Corregido en la revisión siguiente.',
      name: 'Persona de Ejemplo',
      email: 'persona@ejemplo.test',
      message: MESSAGE,
    });
    // A write needs the admin's origin, like every other.
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${queue}/${id}/status`,
          headers: { 'x-test-user': USERS.editorA, 'content-type': 'application/json' },
          payload: JSON.stringify({ status: 'rejected' }),
        })
      ).statusCode,
    ).toBe(403);
  });

  it('decides a new report at once, triaging it first in the same step, as the rules allow (admin forms §2)', async () => {
    const id = await report();
    expect(
      (await send('POST', `${queue}/${id}/status`, USERS.reviewerA, { status: 'rejected' }))
        .statusCode,
    ).toBe(204);
    const detail = await send('GET', `${queue}/${id}`, USERS.reviewerA);
    expect(detail.json<{ report: Record<string, unknown> }>().report).toMatchObject({
      status: 'rejected',
      triagedBy: USERS.reviewerA,
    });
    // A decided report stays decided.
    expect(
      (await send('POST', `${queue}/${id}/status`, USERS.reviewerA, { status: 'spam' })).statusCode,
    ).toBe(409);
  });

  it("keeps a member of two sites to each site's own reports, under each site's address", async () => {
    const own = await report();
    const elsewhere = await reportOnB();
    // Editor in A, reviewer in B: both sites' reports are theirs to read, each under its own site.
    const listed = (await send('GET', queue, USERS.editorAReviewerB))
      .json<{ reports: { id: string }[] }>()
      .reports.map((r) => r.id);
    expect(listed).toContain(own);
    expect(listed).not.toContain(elsewhere);
    expect((await send('GET', `${queue}/${elsewhere}`, USERS.editorAReviewerB)).statusCode).toBe(
      404,
    );
    expect(
      (
        await send('POST', `${queue}/${elsewhere}/status`, USERS.editorAReviewerB, {
          status: 'triaged',
        })
      ).statusCode,
    ).toBe(404);
    const { rows } = await sql<{
      status: string;
    }>`SELECT status FROM app.reports WHERE id = ${elsewhere}`.execute(owner);
    expect(rows).toEqual([{ status: 'new' }]);
  });

  it('removes every personal field on request, for country admins only', async () => {
    const id = await report();
    expect((await send('POST', `${queue}/${id}/anonymize`, USERS.editorA)).statusCode).toBe(403);
    expect((await send('POST', `${queue}/${id}/anonymize`, USERS.countryAdminA)).statusCode).toBe(
      204,
    );
    const { report: detail } = (await send('GET', `${queue}/${id}`, USERS.editorA)).json<{
      report: Record<string, unknown>;
    }>();
    expect(detail).toMatchObject({
      anonymized: true,
      name: null,
      email: null,
      organization: null,
      message: null,
      excerpt: null,
    });
    // It still moves on, by its status alone: a note would be personal data again.
    expect(
      (await send('POST', `${queue}/${id}/status`, USERS.reviewerA, { status: 'triaged' }))
        .statusCode,
    ).toBe(204);
    expect(
      (
        await send('POST', `${queue}/${id}/status`, USERS.reviewerA, {
          status: 'rejected',
          resolutionNote: 'Una nota inventada.',
        })
      ).statusCode,
    ).toBe(409);
  });

  it("lists the change requests a report prompted (CR1.8), and refuses a report the proposer can't see", async () => {
    const id = await report();
    const changes = `/api/t/test-a/e/${LIVE_A.slug}/changes`;
    const proposal = {
      action: 'update',
      targetKind: 'election',
      targetId: LIVE_A.id,
      field: 'name',
      value: { es: 'Generales de ejemplo, nombre corregido' },
      publicNote: { es: 'Una nota pública inventada sobre el cambio de nombre.' },
    };
    const proposed = await send('POST', changes, USERS.editorA, { ...proposal, reportId: id });
    expect(proposed.statusCode).toBe(201);
    made.changes.push(proposed.json<{ id: string }>().id);
    const { report: detail } = (await send('GET', `${queue}/${id}`, USERS.editorA)).json<{
      report: { changeRequests: { id: string; state: string }[] };
    }>();
    expect(detail.changeRequests).toEqual([
      expect.objectContaining({
        id: proposed.json<{ id: string }>().id,
        state: 'pending',
        election: LIVE_A.slug,
      }),
    ]);
    // A made-up id is refused before anything is written; so is another site's report, even to a member of both
    // sites, who can read it: it must be the election's own site's.
    expect(
      (
        await send('POST', changes, USERS.editorA, {
          ...proposal,
          reportId: '0190f8c4-0000-7000-8000-00000000ffff',
        })
      ).statusCode,
    ).toBe(404);
    const elsewhere = await reportOnB();
    expect(
      (await send('POST', changes, USERS.editorAReviewerB, { ...proposal, reportId: elsewhere }))
        .statusCode,
    ).toBe(404);
  });

  it('tell the public site what a write changed, never after a read or a refusal (R151)', async () => {
    const id = await report();
    // A refusal tells it nothing: a decided report can't go back.
    const decided = await report();
    await send('POST', `${queue}/${decided}/status`, USERS.reviewerA, { status: 'spam' });
    revalidated.length = 0;
    await send('GET', `${queue}/${id}`, USERS.editorA);
    expect(
      (await send('POST', `${queue}/${decided}/status`, USERS.reviewerA, { status: 'accepted' }))
        .statusCode,
    ).toBe(409);
    expect(revalidated).toEqual([]);
    expect(
      (await send('POST', `${queue}/${id}/status`, USERS.reviewerA, { status: 'triaged' }))
        .statusCode,
    ).toBe(204);
    expect(revalidated).toEqual([{ tenant: 'test-a' }]);
    revalidated.length = 0;
    const proposed = await send('POST', `/api/t/test-a/e/${LIVE_A.slug}/changes`, USERS.editorA, {
      action: 'update',
      targetKind: 'election',
      targetId: LIVE_A.id,
      field: 'name',
      value: { es: 'Generales de ejemplo, otro nombre' },
      publicNote: { es: 'Una nota pública inventada.' },
    });
    expect(proposed.statusCode).toBe(201);
    made.changes.push(proposed.json<{ id: string }>().id);
    expect(revalidated).toEqual([{ tenant: 'test-a', election: LIVE_A.slug }]);
  });
});
