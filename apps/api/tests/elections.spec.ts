import type { DB } from '@aiontheballot/db/generated/db';

import { withActor } from '@aiontheballot/db/actor';
import { createDatabase } from '@aiontheballot/db/client';
import { sql, type Transaction } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';

import {
  createElection,
  deleteElection,
  getElection,
  listElections,
  updateElection,
} from '../src/admin/elections.js';
import {
  addReviewer,
  deleteMethodology,
  deleteReviewer,
  getMethodology,
  listDemandsOwners,
  saveMethodology,
  updateReviewer,
} from '../src/admin/methodology.js';
import {
  createCriterion,
  createParty,
  deleteFrom,
  listCoreCriteria,
  listCriteria,
  listParties,
  reorder,
  updateCriterion,
  updateParty,
} from '../src/admin/structure.js';
import { inRolledBackTransaction } from './db.js';
import { ELECTIONS_A, OPERATOR_A, TENANT_A, USERS } from './fixtures.js';

/** As `userId` through the admin role, the way withActor sets it. */
const actAs = async (trx: Transaction<DB>, userId: string, aal: 1 | 2 = 2) => {
  await sql`SET LOCAL ROLE aiontheballot_admin`.execute(trx);
  await sql`SELECT set_config('app.user_id', ${userId}, true), set_config('app.aal', ${String(aal)}, true)`.execute(
    trx,
  );
};

const as = <T>(userId: string, fn: (trx: Transaction<DB>) => Promise<T>) =>
  inRolledBackTransaction(async (trx) => {
    await actAs(trx, userId);
    return fn(trx);
  });

/** The SQLSTATE and constraint a write is refused with, or 'ok'. */
const refusal = async (write: Promise<unknown>) => {
  try {
    await write;
    return 'ok';
  } catch (error) {
    const { code, constraint } = error as { code?: string; constraint?: string };
    return constraint ? `${code} ${constraint}` : code;
  }
};

const fields = (slug: string, more: object = {}) => ({
  slug,
  type: 'other' as const,
  territoryCode: null,
  name: { es: 'Elecciones de ejemplo' },
  date: '2030-05-26',
  ...more,
});

describe('elections (editorial workflow E1)', () => {
  it('list the tenant’s elections for every member, soonest first and those without a date last', async () => {
    const elections = await as(USERS.editorA, async (trx) => {
      await createElection(trx, TENANT_A, fields('mas-tarde', { date: '2031-06-01' }));
      await createElection(trx, TENANT_A, fields('antes', { date: '2030-03-01' }));
      await actAs(trx, USERS.reviewerA);
      return listElections(trx, TENANT_A);
    });
    expect(elections.map((e) => e.slug).slice(0, 2)).toEqual(['antes', 'mas-tarde']);
    expect(
      elections
        .slice(2)
        .map((e) => e.slug)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(
      Object.values(ELECTIONS_A)
        .map((e) => e.slug)
        .sort((a, b) => a.localeCompare(b)),
    );
    expect(elections.slice(2).every((e) => e.date === null)).toBe(true);
    expect(await as(USERS.countryAdminB, (trx) => listElections(trx, TENANT_A))).toEqual([]);
  });

  it('give an election with its structure counted, and the date as the day it is', async () => {
    const draft = await as(USERS.editorA, (trx) =>
      getElection(trx, TENANT_A, ELECTIONS_A.draft.slug),
    );
    expect(draft).toMatchObject({
      id: ELECTIONS_A.draft.id,
      status: 'draft',
      type: 'regional',
      territoryCode: 'XA-01',
      announced: true,
      requireSecondReviewer: true,
      counts: { parties: 2, criteria: 2, reviewers: 1 },
      hasMethodology: true,
    });
    const empty = await as(USERS.editorA, (trx) =>
      getElection(trx, TENANT_A, ELECTIONS_A.empty.slug),
    );
    expect(empty).toMatchObject({
      counts: { parties: 0, criteria: 0, reviewers: 0 },
      hasMethodology: false,
    });
    const created = await as(USERS.editorA, async (trx) => {
      await createElection(trx, TENANT_A, fields('elecciones-con-fecha'));
      return getElection(trx, TENANT_A, 'elecciones-con-fecha');
    });
    expect(created?.date).toBe('2030-05-26');
  });

  it('are created by editors as drafts, unannounced, with four-eyes on and no freeze window', async () => {
    const created = await as(USERS.editorA, async (trx) => {
      await createElection(trx, TENANT_A, fields('elecciones-nuevas'));
      return getElection(trx, TENANT_A, 'elecciones-nuevas');
    });
    expect(created).toMatchObject({
      status: 'draft',
      announced: false,
      requireSecondReviewer: true,
      frozenFrom: null,
      frozenUntil: null,
    });
    expect(
      await refusal(as(USERS.reviewerA, (trx) => createElection(trx, TENANT_A, fields('otras')))),
    ).toBe('42501');
  });

  it.each([
    ['a slug already taken', fields(ELECTIONS_A.live.slug), '23505 elections_tenant_id_slug_key'],
    ['a locale-shaped slug', fields('pt-br'), '23514 elections_slug_check'],
    ['a reserved slug', fields('brand'), '23514 elections_slug_not_reserved'],
    ['a malformed slug', fields('Elecciones 2030'), '23514 slug_check'],
    ['a slug of 64 characters', fields('a'.repeat(64)), '23514 slug_length'],
    [
      'a regional election without its territory',
      fields('regionales', { type: 'regional' }),
      '23514 elections_check1',
    ],
    [
      'a general election with a territory',
      fields('generales', { type: 'general', territoryCode: 'XA-01' }),
      '23514 elections_check',
    ],
    [
      // The trigger checks the country first, so its refusal names no constraint.
      'a malformed territory',
      fields('regionales', { type: 'regional', territoryCode: 'XA01' }),
      '23514',
    ],
    [
      'a territory of another country',
      fields('regionales', { type: 'regional', territoryCode: 'XB-01' }),
      '23514',
    ],
    ['no name at all', fields('sin-nombre', { name: {} }), '23514 localized_check'],
    ['a date that does not exist', fields('fecha-imposible', { date: '2030-02-30' }), '22008'],
  ])('refuse %s, naming what refused it', async (_name, input, expected) => {
    expect(await refusal(as(USERS.editorA, (trx) => createElection(trx, TENANT_A, input)))).toBe(
      expected,
    );
  });

  it('let editors change a draft, country admins announce it and only platform admins turn four-eyes off', async () => {
    const id = ELECTIONS_A.empty.id;
    expect(
      await as(USERS.editorA, (trx) =>
        updateElection(trx, TENANT_A, id, {
          name: { es: 'Municipales cambiadas' },
          date: null,
          slug: 'municipales-2',
        }),
      ),
    ).toBe('changed');
    expect(
      await refusal(
        as(USERS.editorA, (trx) => updateElection(trx, TENANT_A, id, { announced: true })),
      ),
    ).toBe('42501');
    expect(
      await as(USERS.countryAdminA, (trx) =>
        updateElection(trx, TENANT_A, id, { announced: true }),
      ),
    ).toBe('changed');
    for (const userId of [USERS.editorA, USERS.countryAdminA]) {
      expect(
        await refusal(
          as(userId, (trx) => updateElection(trx, TENANT_A, id, { requireSecondReviewer: false })),
        ),
      ).toBe('42501');
    }
    const audited = await as(USERS.platformAdmin, async (trx) => {
      expect(await updateElection(trx, TENANT_A, id, { requireSecondReviewer: false })).toBe(
        'changed',
      );
      await sql`RESET ROLE`.execute(trx);
      const { rows } = await sql<{ diff: unknown }>`
        SELECT diff FROM app.audit_log WHERE table_name = 'elections' AND row_id = ${id} ORDER BY id DESC LIMIT 1`.execute(
        trx,
      );
      return rows[0]?.diff;
    });
    expect(audited).toMatchObject({ new: { require_second_reviewer: false } });
    expect(
      await as(USERS.reviewerA, (trx) => updateElection(trx, TENANT_A, id, { date: null })),
    ).toBe('forbidden');
  });

  it('fix a live election: its slug, type and territory, and its name and date without a change request', async () => {
    for (const change of [
      { slug: 'otras-generales' },
      { name: { es: 'Otro nombre' } },
      { date: '2031-01-01' },
    ]) {
      expect(
        await refusal(
          as(USERS.countryAdminA, (trx) =>
            updateElection(trx, TENANT_A, ELECTIONS_A.live.id, change),
          ),
        ),
        JSON.stringify(change),
      ).toBe('23001');
    }
    expect(
      await refusal(
        as(USERS.countryAdminA, (trx) =>
          updateElection(trx, TENANT_A, ELECTIONS_A.archived.id, { date: null }),
        ),
      ),
    ).toBe('23001');
  });

  it('are deleted only as drafts, by country admins, once nothing refers to them', async () => {
    expect(
      await as(USERS.editorA, (trx) => deleteElection(trx, TENANT_A, ELECTIONS_A.empty.id)),
    ).toBe('forbidden');
    expect(
      await as(USERS.countryAdminA, (trx) => deleteElection(trx, TENANT_A, ELECTIONS_A.live.id)),
    ).toBe('forbidden');
    expect(
      await refusal(
        as(USERS.countryAdminA, (trx) => deleteElection(trx, TENANT_A, ELECTIONS_A.draft.id)),
      ),
    ).toMatch(/^23503/);
    expect(
      await as(USERS.countryAdminA, (trx) => deleteElection(trx, TENANT_A, ELECTIONS_A.empty.id)),
    ).toBe('changed');
  });
});

describe('parties and criteria (editorial workflow E4)', () => {
  const party = (slug: string) => ({
    slug,
    name: { es: 'Partido Ejemplo C' },
    shortName: { es: 'PEC' },
    colour: '#123abc',
    website: 'https://partido-c.example',
    territoryCodes: null,
  });
  const criterion = (slug: string) => ({
    slug,
    title: { es: 'Criterio de ejemplo 3' },
    shortTitle: { es: 'Ejemplo 3' },
    description: { es: 'Descripción de ejemplo.' },
    coreCriterionId: null,
  });

  it('are read in display order by every member', async () => {
    const { parties, criteria } = await as(USERS.reviewerA, async (trx) => ({
      parties: await listParties(trx, ELECTIONS_A.draft.id),
      criteria: await listCriteria(trx, ELECTIONS_A.draft.id),
    }));
    expect(parties.map((p) => p.id)).toEqual(ELECTIONS_A.draft.parties);
    expect(criteria.map((c) => c.id)).toEqual(ELECTIONS_A.draft.criteria);
  });

  it('are added at the end, changed and deleted by editors in a draft election', async () => {
    const result = await as(USERS.editorA, async (trx) => {
      const added = await createParty(
        trx,
        TENANT_A,
        ELECTIONS_A.draft.id,
        party('partido-ejemplo-c'),
      );
      const addedCriterion = await createCriterion(
        trx,
        TENANT_A,
        ELECTIONS_A.draft.id,
        criterion('criterio-3'),
      );
      const parties = await listParties(trx, ELECTIONS_A.draft.id);
      const changed = await updateParty(trx, ELECTIONS_A.draft.id, added.id, {
        ...party('partido-ejemplo-c'),
        territoryCodes: ['XA-01'],
      });
      const changedCriterion = await updateCriterion(trx, ELECTIONS_A.draft.id, addedCriterion.id, {
        ...criterion('criterio-3'),
        shortTitle: null,
      });
      const deleted = await deleteFrom(trx, 'app.parties', ELECTIONS_A.draft.id, added.id);
      return { last: parties.at(-1), changed, changedCriterion, deleted };
    });
    expect(result.last).toMatchObject({
      slug: 'partido-ejemplo-c',
      displayOrder: 3,
      colour: '#123abc',
    });
    expect(result).toMatchObject({
      changed: 'changed',
      changedCriterion: 'changed',
      deleted: 'changed',
    });
  });

  it('refuse a reviewer, another election’s rows and a live election’s', async () => {
    expect(
      await refusal(
        as(USERS.reviewerA, (trx) => createParty(trx, TENANT_A, ELECTIONS_A.draft.id, party('x'))),
      ),
    ).toBe('42501');
    expect(
      await as(USERS.reviewerA, (trx) =>
        updateParty(trx, ELECTIONS_A.draft.id, ELECTIONS_A.draft.parties[0] ?? '', party('x')),
      ),
    ).toBe('forbidden');
    // A party of the live election, named through the draft one.
    expect(
      await as(USERS.editorA, (trx) =>
        deleteFrom(trx, 'app.parties', ELECTIONS_A.draft.id, ELECTIONS_A.live.parties[0] ?? ''),
      ),
    ).toBe('not-found');
    expect(
      await refusal(
        as(USERS.editorA, (trx) => createParty(trx, TENANT_A, ELECTIONS_A.live.id, party('nuevo'))),
      ),
    ).toBe('23001');
    expect(
      await as(USERS.editorA, (trx) =>
        deleteFrom(trx, 'app.parties', ELECTIONS_A.live.id, ELECTIONS_A.live.parties[0] ?? ''),
      ),
    ).toBe('forbidden');
  });

  it.each([
    ['a party territory of another country', { territoryCodes: ['XB-01'] }, '23514'],
    ['a colour that is not #rrggbb', { colour: 'red' }, '23514 parties_colour_check'],
    [
      'a website that is not http(s)',
      { website: 'ftp://partido.example' },
      '23514 parties_website_check',
    ],
    [
      'a slug the election already has',
      { slug: 'partido-ejemplo-b' },
      '23505 parties_election_id_slug_key',
    ],
  ])('refuse %s', async (_name, change, expected) => {
    expect(
      await refusal(
        as(USERS.editorA, (trx) =>
          updateParty(trx, ELECTIONS_A.draft.id, ELECTIONS_A.draft.parties[0] ?? '', {
            ...party('partido-ejemplo-a'),
            ...change,
          }),
        ),
      ),
    ).toBe(expected);
  });

  it('reorder a whole list still in the order shown, and refuse anything else', async () => {
    const [first = '', second = ''] = ELECTIONS_A.draft.parties;
    const id = ELECTIONS_A.draft.id;
    const result = await as(USERS.editorA, async (trx) => ({
      done: await reorder(trx, 'app.parties', id, [first, second], [second, first]),
      order: (await listParties(trx, id)).map((p) => p.id),
      // The page still shows the old order: someone moved them meanwhile.
      moved: await reorder(trx, 'app.parties', id, [first, second], [first, second]),
      partial: await reorder(trx, 'app.parties', id, [second, first], [second]),
      repeated: await reorder(trx, 'app.parties', id, [second, first], [second, second]),
      foreign: await reorder(
        trx,
        'app.parties',
        id,
        [second, first],
        [second, ELECTIONS_A.live.parties[0] ?? ''],
      ),
    }));
    expect(result).toEqual({
      done: 'changed',
      order: [second, first],
      moved: 'stale',
      partial: 'stale',
      repeated: 'stale',
      foreign: 'stale',
    });
    // A reviewer can't lock the list to move it.
    expect(
      await as(USERS.reviewerA, (trx) =>
        reorder(trx, 'app.parties', id, [first, second], [second, first]),
      ),
    ).toBe('forbidden');
    const live = [...ELECTIONS_A.live.criteria];
    expect(
      await refusal(
        as(USERS.editorA, (trx) =>
          reorder(trx, 'app.criteria', ELECTIONS_A.live.id, live, [...live].reverse()),
        ),
      ),
    ).toBe('23001');
  });

  it('offer every core criterion to members', async () => {
    expect((await as(USERS.editorA, (trx) => listCoreCriteria(trx))).length).toBeGreaterThan(0);
  });
});

describe('the methodology and its external reviewers (editorial workflow E2, E3)', () => {
  const methodology = {
    demandsOwnerId: OPERATOR_A,
    body: { es: 'Metodología de ejemplo.' },
    admissibleSourceKinds: ['pdf' as const],
    notMentionedSourceKinds: ['pdf' as const, 'web_page' as const],
  };

  it('is read with its reviewers and how its source kinds are used', async () => {
    const read = await as(USERS.reviewerA, (trx) => getMethodology(trx, ELECTIONS_A.live.id));
    expect(read).toMatchObject({
      id: ELECTIONS_A.live.methodology,
      kind: 'demands',
      demandsOwnerId: OPERATOR_A,
      admissibleSourceKinds: expect.arrayContaining(['pdf']),
      reviewers: [expect.objectContaining({ id: ELECTIONS_A.live.reviewer })],
    });
    expect(read?.usage.pdf?.quotes).toBeGreaterThan(0);
    expect(
      await as(USERS.reviewerA, (trx) => getMethodology(trx, ELECTIONS_A.empty.id)),
    ).toBeNull();
    expect(
      (await as(USERS.editorA, (trx) => listDemandsOwners(trx, TENANT_A))).map((o) => o.id),
    ).toContain(OPERATOR_A);
  });

  it('is written by country admins only, in the tenant’s kind, naming the operator or an endorser', async () => {
    const tenant = { id: TENANT_A, methodologyKind: 'demands' as const };
    const saved = await as(USERS.countryAdminA, async (trx) => {
      expect(await saveMethodology(trx, tenant, ELECTIONS_A.empty.id, methodology)).toBe('changed');
      expect(
        await saveMethodology(trx, tenant, ELECTIONS_A.empty.id, {
          ...methodology,
          body: { es: 'Cambiada.' },
        }),
      ).toBe('changed');
      return getMethodology(trx, ELECTIONS_A.empty.id);
    });
    expect(saved).toMatchObject({ body: { es: 'Cambiada.' }, admissibleSourceKinds: ['pdf'] });
    expect(
      await refusal(
        as(USERS.editorA, (trx) => saveMethodology(trx, tenant, ELECTIONS_A.empty.id, methodology)),
      ),
    ).toBe('42501');
    expect(
      await refusal(
        as(USERS.countryAdminA, (trx) =>
          saveMethodology(trx, tenant, ELECTIONS_A.empty.id, {
            ...methodology,
            demandsOwnerId: null,
          }),
        ),
      ),
    ).toBe('23514 methodologies_check');
    expect(
      await refusal(
        as(USERS.countryAdminA, (trx) =>
          saveMethodology(trx, tenant, ELECTIONS_A.empty.id, {
            ...methodology,
            admissibleSourceKinds: [],
          }),
        ),
      ),
    ).toBe('23514 methodologies_check1');
    expect(
      await refusal(
        as(USERS.countryAdminA, (trx) =>
          saveMethodology(
            trx,
            { ...tenant, methodologyKind: 'descriptive' },
            ELECTIONS_A.empty.id,
            {
              ...methodology,
              demandsOwnerId: null,
            },
          ),
        ),
      ),
    ).toBe('23514');
    expect(
      await refusal(
        as(USERS.countryAdminA, (trx) =>
          saveMethodology(trx, tenant, ELECTIONS_A.live.id, methodology),
        ),
      ),
    ).toBe('23001');
  });

  it('has its reviewers added, changed and deleted by country admins in a draft', async () => {
    const result = await as(USERS.countryAdminA, async (trx) => {
      const added = await addReviewer(trx, TENANT_A, ELECTIONS_A.draft.methodology, {
        name: 'Persona Revisora de Ejemplo',
        affiliation: 'Universidad de ejemplo',
        displayOrder: 2,
      });
      const changed = await updateReviewer(trx, ELECTIONS_A.draft.methodology, added.id, {
        name: 'Persona Revisora de Ejemplo',
        affiliation: 'Instituto de ejemplo',
        displayOrder: 1,
      });
      const deleted = await deleteReviewer(
        trx,
        ELECTIONS_A.draft.methodology,
        ELECTIONS_A.draft.reviewer,
      );
      return {
        changed,
        deleted,
        reviewers: (await getMethodology(trx, ELECTIONS_A.draft.id))?.reviewers,
      };
    });
    expect(result).toMatchObject({ changed: 'changed', deleted: 'changed' });
    expect(result.reviewers).toEqual([
      expect.objectContaining({ affiliation: 'Instituto de ejemplo' }),
    ]);
    expect(
      await as(USERS.editorA, (trx) =>
        deleteReviewer(trx, ELECTIONS_A.draft.methodology, ELECTIONS_A.draft.reviewer),
      ),
    ).toBe('forbidden');
    expect(
      await as(USERS.countryAdminA, (trx) =>
        deleteReviewer(trx, ELECTIONS_A.live.methodology, ELECTIONS_A.live.reviewer),
      ),
    ).toBe('forbidden');
  });

  it('is deleted in a draft once its reviewers are gone', async () => {
    expect(
      await refusal(as(USERS.countryAdminA, (trx) => deleteMethodology(trx, ELECTIONS_A.draft.id))),
    ).toMatch(/^23503/);
    const deleted = await as(USERS.countryAdminA, async (trx) => {
      await deleteReviewer(trx, ELECTIONS_A.draft.methodology, ELECTIONS_A.draft.reviewer);
      return deleteMethodology(trx, ELECTIONS_A.draft.id);
    });
    expect(deleted).toBe('changed');
    expect(
      await as(USERS.countryAdminA, (trx) => deleteMethodology(trx, ELECTIONS_A.empty.id)),
    ).toBe('not-found');
    expect(await as(USERS.editorA, (trx) => deleteMethodology(trx, ELECTIONS_A.draft.id))).toBe(
      'forbidden',
    );
  });
});

describe('two moves of one list at once', () => {
  const env = (name: string): string => {
    const value = process.env[name];
    if (!value) {
      throw new Error(`${name} is not set. Copy .env.example to .env.`);
    }
    return value;
  };
  const admin = createDatabase({
    connectionString: env('TEST_ADMIN_DATABASE_URL'),
    maxConnections: 2,
  });
  const owner = createDatabase({
    connectionString: env('TEST_SUPERUSER_DATABASE_URL'),
    maxConnections: 1,
  });

  afterAll(async () => {
    await admin.destroy();
    await owner.destroy();
  });

  it('run one after the other, and the second, made from the old order, is refused as stale', async () => {
    const [first = '', second = ''] = ELECTIONS_A.draft.parties;
    const id = ELECTIONS_A.draft.id;
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = () => {};
    const moved = new Promise<void>((resolve) => {
      held = resolve;
    });
    try {
      const one = withActor(admin, { userId: USERS.editorA, aal: 2 }, async (trx) => {
        const result = await reorder(trx, 'app.parties', id, [first, second], [second, first]);
        held();
        await hold;
        return result;
      });
      await moved;
      // Another editor, from a page that still shows the old order.
      const two = withActor(admin, { userId: USERS.editorAReviewerB, aal: 2 }, (trx) =>
        reorder(trx, 'app.parties', id, [first, second], [first, second]),
      );
      for (let tries = 0; tries < 100; tries += 1) {
        const { rows } = await sql<{ n: string }>`
          SELECT count(*) AS n FROM pg_stat_activity
           WHERE usename = 'aiontheballot_admin' AND wait_event_type = 'Lock'`.execute(owner);
        if (Number(rows[0]?.n) > 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      release();
      expect(await one).toBe('changed');
      expect(await two).toBe('stale');
    } finally {
      await sql`UPDATE app.parties SET display_order = CASE id WHEN ${first} THEN 1 ELSE 2 END
                 WHERE election_id = ${id}`.execute(owner);
    }
  });
});
