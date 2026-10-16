import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction, RUNTIME_ROLES } from './db.js';
import { HOSTNAMES, ORGANIZATIONS, TENANT_A, TENANT_B, USERS } from './rls/matrix.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const OBJECT_IN_USE = '55006';

/** Rows of `tenant` in every table of app with a tenant_id (tenants itself by id), as { table: count }. */
const rowsOf = async (client: pg.Client, tenant: string): Promise<Record<string, number>> => {
  const { rows: tables } = await client.query<{ name: string; column: string }>(
    `SELECT c.relname AS name, a.attname AS column
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p') AND NOT a.attisdropped
        AND (a.attname = 'tenant_id' OR (c.relname = 'tenants' AND a.attname = 'id'))
      ORDER BY 1`,
  );
  const counts: Record<string, number> = {};
  for (const { name, column } of tables) {
    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM app.${name} WHERE ${column} = $1`,
      [tenant],
    );
    counts[name] = Number(rows[0]!.n);
  }
  return counts;
};

const purge = (tenant: string): string => `SELECT private.purge_tenant('${tenant}') AS id`;

describe('purging a tenant', () => {
  it("deletes every row of it, keeps its hostnames as tombstones, records it, and leaves other tenants' rows alone", async () => {
    await inRolledBackTransaction(async (client) => {
      // An endorser shared with A, which a purge of B must not offer for removal.
      await client.query(
        `INSERT INTO app.tenant_organizations (tenant_id, organization_id, role) VALUES ($1, $3, 'endorser'), ($2, $3, 'endorser')`,
        [TENANT_A, TENANT_B, ORGANIZATIONS.unlinked.id],
      );
      const before = await rowsOf(client, TENANT_A);
      const platformAudit = await client.query(
        'SELECT count(*) FROM app.audit_log WHERE tenant_id IS NULL',
      );
      expect(Object.values(await rowsOf(client, TENANT_B)).some((n) => n > 0)).toBe(true);

      await client.query('SET LOCAL ROLE aiontheballot_owner');
      const { rows } = await client.query<{ id: string }>(purge(TENANT_B));
      await client.query('RESET ROLE');
      // The deferred checks (an active tenant's operator, restricted assets) run now, as they would at commit.
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');

      expect(Object.entries(await rowsOf(client, TENANT_B)).filter(([, n]) => n > 0)).toEqual([]);
      expect(await rowsOf(client, TENANT_A)).toEqual(before);
      expect(
        (await client.query('SELECT count(*) FROM app.audit_log WHERE tenant_id IS NULL')).rows,
      ).toEqual(platformAudit.rows);
      const hostnames = HOSTNAMES.filter((h) => h.tenant === 'B').map((h) => h.hostname);
      expect(
        (
          await client.query(
            'SELECT hostname FROM app.hostname_tombstones WHERE hostname = ANY ($1)',
            [hostnames],
          )
        ).rowCount,
      ).toBe(hostnames.length);
      const { rows: log } = await client.query(
        `SELECT purged_tenant_id, purged_tenant_slug, counts ->> 'tenants' AS tenants, counts ->> 'reports' AS reports,
                leftovers
           FROM app.purge_log WHERE id = $1`,
        [rows[0]!.id],
      );
      expect(log).toEqual([
        {
          purged_tenant_id: TENANT_B,
          purged_tenant_slug: 'test-b',
          tenants: '1',
          reports: '1',
          // Its operator serves no other tenant; of its members, only its country admin has no other membership.
          leftovers: { organizations: [ORGANIZATIONS.B.id], users: [USERS.countryAdminB] },
        },
      ]);
    });
  });

  it('refuses to finish while a table it does not list still holds rows of the tenant', async () => {
    expect(
      await inRolledBackTransaction(async (client) => {
        await client.query('SET LOCAL ROLE aiontheballot_owner');
        await client.query(`CREATE TABLE app.probe_unlisted (id int PRIMARY KEY, tenant_id uuid NOT NULL);
                            INSERT INTO app.probe_unlisted VALUES (1, '${TENANT_B}')`);
        return errorCode(client, purge(TENANT_B));
      }),
    ).toBe(OBJECT_IN_USE);
  });

  it('is recorded for platform admins only', async () => {
    const seen = await inRolledBackTransaction(async (client) => {
      await client.query('SET LOCAL ROLE aiontheballot_owner');
      await client.query(purge(TENANT_B));
      await client.query('SET LOCAL ROLE aiontheballot_admin');
      const count = async (user: string) => {
        await client.query(
          `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
          [user],
        );
        return (await client.query('SELECT 1 FROM app.purge_log')).rowCount;
      };
      return [await count(USERS.platformAdmin), await count(USERS.countryAdminA)];
    });
    expect(seen).toEqual([1, 0]);
  });

  it.each(RUNTIME_ROLES)('is never run by %s', async (role) => {
    expect(
      await inRolledBackTransaction(async (client) => {
        await client.query(`SET LOCAL ROLE ${role}`);
        return errorCode(client, purge(TENANT_B));
      }),
    ).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('cannot be faked by a runtime role: with app.purge set, its writes are still audited and counted', async () => {
    await inRolledBackTransaction(async (client) => {
      const versions = async () =>
        (
          await client.query<{ version: string }>(
            'SELECT version FROM app.public_versions WHERE tenant_id = $1',
            [TENANT_A],
          )
        ).rows[0]?.version;
      const before = await versions();
      // A session that logged in as the admin role, not one that only switched to it.
      await client.query('SET LOCAL SESSION AUTHORIZATION aiontheballot_admin');
      await client.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true),
                set_config('app.purge', 'on', true)`,
        [USERS.countryAdminA],
      );
      await client.query(`UPDATE app.tenants SET theme = '{"primary": "#654321"}' WHERE id = $1`, [
        TENANT_A,
      ]);
      await client.query('RESET SESSION AUTHORIZATION');
      expect(
        (
          await client.query(
            `SELECT actor_id FROM app.audit_log WHERE table_name = 'tenants' AND row_id = $1 AND at = now()`,
            [TENANT_A],
          )
        ).rows,
      ).toEqual([{ actor_id: USERS.countryAdminA }]);
      expect(Number(await versions())).toBe(Number(before) + 1);
    });
  });
});
