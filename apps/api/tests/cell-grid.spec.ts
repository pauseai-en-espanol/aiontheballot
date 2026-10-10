import type { DB } from '@aiontheballot/db/generated/db';

import { sql, type Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';

import { cellGrid } from '../src/admin/cell-grid.js';
import { inRolledBackTransaction } from './db.js';
import { DRAFT_A, LIVE_A, LIVE_B, USERS } from './fixtures.js';

/** As `userId` through the admin role, the way withActor sets it. */
const actAs = async (trx: Transaction<DB>, userId: string, aal: 1 | 2 = 2) => {
  await sql`SET LOCAL ROLE aiontheballot_admin`.execute(trx);
  await sql`SELECT set_config('app.user_id', ${userId}, true), set_config('app.aal', ${String(aal)}, true)`.execute(
    trx,
  );
};

const gridAs = (
  userId: string,
  aal: 1 | 2 = 2,
  tenant = 'test-a',
  election: string = LIVE_A.slug,
) =>
  inRolledBackTransaction(async (trx) => {
    await actAs(trx, userId, aal);
    return cellGrid(trx, tenant, election);
  });

const cellOf = (grid: Awaited<ReturnType<typeof cellGrid>>, id: string) =>
  grid?.cells.find((c) => c.assessmentId === id);

describe('the cell grid (editorial workflow C1.1)', () => {
  it('lays out every party × criterion pair, with each cell where it stands', async () => {
    const grid = await gridAs(USERS.editorA);
    expect(grid?.election).toMatchObject({ id: LIVE_A.id, status: 'live' });
    expect(grid?.cells).toHaveLength(4);
    expect(cellOf(grid, LIVE_A.cells.draft)).toMatchObject({
      working: 'draft',
      published: null,
      rejection: null,
    });
    expect(cellOf(grid, LIVE_A.cells.inReview)).toMatchObject({
      working: 'in_review',
      published: null,
    });
    expect(cellOf(grid, LIVE_A.cells.published)).toMatchObject({
      working: 'published',
      published: { rating: LIVE_A.publishedRating, revisionNo: 1 },
      recheck: false,
    });
    expect(grid?.cells.filter((c) => c.assessmentId === null)).toEqual([
      expect.objectContaining({ working: 'none', published: null }),
    ]);
  });

  it('shows the published rating, not the newer draft, while a published cell is edited again', async () => {
    const grid = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.editorA);
      await sql`UPDATE app.assessments SET draft_rating = 'meets' WHERE id = ${LIVE_A.cells.published}`.execute(
        trx,
      );
      await sql`UPDATE app.assessments SET recheck_reason = 'programme_published' WHERE id = ${LIVE_A.cells.published}`.execute(
        trx,
      );
      return cellGrid(trx, 'test-a', LIVE_A.slug);
    });
    expect(cellOf(grid, LIVE_A.cells.published)).toMatchObject({
      working: 'published_with_draft',
      published: { rating: LIVE_A.publishedRating, revisionNo: 1 },
      recheck: true,
    });
  });

  it('keeps a rejection, with its note, through any comments, until the draft is submitted again', async () => {
    const states = await inRolledBackTransaction(async (trx) => {
      const id = LIVE_A.cells.inReview;
      const comment = (note: string) =>
        sql`INSERT INTO app.review_events (tenant_id, assessment_id, kind, note)
            SELECT tenant_id, id, 'commented', ${note} FROM app.assessments WHERE id = ${id}`.execute(
          trx,
        );
      await actAs(trx, USERS.reviewerA);
      await comment('Falta una cita de ejemplo.');
      await sql`UPDATE app.assessments SET state = 'draft' WHERE id = ${id}`.execute(trx);
      const rejected = cellOf(await cellGrid(trx, 'test-a', LIVE_A.slug), id);
      await actAs(trx, USERS.editorA);
      await comment('¿Qué cita de ejemplo falta?');
      await actAs(trx, USERS.reviewerA);
      await comment('La del programa de ejemplo.');
      const commented = cellOf(await cellGrid(trx, 'test-a', LIVE_A.slug), id);
      await actAs(trx, USERS.editorA);
      await sql`UPDATE app.assessments SET state = 'in_review' WHERE id = ${id}`.execute(trx);
      const resubmitted = cellOf(await cellGrid(trx, 'test-a', LIVE_A.slug), id);
      return { rejected, commented, resubmitted };
    });
    expect(states.rejected).toMatchObject({
      working: 'draft',
      rejection: { note: 'Falta una cita de ejemplo.' },
    });
    expect(states.commented).toMatchObject({ rejection: { note: 'Falta una cita de ejemplo.' } });
    expect(states.resubmitted).toMatchObject({ working: 'in_review', rejection: null });
  });

  it('shows a withdrawn cell as published without a rating, not as pending', async () => {
    const grid = await inRolledBackTransaction(async (trx) => {
      const id = LIVE_A.cells.published;
      await actAs(trx, USERS.editorA);
      await sql`UPDATE app.assessments
                   SET draft_change_kind = 'withdrawal', draft_rating = NULL,
                       draft_public_note = '{"es": "Retirada de ejemplo."}'
                 WHERE id = ${id}`.execute(trx);
      await sql`UPDATE app.assessments SET state = 'in_review' WHERE id = ${id}`.execute(trx);
      await actAs(trx, USERS.reviewerA);
      await sql`INSERT INTO app.assessment_revisions (assessment_id, reviewed_version)
                SELECT id, content_version FROM app.assessments WHERE id = ${id}`.execute(trx);
      return cellGrid(trx, 'test-a', LIVE_A.slug);
    });
    expect(cellOf(grid, LIVE_A.cells.published)).toMatchObject({
      working: 'published',
      published: { rating: null, revisionNo: 2 },
    });
  });

  it('orders parties and criteria by display order, then slug, and marks retired ones', async () => {
    const grid = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.editorA);
      const draft = sql`(SELECT e.id FROM app.elections e JOIN app.tenants t ON t.id = e.tenant_id
                          WHERE t.slug = 'test-a' AND e.slug = ${DRAFT_A.slug})`;
      await sql`UPDATE app.parties SET display_order = 3 - display_order WHERE election_id = ${draft}`.execute(
        trx,
      );
      await sql`UPDATE app.criteria SET display_order = 1 WHERE election_id = ${draft}`.execute(
        trx,
      );
      await sql`UPDATE app.criteria SET retired_at = now() WHERE election_id = ${draft} AND slug = 'criterio-de-ejemplo-2'`.execute(
        trx,
      );
      return cellGrid(trx, 'test-a', DRAFT_A.slug);
    });
    expect(grid?.parties.map((p) => p.slug)).toEqual(['partido-ejemplo-b', 'partido-ejemplo-a']);
    expect(grid?.criteria.map((c) => [c.slug, c.retired])).toEqual([
      ['criterio-de-ejemplo-1', false],
      ['criterio-de-ejemplo-2', true],
    ]);
    expect(grid?.cells.map((c) => [c.partyId, c.criterionId])).toEqual(
      (grid?.parties ?? []).flatMap((p) => (grid?.criteria ?? []).map((c) => [p.id, c.id])),
    );
  });

  it("is there for a platform admin in any tenant, and the path's tenant picks the election", async () => {
    expect((await gridAs(USERS.platformAdmin))?.election.id).toBe(LIVE_A.id);
    // B's live election has A's live election's slug.
    expect((await gridAs(USERS.platformAdmin, 2, 'test-b'))?.election.id).toBe(LIVE_B.id);
  });

  it.each([
    ['a member of another tenant', USERS.countryAdminB, 2],
    ['a user with no membership', USERS.noMembership, 2],
    ['a member before TOTP', USERS.editorA, 1],
  ] as const)('is nowhere for %s', async (_name, userId, aal) => {
    expect(await gridAs(userId, aal)).toBeUndefined();
  });

  it("is nowhere for a member asking for another tenant's election with the same slug", async () => {
    expect(await gridAs(USERS.editorA, 2, 'test-b')).toBeUndefined();
  });
});
