import type { DB } from '@aiontheballot/db/generated/db';

import { type RawBuilder, sql, type Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';

import { databaseRefusal } from '../src/database-errors.js';
import { inRolledBackTransaction } from './db.js';
import { DRAFT_A, LIVE_A, USERS } from './fixtures.js';

/** As `userId` through `role`, the way withActor sets it. */
const actAs = async (trx: Transaction<DB>, role: string, userId: string = USERS.noMembership) => {
  await sql`SELECT set_config('role', ${role}, true), set_config('app.user_id', ${userId}, true),
                   set_config('app.aal', '2', true)`.execute(trx);
};

/** What the API would answer if `statement` failed, run in a savepoint so the transaction goes on. */
const refusalOf = async (trx: Transaction<DB>, statement: RawBuilder<unknown>) => {
  await sql`SAVEPOINT attempt`.execute(trx);
  try {
    await statement.execute(trx);
    return 'no error';
  } catch (error) {
    await sql`ROLLBACK TO SAVEPOINT attempt`.execute(trx);
    return databaseRefusal(error);
  }
};

/** Real refusals from aiontheballot_test, so the SQLSTATE, routine and constraint are Postgres's own. */
describe('a database refusal, as Postgres raises it', () => {
  it('is a fault to report when a role lacks the grant, and forbidden when RLS or a trigger refuses', async () => {
    const answers = await inRolledBackTransaction(async (trx) => {
      const { rows } = await sql<{ tenant_id: string }>`
        SELECT tenant_id FROM app.assessments WHERE id = ${LIVE_A.cells.inReview}`.execute(trx);
      const comment = sql`INSERT INTO app.review_events (tenant_id, assessment_id, kind, note)
                          VALUES (${rows[0]?.tenant_id}, ${LIVE_A.cells.inReview}, 'commented', 'Nota de ejemplo.')`;
      await actAs(trx, 'aiontheballot_web');
      const web = await refusalOf(trx, comment);
      await actAs(trx, 'aiontheballot_admin', USERS.noMembership);
      const outsider = await refusalOf(trx, comment);
      return { web, outsider };
    });
    expect(answers.web).toEqual({ status: 500, error: 'unexpected', report: true });
    expect(answers.outsider).toEqual({ status: 403, error: 'forbidden', report: false });
  });

  it('names the check a value broke, and answers a value Postgres cannot read as invalid', async () => {
    const answers = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, 'aiontheballot_admin', USERS.countryAdminA);
      const reserved = await refusalOf(
        trx,
        sql`UPDATE app.elections SET slug = 'brand' WHERE slug = ${DRAFT_A.slug}`,
      );
      const malformed = await refusalOf(trx, sql`SELECT ${'no-es-un-id'}::uuid`);
      return { reserved, malformed };
    });
    expect(answers.reserved).toEqual({
      status: 422,
      error: 'incomplete',
      constraint: 'elections_slug_not_reserved',
      report: false,
    });
    expect(answers.malformed).toEqual({ status: 400, error: 'invalid', report: false });
  });

  it('names the foreign key a row broke', async () => {
    const answer = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, 'aiontheballot_admin', USERS.reviewerA);
      // A comment on a cell that isn't there (deleted meanwhile, say).
      return refusalOf(
        trx,
        sql`INSERT INTO app.review_events (tenant_id, assessment_id, kind, note)
            SELECT tenant_id, uuidv7(), 'commented', 'Nota de ejemplo.'
              FROM app.assessments WHERE id = ${LIVE_A.cells.inReview}`,
      );
    });
    expect(answer).toEqual({
      status: 409,
      error: 'linked',
      constraint: 'review_events_tenant_id_assessment_id_fkey',
      report: false,
    });
  });
});
