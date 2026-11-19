import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { CELLS, USERS } from './rls/matrix.js';

// A change off the record (PLAN R243; a site's country admins too, PLAN R244): a country admin or a platform admin
// changes what a live election's public already reads with no
// change kind and no public note. It is published as an update, marked `unlogged`, which the corrections log leaves
// out; the public sees it in the place of the revision before it (`publicHistory`).

const CHECK_VIOLATION = '23514';
const RESTRICT_VIOLATION = '23001';
const INSUFFICIENT_PRIVILEGE = '42501';

const setActor = async (client: pg.Client, userId: string): Promise<void> => {
  await client.query(
    `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
    [userId],
  );
};

/** As `userId` through the admin role, in a transaction that is rolled back. */
const actingAs = <T>(userId: string, fn: (client: pg.Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SET LOCAL ROLE aiontheballot_admin');
    await setActor(client, userId);
    return fn(client);
  });

const A = CELLS.A;

const PUBLISH = `INSERT INTO app.assessment_revisions (assessment_id, reviewed_version)
                 SELECT id, content_version FROM app.assessments WHERE id = '${A.review}'`;
const SUBMIT = `UPDATE app.assessments SET state = 'in_review' WHERE id = '${A.review}'`;
const CHANGED = `draft_summary = '{"es": "Resumen de ejemplo cambiado"}'`;

const change = (set: string): string =>
  `UPDATE app.assessments SET ${set} WHERE id = '${A.review}'`;

/**
 * A's cell in review, published by reviewer A while its election is live (its first revision, which the public
 * reads), in an election whose second reviewer a platform admin turned off, so whoever changes the cell next may
 * publish the change. Leaves the platform admin acting.
 */
const publishedLive = async (client: pg.Client): Promise<void> => {
  await setActor(client, USERS.reviewerA);
  await client.query(PUBLISH);
  await setActor(client, USERS.platformAdmin);
  await client.query('UPDATE app.elections SET require_second_reviewer = false WHERE id = $1', [
    A.election.id,
  ]);
};

const revisions = async (client: pg.Client) =>
  (
    await client.query<{
      revision_no: number;
      change_kind: string;
      public_note: unknown;
      unlogged: boolean;
    }>(
      `SELECT revision_no, change_kind, public_note, unlogged FROM app.assessment_revisions
        WHERE assessment_id = $1 ORDER BY revision_no`,
      [A.review],
    )
  ).rows;

const logged = async (client: pg.Client): Promise<string[]> =>
  (
    await client.query<{ change: string }>(
      'SELECT change FROM app.corrections_log WHERE assessment_id = $1',
      [A.review],
    )
  ).rows.map((row) => row.change);

describe("a published cell's change off the record (PLAN R243)", () => {
  it('is published by a platform admin with no kind or public note, as an update the corrections log leaves out', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      await publishedLive(client);
      await client.query(change(`${CHANGED}, draft_unlogged = true`));
      expect(await errorCode(client, SUBMIT)).toBeNull();
      expect(await errorCode(client, PUBLISH)).toBeNull();
      expect(await revisions(client)).toEqual([
        { revision_no: 1, change_kind: 'initial', public_note: null, unlogged: false },
        { revision_no: 2, change_kind: 'update', public_note: null, unlogged: true },
      ]);
      expect(await logged(client)).toEqual([]);
    });
  });

  it('is itself an edit: marking a published cell starts its next draft', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      await publishedLive(client);
      const before = (
        await client.query<{ content_version: number }>(
          'SELECT content_version FROM app.assessments WHERE id = $1',
          [A.review],
        )
      ).rows[0]!.content_version;
      await client.query(change('draft_unlogged = true'));
      expect(
        (
          await client.query(
            'SELECT state, content_version, draft_unlogged FROM app.assessments WHERE id = $1',
            [A.review],
          )
        ).rows,
      ).toEqual([{ state: 'draft', content_version: before + 1, draft_unlogged: true }]);
    });
  });

  it('is recorded as nothing else: an update with no note, never one published in preview', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      await publishedLive(client);
      await client.query(change(`${CHANGED}, draft_unlogged = true`));
      await client.query(SUBMIT);
      await client.query(PUBLISH);
      // With the triggers off, as only a superuser can: the row's own check is what is left.
      await client.query('RESET ROLE');
      await client.query('SET LOCAL session_replication_role = replica');
      for (const set of [
        `change_kind = 'correction'`,
        `public_note = '{"es": "Nota de ejemplo"}'`,
        'published_in_preview = true',
      ]) {
        expect(
          await errorCode(
            client,
            `UPDATE app.assessment_revisions SET ${set} WHERE assessment_id = '${A.review}' AND unlogged`,
          ),
        ).toBe(CHECK_VIOLATION);
      }
    });
  });

  it('ends with its publish: the next change is on the record again', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      await publishedLive(client);
      await client.query(change(`${CHANGED}, draft_unlogged = true`));
      await client.query(SUBMIT);
      await client.query(PUBLISH);
      expect(
        (await client.query('SELECT draft_unlogged FROM app.assessments WHERE id = $1', [A.review]))
          .rows,
      ).toEqual([{ draft_unlogged: false }]);
      await client.query(
        change(`draft_summary = '{"es": "Resumen de ejemplo cambiado otra vez"}'`),
      );
      expect(await errorCode(client, SUBMIT)).toBe(CHECK_VIOLATION);
      await client.query(
        change(`draft_change_kind = 'correction', draft_public_note = '{"es": "Nota de ejemplo"}'`),
      );
      await client.query(SUBMIT);
      await client.query(PUBLISH);
      expect(await logged(client)).toEqual(['correction']);
    });
  });

  it('is not marked by an editor', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      await publishedLive(client);
      await setActor(client, USERS.editorA);
      expect(await errorCode(client, change(`${CHANGED}, draft_unlogged = true`))).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    });
  });

  it("is a country admin's of the site too: marked, submitted and published as a platform admin's (PLAN R244)", async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      await publishedLive(client);
      await setActor(client, USERS.countryAdminA);
      expect(await errorCode(client, change(`${CHANGED}, draft_unlogged = true`))).toBeNull();
      expect(await errorCode(client, SUBMIT)).toBeNull();
      expect(await errorCode(client, PUBLISH)).toBeNull();
      expect((await revisions(client)).at(-1)).toEqual({
        revision_no: 2,
        change_kind: 'update',
        public_note: null,
        unlogged: true,
      });
      expect(await logged(client)).toEqual([]);
    });
  });

  it("is not marked through a member's token, even a platform admin's", async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      await publishedLive(client);
      await client.query(
        `SELECT set_config('app.token_id', '0190f8c4-0000-7000-8000-0000000000aa', true)`,
      );
      expect(await errorCode(client, change(`${CHANGED}, draft_unlogged = true`))).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    });
  });

  it('is not published by a reviewer, who publishes any other change', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      await publishedLive(client);
      await client.query(change(`${CHANGED}, draft_unlogged = true`));
      await client.query(SUBMIT);
      await setActor(client, USERS.reviewerA);
      expect(await errorCode(client, PUBLISH)).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });

  it.each([
    ['a change kind', `draft_change_kind = 'correction'`],
    ['a public note', `draft_public_note = '{"es": "Nota de ejemplo"}'`],
  ])('takes no %s of its own', async (_, set) => {
    await actingAs(USERS.reviewerA, async (client) => {
      await publishedLive(client);
      expect(await errorCode(client, change(`${CHANGED}, draft_unlogged = true, ${set}`))).toBe(
        CHECK_VIOLATION,
      );
    });
  });

  it('is not for a cell never published', async () => {
    await actingAs(USERS.platformAdmin, async (client) => {
      expect(
        await errorCode(
          client,
          `UPDATE app.assessments SET draft_unlogged = true WHERE id = '${A.draft}'`,
        ),
      ).toBe(CHECK_VIOLATION);
    });
  });

  it('is not for an archived election, which takes corrections and withdrawals only', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      await publishedLive(client);
      await setActor(client, USERS.countryAdminA);
      await client.query(`UPDATE app.elections SET status = 'archived' WHERE id = $1`, [
        A.election.id,
      ]);
      await setActor(client, USERS.platformAdmin);
      expect(await errorCode(client, change(`${CHANGED}, draft_unlogged = true`))).toBe(
        RESTRICT_VIOLATION,
      );
    });
  });

  it('is refused at publish when the election was archived after the submission', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      await publishedLive(client);
      await client.query(change(`${CHANGED}, draft_unlogged = true`));
      await client.query(SUBMIT);
      await setActor(client, USERS.countryAdminA);
      await client.query(`UPDATE app.elections SET status = 'archived' WHERE id = $1`, [
        A.election.id,
      ]);
      await setActor(client, USERS.platformAdmin);
      expect(await errorCode(client, PUBLISH)).toBe(RESTRICT_VIOLATION);
    });
  });

  it('never follows a withdrawal, which the public was told of', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      await publishedLive(client);
      const rating = (
        await client.query<{ draft_rating: string }>(
          'SELECT draft_rating FROM app.assessments WHERE id = $1',
          [A.review],
        )
      ).rows[0]!.draft_rating;
      await client.query(
        change(
          `draft_rating = NULL, draft_change_kind = 'withdrawal', draft_public_note = '{"es": "Nota de ejemplo"}'`,
        ),
      );
      await client.query(SUBMIT);
      await client.query(PUBLISH);
      await client.query(change(`draft_rating = '${rating}', draft_unlogged = true`));
      expect(await errorCode(client, SUBMIT)).toBe(CHECK_VIOLATION);
    });
  });

  it('leaves a change on the record as it was: it still needs its kind and its note', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      await publishedLive(client);
      await client.query(change(CHANGED));
      expect(await errorCode(client, SUBMIT)).toBe(CHECK_VIOLATION);
      await client.query(change(`draft_change_kind = 'update'`));
      expect(await errorCode(client, SUBMIT)).toBe(CHECK_VIOLATION);
    });
  });
});
