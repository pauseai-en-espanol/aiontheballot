import type { DB } from '@aiontheballot/db/generated/db';

import { sql, type Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';

import { accessTo } from '../src/admin/access.js';
import { goLiveChecklist } from '../src/admin/checklist.js';
import { getElection, updateElection } from '../src/admin/elections.js';
import { inRolledBackTransaction } from './db.js';
import { ELECTIONS_A, TENANT_A, USERS } from './fixtures.js';

/** As `userId` through the admin role, the way withActor sets it. */
const actAs = async (trx: Transaction<DB>, userId: string) => {
  await sql`SET LOCAL ROLE aiontheballot_admin`.execute(trx);
  await sql`SELECT set_config('app.user_id', ${userId}, true), set_config('app.aal', '2', true)`.execute(
    trx,
  );
};

const as = <T>(userId: string, fn: (trx: Transaction<DB>) => Promise<T>) =>
  inRolledBackTransaction(async (trx) => {
    await actAs(trx, userId);
    return fn(trx);
  });

const refusal = async (write: Promise<unknown>) => {
  try {
    await write;
    return 'ok';
  } catch (error) {
    const { code, constraint } = error as { code?: string; constraint?: string };
    return constraint ? `${code} ${constraint}` : code;
  }
};

const checklist = (
  userId: string,
  electionId: string,
  prepare?: (trx: Transaction<DB>) => Promise<void>,
) =>
  as(userId, async (trx) => {
    await prepare?.(trx);
    const access = await accessTo(trx, userId, 'test-a');
    if (!access) {
      throw new Error('test-a is not visible');
    }
    return goLiveChecklist(trx, access, electionId);
  });

describe('going live (editorial workflow E5)', () => {
  it('lists nothing missing for a complete draft, and warns about the texts not yet published', async () => {
    const list = await checklist(USERS.countryAdminA, ELECTIONS_A.draft.id);
    expect(list).toEqual({
      needs: {
        activeTenant: true,
        operator: true,
        methodology: true,
        electionName: true,
        methodologyText: true,
        partiesMissingNames: [],
        criteriaMissingTexts: [],
      },
      warnings: {
        noParties: false,
        noCriteria: false,
        noReviewers: false,
        unpublishedTexts: ['right_of_reply_policy', 'about_operator'],
      },
      ready: true,
    });
  });

  it('names what an empty draft lacks, and the structure missing its default-language text', async () => {
    const empty = await checklist(USERS.countryAdminA, ELECTIONS_A.empty.id);
    expect(empty).toMatchObject({
      needs: {
        methodology: false,
        methodologyText: false,
        partiesMissingNames: [],
        criteriaMissingTexts: [],
      },
      warnings: { noParties: true, noCriteria: true, noReviewers: true },
      ready: false,
    });
    const missing = await checklist(USERS.countryAdminA, ELECTIONS_A.draft.id, async (trx) => {
      await sql`UPDATE app.parties SET short_name = '{"en": "PEA"}' WHERE id = ${ELECTIONS_A.draft.parties[0]}`.execute(
        trx,
      );
      await sql`UPDATE app.criteria SET short_title = NULL WHERE id = ${ELECTIONS_A.draft.criteria[1]}`.execute(
        trx,
      );
    });
    expect(missing).toMatchObject({
      needs: {
        partiesMissingNames: ['partido-ejemplo-a'],
        criteriaMissingTexts: ['criterio-de-ejemplo-2'],
      },
      ready: false,
    });
  });

  // Each item, made to miss, as the checklist says it and as the database refuses to go live without it.
  it.each([
    [
      'the operator',
      'operator',
      sql`DELETE FROM app.tenant_organizations WHERE tenant_id = ${TENANT_A} AND role = 'operator'`,
    ],
    [
      'the election’s name',
      'electionName',
      sql`UPDATE app.elections SET announced = false, name = '{"en": "Example"}' WHERE id = ${ELECTIONS_A.draft.id}`,
    ],
    [
      'the methodology’s text',
      'methodologyText',
      sql`UPDATE app.methodologies SET body = '{"en": "Example"}' WHERE id = ${ELECTIONS_A.draft.methodology}`,
    ],
    [
      'the methodology',
      'methodology',
      sql`DELETE FROM app.methodologies WHERE id = ${ELECTIONS_A.draft.methodology}`,
    ],
    [
      'a party’s name',
      'partiesMissingNames',
      sql`UPDATE app.parties SET name = '{"en": "Example"}' WHERE id = ${ELECTIONS_A.draft.parties[1]}`,
    ],
    [
      'a party’s short name',
      'partiesMissingNames',
      sql`UPDATE app.parties SET short_name = '{"en": "EX"}' WHERE id = ${ELECTIONS_A.draft.parties[0]}`,
    ],
    [
      'a criterion’s title',
      'criteriaMissingTexts',
      sql`UPDATE app.criteria SET title = '{"en": "Example"}' WHERE id = ${ELECTIONS_A.draft.criteria[0]}`,
    ],
    [
      'a criterion’s description',
      'criteriaMissingTexts',
      sql`UPDATE app.criteria SET description = '{"en": "Example"}' WHERE id = ${ELECTIONS_A.draft.criteria[1]}`,
    ],
    [
      'a criterion’s short title',
      'criteriaMissingTexts',
      sql`UPDATE app.criteria SET short_title = NULL WHERE id = ${ELECTIONS_A.draft.criteria[1]}`,
    ],
  ] as const)('misses %s, as the database does', async (_name, item, prepare) => {
    const { list, live } = await inRolledBackTransaction(async (trx) => {
      // As the owner, behind the triggers' checks of who may (and the deferred one of an active tenant's operator,
      // which the rollback never reaches); the methodology goes with its reviewers.
      // As the fixture platform admin, for the triggers that guard who changes what.
      await sql`SELECT set_config('app.user_id', ${USERS.platformAdmin}, true), set_config('app.aal', '2', true)`.execute(
        trx,
      );
      await sql`DELETE FROM app.methodology_reviewers WHERE methodology_id = ${ELECTIONS_A.draft.methodology}`.execute(
        trx,
      );
      await prepare.execute(trx);
      await actAs(trx, USERS.countryAdminA);
      const access = await accessTo(trx, USERS.countryAdminA, 'test-a');
      if (!access) {
        throw new Error('test-a is not visible');
      }
      const found = await goLiveChecklist(trx, access, ELECTIONS_A.draft.id);
      return {
        list: found,
        live: await refusal(
          updateElection(trx, TENANT_A, ELECTIONS_A.draft.id, { status: 'live' }),
        ),
      };
    });
    const value = list.needs[item];
    expect(Array.isArray(value) ? value.length > 0 : value === false).toBe(true);
    expect(list.ready).toBe(false);
    expect(live).toBe('23514');
  });

  it('is ready only where the inactive tenant is not, as the database refuses its draft', async () => {
    const { list, live } = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.platformAdmin);
      const access = await accessTo(trx, USERS.platformAdmin, 'test-inactive');
      if (!access) {
        throw new Error('test-inactive is not visible');
      }
      const draft = await getElection(trx, access.tenantId, ELECTIONS_A.draft.slug);
      if (!draft) {
        throw new Error('the inactive tenant has no draft with that slug');
      }
      return {
        list: await goLiveChecklist(trx, access, draft.id),
        live: await refusal(updateElection(trx, access.tenantId, draft.id, { status: 'live' })),
      };
    });
    expect(list).toMatchObject({ needs: { activeTenant: false }, ready: false });
    expect(live).toBe('23514');
  });

  it("isn't ready without an operator, and counts no retired reviewer", async () => {
    const list = await checklist(USERS.countryAdminA, ELECTIONS_A.draft.id, async (trx) => {
      await sql`UPDATE app.methodology_reviewers SET retired_at = now() WHERE id = ${ELECTIONS_A.draft.reviewer}`.execute(
        trx,
      );
      // As the owner, behind the deferred check that would refuse this at commit (the transaction is rolled back).
      await sql`RESET ROLE`.execute(trx);
      await sql`DELETE FROM app.tenant_organizations WHERE tenant_id = ${TENANT_A} AND role = 'operator'`.execute(
        trx,
      );
      await actAs(trx, USERS.countryAdminA);
    });
    expect(list).toMatchObject({
      needs: { operator: false },
      warnings: { noReviewers: true },
      ready: false,
    });
  });

  it('agrees with the database: a ready draft goes live, an incomplete one is refused', async () => {
    const live = await as(USERS.countryAdminA, async (trx) => {
      expect(await updateElection(trx, TENANT_A, ELECTIONS_A.draft.id, { status: 'live' })).toBe(
        'changed',
      );
      return getElection(trx, TENANT_A, ELECTIONS_A.draft.slug);
    });
    expect(live).toMatchObject({ status: 'live', wentLiveAt: expect.any(String) });
    expect(
      await refusal(
        as(USERS.countryAdminA, (trx) =>
          updateElection(trx, TENANT_A, ELECTIONS_A.empty.id, { status: 'live' }),
        ),
      ),
    ).toBe('23514');
    expect(
      await refusal(
        as(USERS.editorA, (trx) =>
          updateElection(trx, TENANT_A, ELECTIONS_A.draft.id, { status: 'live' }),
        ),
      ),
    ).toBe('42501');
  });
});

describe('the freeze window and archiving (editorial workflow E6, E7)', () => {
  it('is set and cleared by a country admin, and only forwards in time', async () => {
    const window = await as(USERS.countryAdminA, async (trx) => {
      await updateElection(trx, TENANT_A, ELECTIONS_A.live.id, {
        frozenFrom: '2030-01-01T09:00:00Z',
        frozenUntil: '2030-01-02T09:00:00Z',
      });
      const set = await getElection(trx, TENANT_A, ELECTIONS_A.live.slug);
      await updateElection(trx, TENANT_A, ELECTIONS_A.live.id, {
        frozenFrom: null,
        frozenUntil: null,
      });
      const cleared = await getElection(trx, TENANT_A, ELECTIONS_A.live.slug);
      return { set, cleared };
    });
    expect(window.set).toMatchObject({
      frozenFrom: '2030-01-01T09:00:00.000Z',
      frozenUntil: '2030-01-02T09:00:00.000Z',
    });
    expect(window.cleared).toMatchObject({ frozenFrom: null, frozenUntil: null });
    expect(
      await refusal(
        as(USERS.countryAdminA, (trx) =>
          updateElection(trx, TENANT_A, ELECTIONS_A.live.id, {
            frozenFrom: '2030-01-02T09:00:00Z',
            frozenUntil: '2030-01-01T09:00:00Z',
          }),
        ),
      ),
    ).toBe('23514 elections_check2');
    expect(
      await refusal(
        as(USERS.editorA, (trx) =>
          updateElection(trx, TENANT_A, ELECTIONS_A.live.id, {
            frozenFrom: '2030-01-01T09:00:00Z',
          }),
        ),
      ),
    ).toBe('42501');
  });

  it('archives a live election, for good', async () => {
    const result = await as(USERS.countryAdminA, async (trx) => {
      expect(await updateElection(trx, TENANT_A, ELECTIONS_A.live.id, { status: 'archived' })).toBe(
        'changed',
      );
      return refusal(updateElection(trx, TENANT_A, ELECTIONS_A.live.id, { status: 'live' }));
    });
    expect(result).toBe('23001');
    expect(
      await refusal(
        as(USERS.countryAdminA, (trx) =>
          updateElection(trx, TENANT_A, ELECTIONS_A.empty.id, { status: 'archived' }),
        ),
      ),
    ).toBe('23001');
  });
});
