import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { CELLS, ELECTIONS, TENANT_A, TENANT_B, USERS } from './rls/matrix.js';

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

/** The fixture report of a tenant (about its cell in review, in its live election), read as the superuser. */
const reportOf = async (client: pg.Client, tenant: string): Promise<string> => {
  await client.query('RESET ROLE');
  const { rows } = await client.query<{ id: string }>(
    'SELECT id FROM app.reports WHERE tenant_id = $1',
    [tenant],
  );
  await client.query('SET LOCAL ROLE aiontheballot_admin');
  return rows[0]!.id;
};

const cellOf = async (client: pg.Client, cell: string) =>
  (
    await client.query<{
      draft_report_id: string | null;
      content_version: number;
      generation: number;
    }>('SELECT draft_report_id, content_version, generation FROM app.assessments WHERE id = $1', [
      cell,
    ])
  ).rows[0]!;

const linkSql = (cell: string, report: string | null): string =>
  `UPDATE app.assessments SET draft_report_id = ${report === null ? 'NULL' : `'${report}'`} WHERE id = '${cell}'`;

const link = (client: pg.Client, cell: string, report: string | null) =>
  client.query(linkSql(cell, report));

/** The SQLSTATE of linking, or null; a refusal leaves the transaction usable (errorCode's savepoint). */
const linkError = (client: pg.Client, cell: string, report: string) =>
  errorCode(client, linkSql(cell, report));

describe("a draft's link to the report it answers (editorial workflow C10.4, PLAN D16)", () => {
  it('is content of the draft: it moves the version and makes its writer a contributor', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const report = await reportOf(client, TENANT_A);
      const before = await cellOf(client, A.draft);
      await link(client, A.draft, report);
      expect(await cellOf(client, A.draft)).toMatchObject({
        draft_report_id: report,
        content_version: before.content_version + 1,
      });
      const { rows } = await client.query(
        `SELECT 1 FROM app.assessment_contributors
          WHERE assessment_id = $1 AND generation = $2 AND user_id = $3`,
        [A.draft, before.generation, USERS.countryAdminA],
      );
      expect(rows).toHaveLength(1);
      // Unlinking is an edit too.
      await link(client, A.draft, null);
      expect(await cellOf(client, A.draft)).toMatchObject({
        draft_report_id: null,
        content_version: before.content_version + 2,
      });
    });
  });

  it('is copied into the revision it publishes, privately, and the next draft starts without it', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      const report = await reportOf(client, TENANT_A);
      await client.query(
        `INSERT INTO app.assessment_revisions (assessment_id, reviewed_version)
         SELECT id, content_version FROM app.assessments WHERE id = $1`,
        [A.review],
      );
      await setActor(client, USERS.editorA);
      await client.query(
        `UPDATE app.assessments
            SET draft_change_kind = 'correction', draft_public_note = '{"es": "Nota de ejemplo"}', draft_report_id = $1
          WHERE id = $2`,
        [report, A.review],
      );
      await client.query(`UPDATE app.assessments SET state = 'in_review' WHERE id = $1`, [
        A.review,
      ]);
      await setActor(client, USERS.reviewerA);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO app.assessment_revisions (assessment_id, reviewed_version)
         SELECT id, content_version FROM app.assessments WHERE id = $1 RETURNING id`,
        [A.review],
      );
      expect(
        (
          await client.query('SELECT report_id FROM app.revision_internal WHERE revision_id = $1', [
            rows[0]!.id,
          ])
        ).rows,
      ).toEqual([{ report_id: report }]);
      expect(await cellOf(client, A.review)).toMatchObject({
        draft_report_id: null,
        generation: 2,
      });
      // The first revision answered no report.
      expect(
        (
          await client.query(
            `SELECT i.report_id FROM app.revision_internal i
               JOIN app.assessment_revisions v ON v.id = i.revision_id
              WHERE v.assessment_id = $1 ORDER BY v.revision_no`,
            [A.review],
          )
        ).rows,
      ).toEqual([{ report_id: null }, { report_id: report }]);
    });
  });

  it('is locked in review, like the rest of the draft', async () => {
    await actingAs(USERS.editorA, async (client) => {
      const report = await reportOf(client, TENANT_A);
      expect(await linkError(client, A.review, report)).toBe(RESTRICT_VIOLATION);
    });
  });

  it("is written only by the draft's editors, never by a reviewer or by a platform admin, who reads no report", async () => {
    for (const user of [USERS.reviewerA, USERS.platformAdmin]) {
      await actingAs(user, async (client) => {
        const report = await reportOf(client, TENANT_A);
        expect(await linkError(client, A.draft, report), user).toBe(INSUFFICIENT_PRIVILEGE);
      });
    }
  });

  it('is cleared only by someone who reads its report, never by a platform admin, who reads none', async () => {
    await actingAs(USERS.editorA, async (client) => {
      const report = await reportOf(client, TENANT_A);
      await link(client, A.draft, report);
      await setActor(client, USERS.platformAdmin);
      expect(await errorCode(client, linkSql(A.draft, null))).toBe(INSUFFICIENT_PRIVILEGE);
      await setActor(client, USERS.countryAdminA);
      await link(client, A.draft, null);
      expect(await cellOf(client, A.draft)).toMatchObject({ draft_report_id: null });
    });
  });

  it("names only a report of the cell's own election, and of its own site", async () => {
    await actingAs(USERS.editorA, async (client) => {
      // A report about A's archived election, sent as the public sends one.
      await client.query('RESET ROLE');
      await client.query('SET LOCAL ROLE aiontheballot_web');
      await client.query(`SELECT set_config('app.user_id', '', true)`);
      const { rows } = await client.query<{ id: string }>(
        `SELECT app.submit_report(tenant => $1, kind => 'error_report', message => 'Mensaje de ejemplo',
                                  election => $2) AS id`,
        [TENANT_A, ELECTIONS.archivedA.id],
      );
      await client.query('RESET ROLE');
      await client.query('SET LOCAL ROLE aiontheballot_admin');
      await setActor(client, USERS.editorA);
      expect(await linkError(client, A.draft, rows[0]!.id)).toBe(CHECK_VIOLATION);
      // Another site's report is one its editors can't read.
      expect(await linkError(client, A.draft, await reportOf(client, TENANT_B))).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    });
  });

  it("doesn't keep a site whose draft names a report from being purged", async () => {
    await inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'SELECT id FROM app.reports WHERE tenant_id = $1',
        [TENANT_A],
      );
      await setActor(client, USERS.editorA);
      await link(client, A.draft, rows[0]!.id);
      await client.query('SET LOCAL ROLE aiontheballot_owner');
      await client.query('SELECT private.purge_tenant($1)', [TENANT_A]);
      await client.query('RESET ROLE');
      // The deferred checks run now, as they would at commit.
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      expect(
        (
          await client.query(
            'SELECT count(*)::int AS n FROM app.assessments WHERE tenant_id = $1',
            [TENANT_A],
          )
        ).rows,
      ).toEqual([{ n: 0 }]);
    });
  });
});
