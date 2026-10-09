import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { CELLS, ELECTIONS, TENANT_A, USERS } from './rls/matrix.js';

const CHECK_VIOLATION = '23514';
const RESTRICT_VIOLATION = '23001';

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
const party = A.election.party;
const published = (id = party): string =>
  `UPDATE app.parties SET programme_status = 'published' WHERE id = '${id}'`;

describe("a party's programme status", () => {
  it('is published directly once live, stamping the check date, and audited', async () => {
    await actingAs(USERS.editorA, async (client) => {
      const { rows } = await client.query(
        `${published()} RETURNING programme_checked_at = now() AS now`,
      );
      expect(rows).toEqual([{ now: true }]);
      await client.query('RESET ROLE');
      const { rows: logged } = await client.query(
        `SELECT diff -> 'new' ->> 'programme_status' AS status, actor_id FROM app.audit_log
          WHERE table_name = 'parties' AND row_id = $1 ORDER BY id DESC LIMIT 1`,
        [party],
      );
      expect(logged).toEqual([{ status: 'published', actor_id: USERS.editorA }]);
    });
  });

  it('needs a source of the party marked as its programme, not just any of its sources', async () => {
    expect(
      await actingAs(USERS.editorA, async (client) => {
        await client.query(
          `INSERT INTO app.source_documents (tenant_id, election_id, party_id, kind, title)
           VALUES ($1, $2, $3, 'web_page', 'Otra página del partido')`,
          [TENANT_A, ELECTIONS.draftA.id, ELECTIONS.draftA.party],
        );
        return errorCode(client, published(ELECTIONS.draftA.party));
      }),
    ).toBe(CHECK_VIOLATION);
  });

  it('stamps a new check date even when it stays the same, and the date is never written directly', async () => {
    await actingAs(USERS.editorA, async (client) => {
      await client.query(
        `UPDATE app.parties SET programme_checked_at = '2000-01-01' WHERE id = $1`,
        [party],
      );
      expect(
        (await client.query('SELECT programme_checked_at FROM app.parties WHERE id = $1', [party]))
          .rows,
      ).toEqual([{ programme_checked_at: null }]);
      const { rows } = await client.query(
        `UPDATE app.parties SET programme_status = programme_status WHERE id = $1
         RETURNING programme_checked_at = now() AS now`,
        [party],
      );
      expect(rows).toEqual([{ now: true }]);
    });
  });

  it('is not updated inside the freeze window', async () => {
    expect(
      await actingAs(USERS.countryAdminA, async (client) => {
        await client.query('UPDATE app.elections SET frozen_from = now() WHERE id = $1', [
          A.election.id,
        ]);
        return errorCode(client, published());
      }),
    ).toBe(RESTRICT_VIOLATION);
  });

  it('flags the party\'s published "not mentioned" ratings for a recheck once published, and nothing else', async () => {
    await actingAs(USERS.editorA, async (client) => {
      // A's "not mentioned" draft cell and its "meets" cell in review, both published.
      await client.query(`UPDATE app.assessments SET state = 'in_review' WHERE id = $1`, [A.draft]);
      await setActor(client, USERS.reviewerA);
      for (const cell of [A.draft, A.review]) {
        await client.query(
          `INSERT INTO app.assessment_revisions (assessment_id, reviewed_version)
           SELECT id, content_version FROM app.assessments WHERE id = $1`,
          [cell],
        );
      }
      await setActor(client, USERS.editorA);
      await client.query(published());
      const flags = async () =>
        (
          await client.query<{ id: string; recheck_reason: string | null }>(
            'SELECT id, recheck_reason FROM app.assessments WHERE party_id = $1 ORDER BY id',
            [party],
          )
        ).rows;
      expect(await flags()).toEqual(
        [
          { id: A.draft, recheck_reason: 'programme_published' },
          { id: A.review, recheck_reason: null },
        ].sort((a, b) => a.id.localeCompare(b.id)),
      );
      // Once rechecked, checking the same published programme again flags nothing.
      await client.query('UPDATE app.assessments SET recheck_reason = NULL WHERE id = $1', [
        A.draft,
      ]);
      await client.query(published());
      expect((await flags()).every((f) => f.recheck_reason === null)).toBe(true);
    });
  });

  it('starts pending and unchecked for a new party', async () => {
    expect(
      await inRolledBackTransaction(async (client) =>
        errorCode(
          client,
          `INSERT INTO app.parties (tenant_id, election_id, slug, name, short_name, display_order, programme_status)
           VALUES ('${TENANT_A}', '${ELECTIONS.draftA.id}', 'partido-nuevo', '{"es": "Partido Nuevo"}',
                   '{"es": "PN"}', 9, 'published')`,
        ),
      ),
    ).toBe(RESTRICT_VIOLATION);
    const { rows } = await inRolledBackTransaction(async (client) =>
      client.query(
        `INSERT INTO app.parties (tenant_id, election_id, slug, name, short_name, display_order, programme_checked_at)
         VALUES ($1, $2, 'partido-nuevo', '{"es": "Partido Nuevo"}', '{"es": "PN"}', 9, now())
         RETURNING programme_checked_at`,
        [TENANT_A, ELECTIONS.draftA.id],
      ),
    );
    expect(rows).toEqual([{ programme_checked_at: null }]);
  });
});
