import type { Database } from '@aiontheballot/db/client';

import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';

// The fixtures @aiontheballot/db's database tests load into aiontheballot_test before these run.
import { CELLS, USERS } from '../../../packages/db/tests/rls/matrix.js';
import { cellGrid } from '../src/admin/cell-grid.js';
import { inRolledBackTransaction } from './db.js';

/** As `userId` through the admin role, the way withActor sets it. */
const actAs = async (db: Database, userId: string, aal: 1 | 2 = 2) => {
  await sql`SET LOCAL ROLE aiontheballot_admin`.execute(db);
  await sql`SELECT set_config('app.user_id', ${userId}, true), set_config('app.aal', ${String(aal)}, true)`.execute(
    db,
  );
};

const gridAs = (userId: string, aal: 1 | 2 = 2, tenant = 'test-a') =>
  inRolledBackTransaction(async (db) => {
    await actAs(db, userId, aal);
    return cellGrid(db, tenant, CELLS.A.election.slug);
  });

describe('the cell grid (editorial workflow C1.1)', () => {
  it('lays out every party × criterion pair, with each cell where it stands', async () => {
    const grid = await gridAs(USERS.editorA);
    expect(grid?.election).toMatchObject({ id: CELLS.A.election.id, status: 'live' });
    expect(grid?.cells).toHaveLength((grid?.parties.length ?? 0) * (grid?.criteria.length ?? 0));
    const cell = (id: string) => grid?.cells.find((c) => c.assessmentId === id);
    expect(cell(CELLS.A.draft)).toMatchObject({
      working: 'draft',
      published: null,
      rejected: false,
    });
    expect(cell(CELLS.A.review)).toMatchObject({ working: 'in_review', published: null });
    expect(cell(CELLS.A.published)).toMatchObject({
      working: 'published',
      published: { rating: expect.any(String), revisionNo: 1 },
    });
    expect(
      grid?.cells.filter((c) => c.assessmentId === null).every((c) => c.working === 'none'),
    ).toBe(true);
  });

  it('shows a published cell being edited again as published with a newer draft, and a recheck flag', async () => {
    const grid = await inRolledBackTransaction(async (db) => {
      await sql`SELECT set_config('app.user_id', ${USERS.editorA}, true), set_config('app.aal', '2', true)`.execute(
        db,
      );
      await sql`UPDATE app.assessments SET draft_summary = '{"es": "Resumen de ejemplo, otra vez"}' WHERE id = ${CELLS.A.published}`.execute(
        db,
      );
      await sql`UPDATE app.assessments SET recheck_reason = 'programme_published' WHERE id = ${CELLS.A.published}`.execute(
        db,
      );
      await actAs(db, USERS.editorA);
      return cellGrid(db, 'test-a', CELLS.A.election.slug);
    });
    expect(grid?.cells.find((c) => c.assessmentId === CELLS.A.published)).toMatchObject({
      working: 'published_with_draft',
      published: { revisionNo: 1 },
      recheck: true,
    });
  });

  it('shows a draft sent back by a reviewer as rejected', async () => {
    const grid = await inRolledBackTransaction(async (db) => {
      await actAs(db, USERS.reviewerA);
      await sql`INSERT INTO app.review_events (tenant_id, assessment_id, kind, note) SELECT tenant_id, id, 'commented', 'Falta una cita de ejemplo.' FROM app.assessments WHERE id = ${CELLS.A.review}`.execute(
        db,
      );
      await sql`UPDATE app.assessments SET state = 'draft' WHERE id = ${CELLS.A.review}`.execute(
        db,
      );
      return cellGrid(db, 'test-a', CELLS.A.election.slug);
    });
    expect(grid?.cells.find((c) => c.assessmentId === CELLS.A.review)).toMatchObject({
      working: 'draft',
      rejected: true,
    });
  });

  it('orders parties and criteria as the public table does', async () => {
    const [grid, order] = await inRolledBackTransaction(async (db) => {
      await actAs(db, USERS.editorA);
      const ordered = (table: 'parties' | 'criteria') =>
        sql<{
          id: string;
        }>`SELECT id FROM app.${sql.raw(table)} WHERE election_id = ${CELLS.A.election.id}
                            ORDER BY display_order, slug`.execute(db);
      return [
        await cellGrid(db, 'test-a', CELLS.A.election.slug),
        { parties: (await ordered('parties')).rows, criteria: (await ordered('criteria')).rows },
      ] as const;
    });
    expect(grid?.parties.map((p) => p.id)).toEqual(order.parties.map((p) => p.id));
    expect(grid?.criteria.map((c) => c.id)).toEqual(order.criteria.map((c) => c.id));
    expect(
      grid?.cells.slice(0, order.criteria.length).every((c) => c.partyId === order.parties[0]?.id),
    ).toBe(true);
  });

  it('is there for a platform admin too', async () => {
    expect((await gridAs(USERS.platformAdmin))?.election.id).toBe(CELLS.A.election.id);
  });

  it.each([
    ['a member of another tenant', USERS.countryAdminB, 2],
    ['a user with no membership', USERS.noMembership, 2],
    ['a member before TOTP', USERS.editorA, 1],
  ] as const)('is nowhere for %s', async (_name, userId, aal) => {
    expect(await gridAs(userId, aal)).toBeUndefined();
  });

  it('is nowhere for an election of another tenant with the same slug', async () => {
    // B's live election has A's live election's slug: the tenant in the path decides.
    expect((await gridAs(USERS.editorA, 2, 'test-b'))?.election.id).toBeUndefined();
  });
});
