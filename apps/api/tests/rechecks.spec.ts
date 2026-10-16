import type { DB } from '@aiontheballot/db/generated/db';

import { sql, type Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';

import { listRechecks } from '../src/admin/rechecks.js';
import { inRolledBackTransaction } from './db.js';
import { ELECTIONS_A, LIVE_A, USERS } from './fixtures.js';

/** As `user`, through the admin role, as withActor runs a member's request. */
const as = async (trx: Transaction<DB>, user: string) => {
  await sql`RESET ROLE`.execute(trx);
  await sql`SELECT set_config('app.user_id', ${user}, true), set_config('app.aal', '2', true)`.execute(
    trx,
  );
  await sql`SET LOCAL ROLE aiontheballot_admin`.execute(trx);
};

/** Publishes the fixtures' draft "not mentioned" (checked against the party's programme): written by A's editor. */
const publishNotMentioned = async (trx: Transaction<DB>) => {
  await as(trx, USERS.editorA);
  await sql`UPDATE app.assessments SET state = 'in_review' WHERE id = ${LIVE_A.cells.draft}`.execute(
    trx,
  );
  await as(trx, USERS.reviewerA);
  await sql`
    INSERT INTO app.assessment_revisions (assessment_id, reviewed_version)
    SELECT id, content_version FROM app.assessments WHERE id = ${LIVE_A.cells.draft}`.execute(trx);
};

const checkedSources = async (trx: Transaction<DB>) =>
  (
    await sql<{ id: string }>`
      SELECT source_document_id AS id FROM app.draft_checked_documents
       WHERE assessment_id = ${LIVE_A.cells.draft}`.execute(trx)
  ).rows.map((row) => row.id);

describe('a published "not mentioned" resting only on replaced documents (D20, PLAN R187)', () => {
  it('is listed once every document it was checked against is replaced, for the election and its party', async () => {
    await inRolledBackTransaction(async (trx) => {
      await publishNotMentioned(trx);
      await as(trx, USERS.reviewerA);
      // Checked against a current programme: nothing to look at again.
      expect(await listRechecks(trx, LIVE_A.id)).toEqual([]);
      const sources = await checkedSources(trx);
      expect(sources.length).toBeGreaterThan(0);
      await as(trx, USERS.editorA);
      for (const source of sources) {
        await sql`UPDATE app.source_documents SET replaced_at = now() WHERE id = ${source}`.execute(
          trx,
        );
      }
      // Any member reads it, a reviewer included.
      await as(trx, USERS.reviewerA);
      const [party] = ELECTIONS_A.live.parties;
      const listed = await listRechecks(trx, LIVE_A.id);
      expect(listed).toEqual([
        {
          party: { id: party, slug: expect.any(String), name: expect.any(Object) },
          criterion: {
            id: ELECTIONS_A.live.criteria[0],
            slug: expect.any(String),
            title: expect.any(Object),
          },
          publishedAt: expect.any(String),
          replacedAt: expect.any(String),
        },
      ]);
      // Never another site's.
      await as(trx, USERS.countryAdminB);
      expect(await listRechecks(trx, LIVE_A.id)).toEqual([]);
    });
  });

  it.each([
    ['a later revision rates it otherwise', 'update'],
    ['a later revision withdraws it', 'withdrawal'],
    ['its party is retired', 'party'],
    ['its criterion is retired', 'criterion'],
  ] as const)('is no longer listed once %s', async (_name, change) => {
    await inRolledBackTransaction(async (trx) => {
      await publishNotMentioned(trx);
      await as(trx, USERS.editorA);
      for (const source of await checkedSources(trx)) {
        await sql`UPDATE app.source_documents SET replaced_at = now() WHERE id = ${source}`.execute(
          trx,
        );
      }
      await as(trx, USERS.reviewerA);
      expect((await listRechecks(trx, LIVE_A.id)).length).toBe(1);
      // Written here past the triggers: a correction's own path, and retiring, are tested where they are. A second
      // revision, never a change to the first, so only the current one counts.
      await sql`RESET ROLE`.execute(trx);
      await sql`SET LOCAL session_replication_role = replica`.execute(trx);
      if (change === 'update' || change === 'withdrawal') {
        await sql`
          INSERT INTO app.assessment_revisions
                 (tenant_id, assessment_id, election_id, party_id, criterion_id, reviewed_version, revision_no,
                  rating, summary, change_kind, public_note)
          SELECT tenant_id, assessment_id, election_id, party_id, criterion_id, reviewed_version, 2,
                 ${change === 'update' ? 'does_not_meet' : null}::app.rating,
                 ${change === 'update' ? sql`summary` : sql`NULL`},
                 ${change}::app.change_kind, '{"es": "Nota de ejemplo"}'::jsonb
            FROM app.assessment_revisions WHERE assessment_id = ${LIVE_A.cells.draft}`.execute(trx);
      } else if (change === 'party') {
        await sql`UPDATE app.parties SET retired_at = now() WHERE id = ${ELECTIONS_A.live.parties[0]}`.execute(
          trx,
        );
      } else {
        await sql`UPDATE app.criteria SET retired_at = now() WHERE id = ${ELECTIONS_A.live.criteria[0]}`.execute(
          trx,
        );
      }
      await sql`SET LOCAL session_replication_role = origin`.execute(trx);
      await as(trx, USERS.reviewerA);
      expect(await listRechecks(trx, LIVE_A.id)).toEqual([]);
    });
  });
});
