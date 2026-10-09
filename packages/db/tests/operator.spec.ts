import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { ORGANIZATIONS, TENANT_A, TENANT_INACTIVE, USERS } from './rls/matrix.js';

const CHECK_VIOLATION = '23514';

/** As the platform admin through the admin role, with deferred checks run at the end of each statement. */
const asPlatformAdmin = <T>(fn: (client: pg.Client) => Promise<T>, immediate = true): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    if (immediate) {
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    }
    await client.query('SET LOCAL ROLE aiontheballot_admin');
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
      [USERS.platformAdmin],
    );
    return fn(client);
  });

const NEW_TENANT = `INSERT INTO app.tenants (slug, country_code, default_locale, enabled_locales, display_name,
                                          methodology_kind, report_retention_days, active)
                    VALUES ('test-nuevo', 'XN', 'es', '{es}', '{"es": "Inquilino de prueba nuevo"}', 'demands', 365, true)
                    RETURNING id`;

describe('an active tenant has exactly one operator', () => {
  it('refuses to activate a tenant without one', async () => {
    expect(await asPlatformAdmin((c) => errorCode(c, NEW_TENANT))).toBe(CHECK_VIOLATION);
  });

  it('accepts a tenant created active with its operator in the same transaction', async () => {
    await asPlatformAdmin(async (client) => {
      const { rows } = await client.query<{ id: string }>(NEW_TENANT);
      await client.query(
        `INSERT INTO app.tenant_organizations (tenant_id, organization_id, role) VALUES ($1, $2, 'operator')`,
        [rows[0]?.id, ORGANIZATIONS.unlinked.id],
      );
      expect(await errorCode(client, 'SET CONSTRAINTS ALL IMMEDIATE')).toBeNull();
    }, false);
  });

  it("refuses to remove an active tenant's operator, or demote it", async () => {
    await asPlatformAdmin(async (client) => {
      const link = `tenant_id = '${TENANT_A}' AND organization_id = '${ORGANIZATIONS.A.id}'`;
      expect(await errorCode(client, `DELETE FROM app.tenant_organizations WHERE ${link}`)).toBe(
        CHECK_VIOLATION,
      );
      expect(
        await errorCode(
          client,
          `UPDATE app.tenant_organizations SET role = 'endorser' WHERE ${link}`,
        ),
      ).toBe(CHECK_VIOLATION);
    });
  });

  it('replaces the operator within one transaction, and audits the change', async () => {
    const log = await asPlatformAdmin(async (client) => {
      await client.query(
        `DELETE FROM app.tenant_organizations WHERE tenant_id = $1 AND organization_id = $2`,
        [TENANT_A, ORGANIZATIONS.A.id],
      );
      await client.query(
        `INSERT INTO app.tenant_organizations (tenant_id, organization_id, role) VALUES ($1, $2, 'operator')`,
        [TENANT_A, ORGANIZATIONS.unlinked.id],
      );
      expect(await errorCode(client, 'SET CONSTRAINTS ALL IMMEDIATE')).toBeNull();
      await client.query('RESET ROLE');
      return (
        await client.query<{ action: string; actor_id: string }>(
          `SELECT action, actor_id FROM app.audit_log
            WHERE table_name = 'tenant_organizations' AND tenant_id = $1 AND at = now() ORDER BY id`,
          [TENANT_A],
        )
      ).rows;
    }, false);
    expect(log).toEqual([
      { action: 'delete', actor_id: USERS.platformAdmin },
      { action: 'insert', actor_id: USERS.platformAdmin },
    ]);
  });

  it('lets an inactive tenant lose its operator, and refuses to activate it again without one', async () => {
    await asPlatformAdmin(async (client) => {
      expect(
        await errorCode(
          client,
          `DELETE FROM app.tenant_organizations WHERE tenant_id = '${TENANT_INACTIVE}'`,
        ),
      ).toBeNull();
      expect(
        await errorCode(
          client,
          `UPDATE app.tenants SET active = true WHERE id = '${TENANT_INACTIVE}'`,
        ),
      ).toBe(CHECK_VIOLATION);
    });
  });

  it("audits a platform admin's change of methodology kind", async () => {
    const log = await asPlatformAdmin(async (client) => {
      await client.query(`UPDATE app.tenants SET methodology_kind = 'descriptive' WHERE id = $1`, [
        TENANT_A,
      ]);
      await client.query('RESET ROLE');
      return (
        await client.query<{ diff: unknown; actor_id: string }>(
          `SELECT diff, actor_id FROM app.audit_log WHERE table_name = 'tenants' AND row_id = $1 AND at = now()`,
          [TENANT_A],
        )
      ).rows;
    });
    expect(log).toEqual([
      {
        diff: { old: { methodology_kind: 'demands' }, new: { methodology_kind: 'descriptive' } },
        actor_id: USERS.platformAdmin,
      },
    ]);
  });
});
