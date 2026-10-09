import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { inRolledBackTransaction } from './db.js';
import { TENANT_A, TENANT_B, USERS } from './rls/matrix.js';

const versions = async (client: pg.Client): Promise<Record<string, number>> =>
  Object.fromEntries(
    (
      await client.query<{ tenant_id: string; version: string }>(
        'SELECT tenant_id, version FROM app.public_versions',
      )
    ).rows.map((r) => [r.tenant_id, Number(r.version)]),
  );

const actAs = async (client: pg.Client, userId: string): Promise<void> => {
  await client.query('SET LOCAL ROLE aiontheballot_admin');
  await client.query(
    `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
    [userId],
  );
};

describe('private.bump_public_version', () => {
  it("bumps the writer's tenant only, though the writer has no grant on public_versions", async () => {
    const [before, after] = await inRolledBackTransaction(async (client) => {
      const first = await versions(client);
      await actAs(client, USERS.countryAdminA);
      await client.query(`UPDATE app.tenants SET theme = '{"primary": "#123456"}' WHERE id = $1`, [
        TENANT_A,
      ]);
      await client.query('RESET ROLE');
      return [first, await versions(client)];
    });
    expect(after[TENANT_A]).toBe((before[TENANT_A] ?? 0) + 1);
    expect(after[TENANT_B]).toBe(before[TENANT_B]);
  });

  it("starts a new tenant's version on its first write", async () => {
    const version = await inRolledBackTransaction(async (client) => {
      await actAs(client, USERS.platformAdmin);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO app.tenants (slug, country_code, default_locale, enabled_locales, display_name,
                                  methodology_kind, report_retention_days)
         VALUES ('test-new', 'XN', 'es', '{es}', '{"es": "Inquilino de prueba nuevo"}', 'demands', 365)
         RETURNING id`,
      );
      await client.query('RESET ROLE');
      return (await versions(client))[rows[0]?.id ?? ''];
    });
    expect(version).toBe(1);
  });

  it('bumps on inserts, updates and deletes alike', async () => {
    const steps = await inRolledBackTransaction(async (client) => {
      await client.query(`
        CREATE TABLE app.probe_public (id int PRIMARY KEY, tenant_id uuid NOT NULL, note text);
        CREATE TRIGGER bump_public_version AFTER INSERT OR UPDATE OR DELETE ON app.probe_public
          FOR EACH ROW EXECUTE FUNCTION private.bump_public_version();`);
      const seen = [(await versions(client))[TENANT_B]];
      for (const sql of [
        `INSERT INTO app.probe_public VALUES (1, '${TENANT_B}', 'a')`,
        `UPDATE app.probe_public SET note = 'b'`,
        'DELETE FROM app.probe_public',
      ]) {
        await client.query(sql);
        seen.push((await versions(client))[TENANT_B]);
      }
      return seen;
    });
    const [start = 0] = steps;
    expect(steps).toEqual([start, start + 1, start + 2, start + 3]);
  });
});
