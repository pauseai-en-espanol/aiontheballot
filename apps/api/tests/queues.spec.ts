import type { DB } from '@aiontheballot/db/generated/db';

import { sql, type Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';

import { accessTo } from '../src/admin/access.js';
import { rejectCell } from '../src/admin/cells.js';
import { workQueues } from '../src/admin/queues.js';
import { inRolledBackTransaction } from './db.js';
import { LIVE_A, TENANT_A, USERS } from './fixtures.js';

/** As `userId` through the admin role, the way withActor sets it. */
const actAs = async (trx: Transaction<DB>, userId: string) => {
  await sql`SET LOCAL ROLE aiontheballot_admin`.execute(trx);
  await sql`SELECT set_config('app.user_id', ${userId}, true), set_config('app.aal', '2', true)`.execute(
    trx,
  );
};

const queuesOf = async (trx: Transaction<DB>, userId: string) => {
  await actAs(trx, userId);
  const access = await accessTo(trx, userId, 'test-a');
  if (!access) {
    throw new Error(`${userId} can't open test-a`);
  }
  return workQueues(trx, access, userId);
};

/** The cells a queue holds, by their party and criterion. */
const pairs = (queue: { items: { partyId: string; criterionId: string }[] } | null) =>
  queue?.items.map((item) => `${item.partyId}/${item.criterionId}`) ?? null;

const pairOf = async (trx: Transaction<DB>, cellId: string) => {
  const { rows } = await sql<{ party_id: string; criterion_id: string; content_version: number }>`
    SELECT party_id, criterion_id, content_version FROM app.assessments WHERE id = ${cellId}`.execute(
    trx,
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`No cell ${cellId}`);
  }
  return { ...row, pair: `${row.party_id}/${row.criterion_id}` };
};

describe("a site's work queues (editorial workflow C1.2)", () => {
  it("give an editor their drafts, the site's new reports and recheck flags, and no review queue", async () => {
    await inRolledBackTransaction(async (trx) => {
      const draft = await pairOf(trx, LIVE_A.cells.draft);
      const queues = await queuesOf(trx, USERS.editorA);
      expect(pairs(queues.drafts)).toContain(draft.pair);
      expect(queues.returned.total).toBe(0);
      expect(queues.review).toBe(null);
      expect(queues.recheck).toEqual({ total: 0, items: [] });
      // The fixture report of A, still new.
      expect(queues.reports).toBe(1);
      expect(queues.failedSources).not.toBe(null);
      expect(queues.drafts.items[0]?.election.slug).toBe(LIVE_A.slug);
    });
  });

  it('give a reviewer the cells in review they had no hand in, and no editing queues', async () => {
    await inRolledBackTransaction(async (trx) => {
      const inReview = await pairOf(trx, LIVE_A.cells.inReview);
      const queues = await queuesOf(trx, USERS.reviewerA);
      expect(pairs(queues.review)).toContain(inReview.pair);
      expect(queues.drafts.total).toBe(0);
      expect(queues.recheck).toBe(null);
      expect(queues.failedSources).toBe(null);
      // Its author wrote it: nothing waits for them to review.
      const author = await queuesOf(trx, USERS.editorA);
      expect(author.review).toBe(null);
    });
  });

  it('move a draft sent back to its editors from their drafts to what came back, until it is submitted', async () => {
    await inRolledBackTransaction(async (trx) => {
      const inReview = await pairOf(trx, LIVE_A.cells.inReview);
      await actAs(trx, USERS.reviewerA);
      expect(
        await rejectCell(
          trx,
          TENANT_A,
          LIVE_A.id,
          LIVE_A.cells.inReview,
          inReview.content_version,
          'Falta una cita del programa',
        ),
      ).toBe('changed');
      const queues = await queuesOf(trx, USERS.editorA);
      expect(pairs(queues.returned)).toContain(inReview.pair);
      expect(pairs(queues.drafts)).not.toContain(inReview.pair);
      // A comment doesn't change that.
      await sql`INSERT INTO app.review_events (tenant_id, assessment_id, kind, note)
                VALUES (${TENANT_A}, ${LIVE_A.cells.inReview}, 'commented', 'Visto')`.execute(trx);
      expect(pairs((await queuesOf(trx, USERS.editorA)).returned)).toContain(inReview.pair);
    });
  });

  it('list a recheck flag to those who clear it', async () => {
    await inRolledBackTransaction(async (trx) => {
      const draft = await pairOf(trx, LIVE_A.cells.draft);
      await actAs(trx, USERS.editorA);
      await sql`UPDATE app.assessments SET recheck_reason = 'Motivo de ejemplo'
                 WHERE id = ${LIVE_A.cells.draft}`.execute(trx);
      expect(pairs((await queuesOf(trx, USERS.countryAdminA)).recheck)).toContain(draft.pair);
    });
  });

  it('show a platform admin no reports, which they never read (PLAN P11), and everything else', async () => {
    await inRolledBackTransaction(async (trx) => {
      const queues = await queuesOf(trx, USERS.platformAdmin);
      expect(queues.reports).toBe(null);
      expect(queues.review).not.toBe(null);
      expect(queues.recheck).not.toBe(null);
    });
  });

  it("show nothing of another site's", async () => {
    await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.countryAdminB);
      expect(await accessTo(trx, USERS.countryAdminB, 'test-a')).toBe(undefined);
    });
  });
});
