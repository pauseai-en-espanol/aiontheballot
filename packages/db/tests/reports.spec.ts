import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { CELLS, ELECTIONS, TENANT_A, TENANT_B, TENANT_INACTIVE, USERS } from './rls/matrix.js';

const CHECK_VIOLATION = '23514';
const RESTRICT_VIOLATION = '23001';
const INSUFFICIENT_PRIVILEGE = '42501';
const INVALID_PARAMETER_VALUE = '22023';
const PROGRAM_LIMIT_EXCEEDED = '54000';

const setActor = async (client: pg.Client, userId: string): Promise<void> => {
  await client.query(
    `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
    [userId],
  );
};

/** As `userId` through the admin role, in a transaction that is rolled back. */
const actingAs = <T>(userId: string, fn: (client: pg.Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await client.query('SET LOCAL ROLE aiontheballot_admin');
    await setActor(client, userId);
    return fn(client);
  });

const asRole = <T>(role: string, fn: (client: pg.Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await client.query(`SET LOCAL ROLE ${role}`);
    return fn(client);
  });

const submit = (
  values: Partial<Record<'tenant' | 'election' | 'assessment' | 'email' | 'message', string>> = {},
): string => {
  const args = {
    tenant: `'${TENANT_A}'`,
    kind: `'error_report'`,
    message: `'Mensaje de ejemplo sobre una celda'`,
    election: `'${ELECTIONS.liveA.id}'`,
    assessment: `'${CELLS.A.review}'`,
    name: `'Persona de Ejemplo'`,
    email: `'  Persona@Example.ORG '`,
    ...values,
  };
  return `SELECT app.submit_report(${Object.entries(args)
    .map(([key, value]) => `${key} => ${value}`)
    .join(', ')}) AS id`;
};

const report = async (client: pg.Client, where = `tenant_id = '${TENANT_A}'`) =>
  (
    await client.query<Record<string, unknown>>(
      `SELECT status, name, email, organization, message, resolution_note, triaged_by, anonymized_at IS NOT NULL AS anonymized
         FROM app.reports WHERE ${where}`,
    )
  ).rows[0];

const ERASURE = `name = NULL, email = NULL, organization = NULL, message = NULL, resolution_note = NULL,
                 anonymized_at = now()`;

describe('submitting a report', () => {
  it('records a new report from the public, its email lowercased, to anonymize after the retention period', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query('SET LOCAL ROLE aiontheballot_web');
      const { rows } = await client.query<{ id: string }>(submit());
      await client.query('RESET ROLE');
      const { rows: stored } = await client.query(
        `SELECT status, email, anonymize_after = (now() AT TIME ZONE 'UTC')::date + 365 AS retained,
                created_at = now() AS now
           FROM app.reports WHERE id = $1`,
        [rows[0]!.id],
      );
      expect(stored).toEqual([
        { status: 'new', email: 'persona@example.org', retained: true, now: true },
      ]);
    });
  });

  it.each([
    [
      'for an inactive tenant',
      { tenant: `'${TENANT_INACTIVE}'`, election: 'NULL', assessment: 'NULL' },
    ],
    ['about a draft election', { election: `'${ELECTIONS.draftA.id}'`, assessment: 'NULL' }],
    [
      "about another tenant's election",
      { election: `'${ELECTIONS.liveB.id}'`, assessment: 'NULL' },
    ],
    ['about a cell of another election', { election: `'${ELECTIONS.archivedA.id}'` }],
  ])('is refused %s', async (_name, values) => {
    expect(await asRole('aiontheballot_web', (c) => errorCode(c, submit(values)))).toBe(
      INVALID_PARAMETER_VALUE,
    );
  });

  it.each([
    ['an email that is not one', { email: `'no es un correo'` }],
    ['an empty message', { message: `'   '` }],
  ])('is refused with %s', async (_name, values) => {
    expect(await asRole('aiontheballot_web', (c) => errorCode(c, submit(values)))).toBe(
      CHECK_VIOLATION,
    );
  });

  it("stops at the tenant's daily cap", async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(
        `INSERT INTO app.report_daily_counts (tenant_id, day, count) VALUES ($1, (now() AT TIME ZONE 'UTC')::date, 200)
         ON CONFLICT (tenant_id, day) DO UPDATE SET count = 200`,
        [TENANT_A],
      );
      await client.query('SET LOCAL ROLE aiontheballot_web');
      expect(await errorCode(client, submit())).toBe(PROGRAM_LIMIT_EXCEEDED);
    });
  });

  it('is the only way a report is written: even the owner inserts only new ones', async () => {
    expect(
      await asRole('aiontheballot_owner', (c) =>
        errorCode(
          c,
          `INSERT INTO app.reports (tenant_id, kind, message, status, anonymize_after)
           VALUES ('${TENANT_A}', 'error_report', 'Mensaje de ejemplo', 'triaged', current_date + 1)`,
        ),
      ),
    ).toBe(RESTRICT_VIOLATION);
  });

  it.each(['aiontheballot_admin', 'aiontheballot_worker'])('is not open to %s', async (role) => {
    expect(await asRole(role, (c) => errorCode(c, submit()))).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('never puts personal data in the audit log', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query('SET LOCAL ROLE aiontheballot_web');
      const { rows } = await client.query<{ id: string }>(submit());
      await client.query('RESET ROLE');
      const { rows: logged } = await client.query<{ keys: string[] }>(
        `SELECT ARRAY(SELECT jsonb_object_keys(diff -> 'new')) AS keys FROM app.audit_log
          WHERE table_name = 'reports' AND row_id = $1`,
        [rows[0]!.id],
      );
      expect(logged).toHaveLength(1);
      expect(logged[0]!.keys).not.toContain('email');
      expect(logged[0]!.keys).not.toContain('message');
    });
  });
});

describe('triaging a report', () => {
  it('goes from new to triaged, recording who and when, then to a decision', async () => {
    await actingAs(USERS.editorA, async (client) => {
      const { rows } = await client.query(
        `UPDATE app.reports SET status = 'triaged' WHERE tenant_id = $1 RETURNING triaged_by, triaged_at = now() AS now`,
        [TENANT_A],
      );
      expect(rows).toEqual([{ triaged_by: USERS.editorA, now: true }]);
      await setActor(client, USERS.reviewerA);
      await client.query(
        `UPDATE app.reports SET status = 'accepted', resolution_note = 'Corregido' WHERE tenant_id = $1`,
        [TENANT_A],
      );
      expect(await report(client)).toMatchObject({ status: 'accepted', triaged_by: USERS.editorA });
    });
  });

  it.each([
    ['new to accepted', [`status = 'accepted'`]],
    ['triaged back to new', [`status = 'triaged'`, `status = 'new'`]],
    ['once decided', [`status = 'triaged'`, `status = 'spam'`, `status = 'rejected'`]],
    ['in what was sent', [`message = 'Otro mensaje'`]],
  ])('changes nothing %s', async (_name, steps) => {
    expect(
      await actingAs(USERS.editorA, async (client) => {
        for (const set of steps.slice(0, -1)) {
          await client.query(`UPDATE app.reports SET ${set} WHERE tenant_id = $1`, [TENANT_A]);
        }
        return errorCode(
          client,
          `UPDATE app.reports SET ${steps.at(-1)} WHERE tenant_id = '${TENANT_A}'`,
        );
      }),
    ).toBe(RESTRICT_VIOLATION);
  });

  it('goes on once its election is archived', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      await client.query(`UPDATE app.elections SET status = 'archived' WHERE id = $1`, [
        ELECTIONS.liveA.id,
      ]);
      expect(
        await errorCode(
          client,
          `UPDATE app.reports SET status = 'triaged' WHERE tenant_id = '${TENANT_A}'`,
        ),
      ).toBeNull();
    });
  });

  it('is never open to platform admins, who cannot even read reports', async () => {
    await actingAs(USERS.platformAdmin, async (client) => {
      expect((await client.query('SELECT 1 FROM app.reports')).rowCount).toBe(0);
      expect((await client.query(`UPDATE app.reports SET status = 'triaged'`)).rowCount).toBe(0);
    });
  });
});

describe('anonymizing a report', () => {
  it('by a country admin sets every personal-data column to null at once, at the transaction time', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const { rows } = await client.query(
        `UPDATE app.reports SET ${ERASURE} WHERE tenant_id = $1 RETURNING anonymized_at = now() AS now`,
        [TENANT_A],
      );
      expect(rows).toEqual([{ now: true }]);
      expect(await report(client)).toEqual({
        status: 'new',
        name: null,
        email: null,
        organization: null,
        message: null,
        resolution_note: null,
        triaged_by: null,
        anonymized: true,
      });
    });
  });

  it('takes its time from the transaction, whatever the caller sends', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const { rows } = await client.query(
        `UPDATE app.reports SET ${ERASURE.replace('now()', `'2000-01-01'`)} WHERE tenant_id = $1
         RETURNING anonymized_at = now() AS now`,
        [TENANT_A],
      );
      expect(rows).toEqual([{ now: true }]);
    });
  });

  it('is refused to editors and reviewers', async () => {
    const codes = await Promise.all(
      [USERS.editorA, USERS.reviewerA].map((user) =>
        actingAs(user, (c) =>
          errorCode(c, `UPDATE app.reports SET ${ERASURE} WHERE tenant_id = '${TENANT_A}'`),
        ),
      ),
    );
    expect(codes).toEqual([INSUFFICIENT_PRIVILEGE, INSUFFICIENT_PRIVILEGE]);
  });

  it.each([
    [
      'keeping a personal-data column',
      `name = NULL, message = NULL, organization = NULL, anonymized_at = now()`,
    ],
    ['changing the status too', `${ERASURE}, status = 'triaged'`],
  ])('is refused %s', async (_name, set) => {
    expect(
      await actingAs(USERS.countryAdminA, (c) =>
        errorCode(c, `UPDATE app.reports SET ${set} WHERE tenant_id = '${TENANT_A}'`),
      ),
    ).toBe(RESTRICT_VIOLATION);
  });

  it('is for good, while the report can still be triaged', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      await client.query(`UPDATE app.reports SET ${ERASURE} WHERE tenant_id = $1`, [TENANT_A]);
      for (const set of [
        `email = 'otra@example.org'`,
        'anonymized_at = NULL',
        `resolution_note = 'Nota'`,
      ]) {
        expect(
          await errorCode(client, `UPDATE app.reports SET ${set} WHERE tenant_id = '${TENANT_A}'`),
        ).toBe(RESTRICT_VIOLATION);
      }
      expect(
        await errorCode(
          client,
          `UPDATE app.reports SET status = 'triaged' WHERE tenant_id = '${TENANT_A}'`,
        ),
      ).toBeNull();
    });
  });

  it('happens daily, run by the worker only, for reports past their retention', async () => {
    await inRolledBackTransaction(async (client) => {
      // A report sent long ago: its dates are set with the triggers off.
      await client.query('SET LOCAL session_replication_role = replica');
      await client.query(
        `UPDATE app.reports SET anonymize_after = (now() AT TIME ZONE 'UTC')::date WHERE tenant_id = $1`,
        [TENANT_B],
      );
      // And one already anonymized on request, which the run leaves alone.
      await client.query(
        `UPDATE app.reports SET anonymize_after = (now() AT TIME ZONE 'UTC')::date, name = NULL, email = NULL,
                                organization = NULL, message = NULL, resolution_note = NULL,
                                anonymized_at = now() - interval '1 day'
          WHERE tenant_id = $1`,
        [TENANT_INACTIVE],
      );
      await client.query('SET LOCAL session_replication_role = origin');
      await client.query('SET LOCAL ROLE aiontheballot_admin');
      expect(await errorCode(client, 'SELECT private.anonymize_expired_reports()')).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
      await client.query('SET LOCAL ROLE aiontheballot_worker');
      const { rows } = await client.query<{ n: number }>(
        'SELECT private.anonymize_expired_reports() AS n',
      );
      expect(rows).toEqual([{ n: 1 }]);
      await client.query('RESET ROLE');
      expect(await report(client, `tenant_id = '${TENANT_B}'`)).toMatchObject({
        email: null,
        anonymized: true,
      });
      expect(await report(client)).toMatchObject({ anonymized: false });
    });
  });
});
