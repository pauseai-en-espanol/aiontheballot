import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { TENANT_A, USERS } from './rls/matrix.js';

const RESTRICT_VIOLATION = '23001';

interface AuditRow {
  tenant_id: string | null;
  actor_id: string | null;
  action: string;
  table_name: string;
  row_id: string;
  diff: unknown;
  now: boolean;
}

const auditOf = async (client: pg.Client, table: string): Promise<AuditRow[]> =>
  (
    await client.query<AuditRow>(
      `SELECT tenant_id, actor_id, action, table_name, row_id, diff, at = now() AS now
         FROM app.audit_log WHERE table_name = $1 ORDER BY id`,
      [table],
    )
  ).rows;

const actAs = async (client: pg.Client, userId: string): Promise<void> => {
  await client.query('SET LOCAL ROLE aiontheballot_admin');
  await client.query(
    `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
    [userId],
  );
};

describe('private.audit', () => {
  const setup = `
    CREATE TABLE app.probe_audited (tenant_id uuid, id int, note text, secret text, PRIMARY KEY (tenant_id, id));
    COMMENT ON COLUMN app.probe_audited.secret IS 'personal data';
    CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON app.probe_audited
      FOR EACH ROW EXECUTE FUNCTION private.audit();
    GRANT SELECT, INSERT, UPDATE, DELETE ON app.probe_audited TO aiontheballot_admin;`;
  const rowId = JSON.stringify({ id: 1, tenant_id: TENANT_A })
    .replaceAll(':', ': ')
    .replaceAll(',', ', ');

  it('logs each write with its tenant, actor, time, key and diff, never personal data', async () => {
    const log = await inRolledBackTransaction(async (client) => {
      await client.query(setup);
      await actAs(client, USERS.editorA);
      await client.query(`INSERT INTO app.probe_audited VALUES ($1, 1, 'a', 'Nombre Ejemplo')`, [
        TENANT_A,
      ]);
      await client.query(`UPDATE app.probe_audited SET note = 'b', secret = 'Otro Nombre'`);
      await client.query(`UPDATE app.probe_audited SET secret = 'Tercer Nombre'`);
      await client.query(`UPDATE app.probe_audited SET note = note`);
      await client.query(`DELETE FROM app.probe_audited`);
      await client.query('RESET ROLE');
      return auditOf(client, 'probe_audited');
    });
    const base = {
      tenant_id: TENANT_A,
      actor_id: USERS.editorA,
      table_name: 'probe_audited',
      row_id: rowId,
      now: true,
    };
    expect(log).toEqual([
      { ...base, action: 'insert', diff: { new: { tenant_id: TENANT_A, id: 1, note: 'a' } } },
      { ...base, action: 'update', diff: { old: { note: 'a' }, new: { note: 'b' } } },
      { ...base, action: 'update', diff: { old: {}, new: {} } },
      { ...base, action: 'delete', diff: { old: { tenant_id: TENANT_A, id: 1, note: 'b' } } },
    ]);
  });

  it('logs writes to tenants under the tenant itself, and platform-level rows with no tenant', async () => {
    const log = await inRolledBackTransaction(async (client) => {
      await actAs(client, USERS.countryAdminA);
      await client.query(`UPDATE app.tenants SET theme = '{"primary": "#123456"}' WHERE id = $1`, [
        TENANT_A,
      ]);
      await client.query('RESET ROLE');
      return {
        tenants: (await auditOf(client, 'tenants')).filter((r) => r.action === 'update'),
        platform: await auditOf(client, 'platform_admins'),
      };
    });
    expect(log.tenants).toEqual([
      {
        tenant_id: TENANT_A,
        actor_id: USERS.countryAdminA,
        action: 'update',
        table_name: 'tenants',
        row_id: TENANT_A,
        diff: { old: { theme: {} }, new: { theme: { primary: '#123456' } } },
        now: true,
      },
    ]);
    expect(log.platform.map((r) => [r.tenant_id, r.action, r.row_id])).toEqual([
      [null, 'insert', USERS.platformAdmin],
    ]);
  });

  it('cannot be changed or removed, even by the owner', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query('SET LOCAL ROLE aiontheballot_owner');
      expect(await errorCode(client, `UPDATE app.audit_log SET action = 'x'`)).toBe(
        RESTRICT_VIOLATION,
      );
      expect(await errorCode(client, 'DELETE FROM app.audit_log')).toBe(RESTRICT_VIOLATION);
      expect(await errorCode(client, 'TRUNCATE app.audit_log')).toBe(RESTRICT_VIOLATION);
    });
  });
});
