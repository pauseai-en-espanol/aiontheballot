import type { DB } from '@aiontheballot/db/generated/db';

import { createDatabase } from '@aiontheballot/db/client';
import { createFileStore } from '@aiontheballot/db/file-store';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql, type Transaction } from 'kysely';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminDataRoutes } from '../src/admin/routes.js';
import { ELECTIONS_A, TENANT_A, USERS } from './fixtures.js';
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
let app: FastifyInstance;
let root: string;

/** A live election of the tests' own, so what they approve changes nothing the other tests read. */
const ELECTION = { slug: 'cambios-de-ejemplo', id: '', party: '', criterion: '' };
const METHODOLOGY = { id: '' };
const base = `/api/t/test-a/e/${ELECTION.slug}/changes`;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'changes-'));
  app = Fastify();
  await app.register(
    adminDataRoutes({
      admin,
      files: createFileStore(root),
      adminOrigin: ORIGIN,
      actorFor: async (request) => {
        const user = request.headers['x-test-user'];
        return typeof user === 'string' ? { userId: user, aal: 2 } : undefined;
      },
    }),
    { prefix: '/api' },
  );
  // Built as the owner, as a country admin would, then made live.
  await owner.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.user_id', ${USERS.countryAdminA}, true), set_config('app.aal', '2', true)`.execute(
      trx,
    );
    const operator = await sql<{ id: string }>`
      SELECT organization_id AS id FROM app.tenant_organizations
       WHERE tenant_id = ${TENANT_A} AND role = 'operator'`.execute(trx);
    const election = await sql<{ id: string }>`
      INSERT INTO app.elections (tenant_id, slug, type, name)
      VALUES (${TENANT_A}, ${ELECTION.slug}, 'general', '{"es": "Cambios de ejemplo"}') RETURNING id`.execute(
      trx,
    );
    ELECTION.id = election.rows[0]?.id ?? '';
    const methodology = await sql<{ id: string }>`
      INSERT INTO app.methodologies (tenant_id, election_id, kind, demands_owner_id, body)
      VALUES (${TENANT_A}, ${ELECTION.id}, 'demands', ${operator.rows[0]?.id}, '{"es": "Metodología inventada."}')
      RETURNING id`.execute(trx);
    METHODOLOGY.id = methodology.rows[0]?.id ?? '';
    const party = await sql<{ id: string }>`
      INSERT INTO app.parties (tenant_id, election_id, slug, name, short_name, display_order)
      VALUES (${TENANT_A}, ${ELECTION.id}, 'partido-de-cambios', '{"es": "Partido de cambios"}', '{"es": "PDC"}', 1)
      RETURNING id`.execute(trx);
    ELECTION.party = party.rows[0]?.id ?? '';
    const criterion = await sql<{ id: string }>`
      INSERT INTO app.criteria (tenant_id, election_id, slug, title, short_title, description, display_order)
      VALUES (${TENANT_A}, ${ELECTION.id}, 'criterio-de-cambios', '{"es": "Criterio de cambios"}',
              '{"es": "Cambios"}', '{"es": "Descripción inventada."}', 1)
      RETURNING id`.execute(trx);
    ELECTION.criterion = criterion.rows[0]?.id ?? '';
    await sql`UPDATE app.elections SET status = 'live' WHERE id = ${ELECTION.id}`.execute(trx);
  });
});

afterAll(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
  // Live structure and its public record never change; the owner removes the tests' own, every rule off.
  await owner.transaction().execute(async (trx) => {
    await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    for (const table of [
      'structural_changes',
      'change_requests',
      'parties',
      'criteria',
      'methodologies',
    ]) {
      await sql`DELETE FROM ${sql.table(`app.${table}`)} WHERE election_id = ${ELECTION.id}`.execute(
        trx,
      );
    }
    await sql`DELETE FROM app.elections WHERE id = ${ELECTION.id}`.execute(trx);
  });
  await Promise.all([admin.destroy(), owner.destroy()]);
});

const send = (method: 'GET' | 'POST' | 'DELETE', url: string, as: string, body?: unknown) =>
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

const NOTE = { es: 'Nota pública inventada para el registro de correcciones.' };

const partyName = async () =>
  (
    await sql<{ name: unknown }>`SELECT name FROM app.parties WHERE id = ${ELECTION.party}`.execute(
      owner,
    )
  ).rows[0]?.name;

/** The site's setting, which only a platform admin changes. */
const setSecondApprover = (on: boolean) =>
  owner.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.user_id', ${USERS.platformAdmin}, true), set_config('app.aal', '2', true)`.execute(
      trx,
    );
    await sql`UPDATE app.tenants SET live_edits_need_second_approver = ${on} WHERE id = ${TENANT_A}`.execute(
      trx,
    );
  });

/** As the platform admin, who alone changes a site's settings. */
const asPlatformAdmin = (write: (trx: Transaction<DB>) => Promise<unknown>) =>
  owner.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.user_id', ${USERS.platformAdmin}, true), set_config('app.aal', '2', true)`.execute(
      trx,
    );
    await write(trx);
  });

/** Editor A, a reviewer of the same site as well while `run` runs (ADR-0002 §8: one user, several roles). */
const alsoReviewer = async (run: () => Promise<void>) => {
  await owner.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.user_id', ${USERS.countryAdminA}, true), set_config('app.aal', '2', true)`.execute(
      trx,
    );
    await sql`INSERT INTO app.memberships (tenant_id, user_id, role) VALUES (${TENANT_A}, ${USERS.editorA}, 'reviewer')`.execute(
      trx,
    );
  });
  try {
    await run();
  } finally {
    await owner.transaction().execute(async (trx) => {
      await sql`SET LOCAL session_replication_role = replica`.execute(trx);
      await sql`DELETE FROM app.memberships
                 WHERE tenant_id = ${TENANT_A} AND user_id = ${USERS.editorA} AND role = 'reviewer'`.execute(
        trx,
      );
    });
  }
};

const partyUpdate = (field: string, value: unknown) => ({
  action: 'update',
  targetKind: 'party',
  targetId: ELECTION.party,
  field,
  value,
  publicNote: NOTE,
});

const addition = (targetKind: string, value: Record<string, unknown>) => ({
  action: 'add',
  targetKind,
  targetId: null,
  field: null,
  value,
  publicNote: NOTE,
});

describe('change requests (editorial workflow CR1)', () => {
  it('are proposed by editors and approved by country admins, which applies them and records them publicly', async () => {
    const proposed = await send('POST', base, USERS.editorA, {
      action: 'update',
      targetKind: 'party',
      targetId: ELECTION.party,
      field: 'name',
      value: { es: 'Partido de cambios renombrado' },
      publicNote: NOTE,
    });
    expect(proposed.statusCode).toBe(201);
    const { id } = proposed.json<{ id: string }>();
    const list = await send('GET', base, USERS.reviewerA);
    expect(list.statusCode).toBe(200);
    const body = list.json<{
      changes: {
        id: string;
        state: string;
        previousValue: unknown;
        proposedValue: unknown;
        targetName: unknown;
      }[];
      canPropose: boolean;
      canApprove: boolean;
      canReject: boolean;
    }>();
    expect(body).toMatchObject({ canPropose: false, canApprove: false, canReject: true });
    // The previous value is the database's, never the client's.
    expect(body.changes.find((change) => change.id === id)).toMatchObject({
      state: 'pending',
      previousValue: { es: 'Partido de cambios' },
      proposedValue: { es: 'Partido de cambios renombrado' },
      targetName: { es: 'Partido de cambios' },
    });
    // A reviewer may reject but not approve; an editor may do neither.
    expect(
      (await send('POST', `${base}/${id}/decision`, USERS.reviewerA, { state: 'approved' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await send('POST', `${base}/${id}/decision`, USERS.editorA, { state: 'rejected' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await send('POST', `${base}/${id}/decision`, USERS.countryAdminA, { state: 'approved' }))
        .statusCode,
    ).toBe(204);
    expect(await partyName()).toEqual({ es: 'Partido de cambios renombrado' });
    const { rows } = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM app.structural_changes WHERE change_request_id = ${id}`.execute(
      owner,
    );
    expect(rows).toEqual([{ n: 1 }]);
    // Decided once: never again, and never withdrawn.
    expect(
      (await send('POST', `${base}/${id}/decision`, USERS.countryAdminA, { state: 'rejected' }))
        .statusCode,
    ).toBe(409);
    expect((await send('DELETE', `${base}/${id}`, USERS.editorA)).statusCode).toBe(404);
  });

  it('are proposed and applied at once by a country admin, unless the site needs a second approver', async () => {
    const change = (name: string) => ({
      action: 'update',
      targetKind: 'party',
      targetId: ELECTION.party,
      field: 'short_name',
      value: { es: name },
      publicNote: NOTE,
      apply: true,
    });
    expect((await send('POST', base, USERS.countryAdminA, change('PDC2'))).statusCode).toBe(201);
    // An editor may propose but not approve: asking for both is refused whole.
    expect((await send('POST', base, USERS.editorA, change('PDC4'))).statusCode).toBe(403);
    const editors = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM app.change_requests
       WHERE election_id = ${ELECTION.id} AND proposed_value = '{"es": "PDC4"}'`.execute(owner);
    expect(editors.rows).toEqual([{ n: 0 }]);
    await setSecondApprover(true);
    try {
      const refused = await send('POST', base, USERS.countryAdminA, change('PDC3'));
      expect(refused.statusCode).toBe(403);
      // Refused whole: not even the proposal stays.
      const { rows } = await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM app.change_requests
         WHERE election_id = ${ELECTION.id} AND proposed_value = '{"es": "PDC3"}'`.execute(owner);
      expect(rows).toEqual([{ n: 0 }]);
    } finally {
      await setSecondApprover(false);
    }
  });

  it('add a party at the end of the list, and retire a criterion, once approved', async () => {
    const added = await send('POST', base, USERS.countryAdminA, {
      action: 'add',
      targetKind: 'party',
      targetId: null,
      field: null,
      value: {
        slug: 'partido-nuevo-de-ejemplo',
        name: { es: 'Partido nuevo de ejemplo' },
        short_name: { es: 'PNE' },
      },
      publicNote: NOTE,
      apply: true,
    });
    expect(added.statusCode).toBe(201);
    const { rows } = await sql<{ order: number }>`
      SELECT display_order AS order FROM app.parties
       WHERE election_id = ${ELECTION.id} AND slug = 'partido-nuevo-de-ejemplo'`.execute(owner);
    expect(rows).toEqual([{ order: 2 }]);
    const retired = await send('POST', base, USERS.countryAdminA, {
      action: 'retire',
      targetKind: 'criterion',
      targetId: ELECTION.criterion,
      field: null,
      publicNote: NOTE,
      apply: true,
    });
    expect(retired.statusCode).toBe(201);
    const criterion = await sql<{ retired: boolean }>`
      SELECT retired_at IS NOT NULL AS retired FROM app.criteria WHERE id = ${ELECTION.criterion}`.execute(
      owner,
    );
    expect(criterion.rows).toEqual([{ retired: true }]);
  });

  it('are withdrawn while pending, and refuse what the change rules refuse', async () => {
    const proposed = await send('POST', base, USERS.editorA, {
      action: 'update',
      targetKind: 'party',
      targetId: ELECTION.party,
      field: 'website',
      value: 'https://partido.example',
      publicNote: NOTE,
    });
    const { id } = proposed.json<{ id: string }>();
    expect((await send('DELETE', `${base}/${id}`, USERS.reviewerA)).statusCode).toBe(403);
    expect((await send('DELETE', `${base}/${id}`, USERS.editorA)).statusCode).toBe(204);
    const refusals = await Promise.all([
      // A field that isn't change-controlled, or not of that target.
      send('POST', base, USERS.editorA, {
        action: 'update',
        targetKind: 'party',
        targetId: ELECTION.party,
        field: 'programme_status',
        value: 'published',
        publicNote: NOTE,
      }),
      // A column set when the row is added, never changed (R27).
      send('POST', base, USERS.editorA, partyUpdate('slug', 'otro-partido')),
      // An addition of what is never added.
      send('POST', base, USERS.editorA, {
        action: 'add',
        targetKind: 'election',
        targetId: null,
        field: null,
        value: {},
        publicNote: NOTE,
      }),
      // No public note.
      send('POST', base, USERS.editorA, {
        action: 'retire',
        targetKind: 'party',
        targetId: ELECTION.party,
        field: null,
        publicNote: {},
      }),
      // A note in a language the site doesn't have.
      send('POST', base, USERS.editorA, {
        action: 'retire',
        targetKind: 'party',
        targetId: ELECTION.party,
        field: null,
        publicNote: { fr: 'Note inventée.' },
      }),
      // A reviewer proposes nothing.
      send('POST', base, USERS.reviewerA, {
        action: 'retire',
        targetKind: 'party',
        targetId: ELECTION.party,
        field: null,
        publicNote: NOTE,
      }),
    ]);
    expect(refusals.map((answer) => answer.statusCode)).toEqual([400, 400, 400, 422, 400, 403]);
  });

  it('are approved by country admins only: an editor who is also a reviewer applies nothing', async () => {
    const pending = await send('POST', base, USERS.countryAdminA, partyUpdate('colour', '#123456'));
    expect(pending.statusCode).toBe(201);
    const { id } = pending.json<{ id: string }>();
    await alsoReviewer(async () => {
      expect(
        (
          await send('POST', base, USERS.editorA, {
            ...partyUpdate('colour', '#654321'),
            apply: true,
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await send('POST', `${base}/${id}/decision`, USERS.editorA, { state: 'approved' }))
          .statusCode,
      ).toBe(403);
      // Rejecting stays theirs, as a reviewer's.
      expect(
        (await send('POST', `${base}/${id}/decision`, USERS.editorA, { state: 'rejected' }))
          .statusCode,
      ).toBe(204);
    });
    const { rows } = await sql<{ colour: string | null }>`
      SELECT colour FROM app.parties WHERE id = ${ELECTION.party}`.execute(owner);
    expect(rows).toEqual([{ colour: null }]);
  });

  it('are refused to their own proposer through a decision when the site needs a second approver', async () => {
    const proposed = await send(
      'POST',
      base,
      USERS.countryAdminA,
      partyUpdate('colour', '#abcdef'),
    );
    const { id } = proposed.json<{ id: string }>();
    await setSecondApprover(true);
    try {
      expect(
        (await send('POST', `${base}/${id}/decision`, USERS.countryAdminA, { state: 'approved' }))
          .statusCode,
      ).toBe(403);
    } finally {
      await setSecondApprover(false);
    }
    expect((await send('DELETE', `${base}/${id}`, USERS.countryAdminA)).statusCode).toBe(204);
  });

  it("are another site's members' to read, decide or withdraw only through their own site", async () => {
    const proposed = await send('POST', base, USERS.editorA, partyUpdate('colour', '#a1b2c3'));
    const { id } = proposed.json<{ id: string }>();
    const answers = await Promise.all([
      send('GET', base, USERS.countryAdminB),
      send('POST', `${base}/${id}/decision`, USERS.countryAdminB, { state: 'approved' }),
      send('DELETE', `${base}/${id}`, USERS.countryAdminB),
      // Nor through theirs: the request is found only in its own election.
      send(
        'POST',
        `/api/t/test-b/e/generales-de-ejemplo/changes/${id}/decision`,
        USERS.countryAdminB,
        {
          state: 'approved',
        },
      ),
    ]);
    expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404, 404]);
    expect((await send('DELETE', `${base}/${id}`, USERS.editorA)).statusCode).toBe(204);
  });

  it('add a criterion only with everything a live one has, its short title included', async () => {
    const criterion = {
      slug: 'criterio-nuevo-de-ejemplo',
      title: { es: 'Criterio nuevo de ejemplo' },
      short_title: { es: 'Nuevo' },
      description: { es: 'Descripción inventada.' },
    };
    const { short_title: _, ...withoutShortTitle } = criterion;
    const answers = [
      await send('POST', base, USERS.editorA, addition('criterion', withoutShortTitle)),
      await send(
        'POST',
        base,
        USERS.editorA,
        addition('criterion', { ...criterion, short_title: {} }),
      ),
      await send('POST', base, USERS.countryAdminA, {
        ...addition('criterion', criterion),
        apply: true,
      }),
    ];
    expect(answers.map((answer) => answer.statusCode)).toEqual([422, 422, 201]);
    const { rows } = await sql<{ short_title: unknown }>`
      SELECT short_title FROM app.criteria
       WHERE election_id = ${ELECTION.id} AND slug = 'criterio-nuevo-de-ejemplo'`.execute(owner);
    expect(rows).toEqual([{ short_title: { es: 'Nuevo' } }]);
  });

  it('place additions still waiting after one another', async () => {
    const ids = [];
    for (const slug of ['partido-en-espera-1', 'partido-en-espera-2']) {
      const answer = await send(
        'POST',
        base,
        USERS.editorA,
        addition('party', { slug, name: { es: 'Partido en espera' }, short_name: { es: 'PEE' } }),
      );
      expect(answer.statusCode).toBe(201);
      ids.push(answer.json<{ id: string }>().id);
    }
    const { rows } = await sql<{ order: number }>`
      SELECT (proposed_value ->> 'display_order')::int AS order FROM app.change_requests
       WHERE id IN (${ids[0]}, ${ids[1]}) ORDER BY proposed_at, (proposed_value ->> 'slug')`.execute(
      owner,
    );
    const [first, second] = rows.map((row) => row.order);
    expect(second).toBe((first ?? 0) + 1);
    for (const id of ids) {
      expect((await send('DELETE', `${base}/${id}`, USERS.editorA)).statusCode).toBe(204);
    }
  });

  it('refuse what a draft would refuse, before anyone tries to approve it', async () => {
    const election = (field: string, value: unknown) => ({
      action: 'update',
      targetKind: 'election',
      targetId: ELECTION.id,
      field,
      value,
      publicNote: NOTE,
    });
    const reviewer = (value: Record<string, unknown>) => addition('methodology_reviewer', value);
    const answers = await Promise.all([
      send('POST', base, USERS.countryAdminA, election('election_date', 'infinity')),
      send('POST', base, USERS.countryAdminA, election('election_date', '5874897-12-31')),
      // A live election's intro is reworded, never removed (PLAN R217).
      send('POST', base, USERS.editorA, election('intro', null)),
      send('POST', base, USERS.editorA, partyUpdate('territory_codes', [['XA-M', 'XA-B']])),
      send('POST', base, USERS.editorA, partyUpdate('short_name', { es: 'x'.repeat(61) })),
      send('POST', base, USERS.editorA, partyUpdate('display_order', null)),
      send('POST', base, USERS.editorA, partyUpdate('name', null)),
      send('POST', base, USERS.editorA, partyUpdate('colour', 7)),
      // Its place is the API's to give.
      send(
        'POST',
        base,
        USERS.editorA,
        addition('party', {
          slug: 'partido-con-sitio',
          name: { es: 'Partido con sitio' },
          short_name: { es: 'PCS' },
          display_order: 0,
        }),
      ),
      send(
        'POST',
        base,
        USERS.editorA,
        addition('party', { name: { es: 'Sin slug' }, short_name: { es: 'SS' } }),
      ),
      send(
        'POST',
        base,
        USERS.editorA,
        reviewer({ name: '   ', affiliation: 'Universidad de ejemplo' }),
      ),
      send('POST', base, USERS.editorA, reviewer({ name: 'Persona de ejemplo' })),
      send('POST', base, USERS.editorA, reviewer({ name: 'x'.repeat(201), affiliation: '' })),
    ]);
    expect(answers.map((answer) => answer.statusCode)).toEqual([
      400, 400, 400, 400, 400, 400, 400, 400, 400, 422, 422, 422, 400,
    ]);
    // What the columns' own checks would refuse at approval, refused now, naming the check as the database would.
    const methodology = (field: string, value: unknown) => ({
      action: 'update',
      targetKind: 'methodology',
      targetId: METHODOLOGY.id,
      field,
      value,
      publicNote: NOTE,
    });
    const early = await Promise.all([
      send('POST', base, USERS.editorA, partyUpdate('colour', 'teal')),
      send('POST', base, USERS.editorA, partyUpdate('website', 'ftp://partido.example')),
      send('POST', base, USERS.editorA, partyUpdate('territory_codes', ['XA-1234'])),
      // Outside the site's country.
      send('POST', base, USERS.editorA, partyUpdate('territory_codes', ['XB-M'])),
      send('POST', base, USERS.countryAdminA, methodology('admissible_source_kinds', [])),
    ]);
    expect(
      early.map((answer) => [answer.statusCode, answer.json<{ constraint?: string }>().constraint]),
    ).toEqual([
      [422, 'parties_colour_check'],
      [422, 'parties_website_check'],
      [422, 'parties_territory_codes_check'],
      [422, 'parties_territory_codes_check'],
      [422, 'methodologies_check1'],
    ]);
    const { rows } = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM app.change_requests
       WHERE election_id = ${ELECTION.id} AND state = 'pending'`.execute(owner);
    expect(rows).toEqual([{ n: 0 }]);
    // What a draft takes, a live election takes through a request: a day, territory codes as typed.
    const day = await send(
      'POST',
      base,
      USERS.countryAdminA,
      election('election_date', '2031-05-25'),
    );
    const codes = await send(
      'POST',
      base,
      USERS.editorA,
      partyUpdate('territory_codes', [' xa-m ', 'XA-M']),
    );
    const intro = await send(
      'POST',
      base,
      USERS.editorA,
      election('intro', { es: 'Una introducción de ejemplo, revisada.' }),
    );
    expect([day.statusCode, codes.statusCode, intro.statusCode]).toEqual([201, 201, 201]);
    const stored = await sql<{ value: unknown }>`
      SELECT proposed_value AS value FROM app.change_requests
       WHERE id IN (${day.json<{ id: string }>().id}, ${codes.json<{ id: string }>().id}) ORDER BY field`.execute(
      owner,
    );
    expect(stored.rows).toEqual([{ value: '2031-05-25' }, { value: ['XA-M'] }]);
    for (const answer of [day, codes, intro]) {
      expect(
        (await send('DELETE', `${base}/${answer.json<{ id: string }>().id}`, USERS.countryAdminA))
          .statusCode,
      ).toBe(204);
    }
  });

  it("need the site's default language in the note and every new text, as approving them does", async () => {
    await asPlatformAdmin((trx) =>
      sql`UPDATE app.tenants SET enabled_locales = '{es,en}' WHERE id = ${TENANT_A}`.execute(trx),
    );
    try {
      const answers = await Promise.all([
        send('POST', base, USERS.editorA, {
          ...partyUpdate('name', { es: 'Partido de cambios bis' }),
          publicNote: { en: 'A made-up note.' },
        }),
        send('POST', base, USERS.editorA, partyUpdate('name', { en: 'Changes party' })),
      ]);
      expect(
        answers.map((answer) => [answer.statusCode, answer.json<{ error: string }>().error]),
      ).toEqual([
        [422, 'needsDefaultLanguage'],
        [422, 'needsDefaultLanguage'],
      ]);
    } finally {
      await asPlatformAdmin((trx) =>
        sql`UPDATE app.tenants SET enabled_locales = '{es}' WHERE id = ${TENANT_A}`.execute(trx),
      );
    }
  });

  it('change several fields at once, as one request with one note (PLAN R183)', async () => {
    const values = {
      short_name: { es: 'PDC-B' },
      colour: '#0A1B2C',
      website: 'https://partido.example',
    };
    const proposed = await send('POST', base, USERS.editorA, {
      action: 'update',
      targetKind: 'party',
      targetId: ELECTION.party,
      field: null,
      values,
      publicNote: NOTE,
    });
    expect(proposed.statusCode).toBe(201);
    const { id } = proposed.json<{ id: string }>();
    const list = await send('GET', base, USERS.countryAdminA);
    const change = list
      .json<{
        changes: { id: string; field: unknown; previousValue: unknown; proposedValue: unknown }[];
      }>()
      .changes.find((candidate) => candidate.id === id);
    const before = (
      await sql<{ short_name: unknown; colour: unknown; website: unknown }>`
        SELECT short_name, colour, website FROM app.parties WHERE id = ${ELECTION.party}`.execute(
        owner,
      )
    ).rows[0];
    // The values as the columns store them (the colour in lowercase), and each field's own, read by the database.
    expect(change).toMatchObject({
      field: null,
      previousValue: before,
      proposedValue: { ...values, colour: '#0a1b2c' },
    });
    expect(
      (await send('POST', `${base}/${id}/decision`, USERS.countryAdminA, { state: 'approved' }))
        .statusCode,
    ).toBe(204);
    const { rows } = await sql<{ short_name: unknown; colour: unknown; website: unknown }>`
      SELECT short_name, colour, website FROM app.parties WHERE id = ${ELECTION.party}`.execute(
      owner,
    );
    expect(rows).toEqual([{ ...values, colour: '#0a1b2c' }]);
  });

  it('refuse a set with a field the target never changes, a bad value, or beside a single field', async () => {
    const set = (values: unknown, extra: Record<string, unknown> = {}) => ({
      action: 'update',
      targetKind: 'party',
      targetId: ELECTION.party,
      field: null,
      values,
      publicNote: NOTE,
      ...extra,
    });
    const answers = await Promise.all([
      send('POST', base, USERS.editorA, set({})),
      send('POST', base, USERS.editorA, set({ slug: 'otro-partido' })),
      send('POST', base, USERS.editorA, set({ title: { es: 'Título' } })),
      send('POST', base, USERS.editorA, set({ colour: '#123456' }, { value: '#654321' })),
      send('POST', base, USERS.editorA, set({ colour: '#123456' }, { field: 'colour' })),
      send('POST', base, USERS.editorA, {
        ...addition('party', { slug: 'p' }),
        values: { colour: '#123456' },
      }),
      send('POST', base, USERS.editorA, set({ short_name: { es: 'x'.repeat(61) } })),
      send(
        'POST',
        base,
        USERS.editorA,
        set({ colour: 'teal', website: 'https://partido.example' }),
      ),
      send('POST', base, USERS.reviewerA, set({ colour: '#123456' })),
    ]);
    expect(answers.map((answer) => answer.statusCode)).toEqual([
      400, 400, 400, 400, 400, 400, 400, 422, 403,
    ]);
    expect(answers[7]?.json<{ constraint?: string }>().constraint).toBe('parties_colour_check');
    const { rows } = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM app.change_requests
       WHERE election_id = ${ELECTION.id} AND state = 'pending'`.execute(owner);
    expect(rows).toEqual([{ n: 0 }]);
  });

  it("take a live party's next logo, uploaded first and shown to members, applied once approved", async () => {
    const header = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
    header.writeUInt32BE(13, 8);
    header.write('IHDR', 12, 'latin1');
    header.writeUInt32BE(120, 16);
    header.writeUInt32BE(60, 20);
    const logo = Buffer.concat([header, Buffer.from(`logotipo de ejemplo ${randomUUID()}`)]);
    const upload = (party: string, as: string) =>
      app.inject({
        method: 'PUT',
        url: `/api/t/test-a/e/${ELECTION.slug}/parties/${party}/proposed-logo?filename=logo.png`,
        headers: { 'x-test-user': as, origin: ORIGIN, 'content-type': 'image/png' },
        payload: logo,
      });
    // Not a reviewer's, and not another site's.
    expect((await upload(ELECTION.party, USERS.reviewerA)).statusCode).toBe(403);
    expect((await upload(ELECTION.party, USERS.countryAdminB)).statusCode).toBe(404);
    const uploaded = await upload(ELECTION.party, USERS.editorA);
    expect(uploaded.statusCode).toBe(201);
    const { fileId } = uploaded.json<{ fileId: string }>();
    // Stored, named by nothing: the party keeps its logo until a request is approved.
    const party = async () =>
      (
        await sql<{ logo: string | null }>`
          SELECT logo_file_id AS logo FROM app.parties WHERE id = ${ELECTION.party}`.execute(owner)
      ).rows[0]?.logo;
    expect(await party()).toBeNull();
    const image = (as: string, tenant = 'test-a') =>
      app.inject({
        method: 'GET',
        url: `/api/t/${tenant}/images/${fileId}`,
        headers: { 'x-test-user': as },
      });
    const shown = await image(USERS.reviewerA);
    expect([
      shown.statusCode,
      shown.headers['content-type'],
      shown.headers['x-content-type-options'],
    ]).toEqual([200, 'image/png', 'nosniff']);
    expect(shown.rawPayload).toEqual(logo);
    expect((await image(USERS.countryAdminB)).statusCode).toBe(404);
    expect((await image(USERS.countryAdminB, 'test-b')).statusCode).toBe(404);
    expect((await image(USERS.noMembership)).statusCode).toBe(404);
    // A file of the site's own that isn't a public image (a source's copy) is never served here.
    const source = (
      await sql<{ id: string }>`
        SELECT id FROM app.files WHERE tenant_id = ${TENANT_A} AND bucket = 'sources' LIMIT 1`.execute(
        owner,
      )
    ).rows[0]?.id;
    expect(source).toBeDefined();
    const sourceImage = await app.inject({
      method: 'GET',
      url: `/api/t/test-a/images/${source}`,
      headers: { 'x-test-user': USERS.countryAdminA },
    });
    expect(sourceImage.statusCode).toBe(404);
    const applied = await send('POST', base, USERS.countryAdminA, {
      action: 'update',
      targetKind: 'party',
      targetId: ELECTION.party,
      field: null,
      values: { logo_file_id: fileId },
      publicNote: NOTE,
      apply: true,
    });
    expect(applied.statusCode).toBe(201);
    expect(await party()).toBe(fileId);
    // Only for a live election (a draft's logo is set directly), and never for a retired party.
    const draft = await app.inject({
      method: 'PUT',
      url: `/api/t/test-a/e/${ELECTIONS_A.draft.slug}/parties/${ELECTIONS_A.draft.parties[0]}/proposed-logo`,
      headers: { 'x-test-user': USERS.editorA, origin: ORIGIN, 'content-type': 'image/png' },
      payload: logo,
    });
    expect([draft.statusCode, draft.json<{ error: string }>().error]).toEqual([
      409,
      'changeControlled',
    ]);
    const added = await send('POST', base, USERS.countryAdminA, {
      ...addition('party', {
        slug: 'partido-retirado-de-ejemplo',
        name: { es: 'Partido retirado de ejemplo' },
        short_name: { es: 'PRE' },
      }),
      apply: true,
    });
    expect(added.statusCode).toBe(201);
    const retired = (
      await sql<{ id: string }>`
        SELECT id FROM app.parties
         WHERE election_id = ${ELECTION.id} AND slug = 'partido-retirado-de-ejemplo'`.execute(owner)
    ).rows[0]?.id;
    expect(
      (
        await send('POST', base, USERS.countryAdminA, {
          action: 'retire',
          targetKind: 'party',
          targetId: retired,
          field: null,
          publicNote: NOTE,
          apply: true,
        })
      ).statusCode,
    ).toBe(201);
    expect((await upload(retired ?? '', USERS.editorA)).statusCode).toBe(404);
  });
});
