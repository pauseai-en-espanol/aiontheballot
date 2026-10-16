import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { fileKey, parseSweepInput, SWEEP_LIST_QUERY } from '../src/file-sweep.js';
import { errorCode, inRolledBackTransaction, RUNTIME_ROLES } from './db.js';
import { BRAND_ASSETS, FILES, TENANT_A, USERS } from './rls/matrix.js';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const LIST = SWEEP_LIST_QUERY;
const INSUFFICIENT_PRIVILEGE = '42501';

describe("the sweep's list of named files", () => {
  it('names every file row and brand asset, and when a row last stopped naming each key, from one snapshot', async () => {
    const result = await inRolledBackTransaction(async (client) => {
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [USERS.platformAdmin]);
      // A file row deleted, and a brand asset given other bytes: both stop naming their old bytes.
      await client.query('DELETE FROM app.files WHERE id = $1', [FILES.unusedImageA.id]);
      const asset = BRAND_ASSETS.shared;
      const { rows: before } = await client.query<{ sha256: string }>(
        'SELECT sha256 FROM app.brand_assets WHERE id = $1',
        [asset.id],
      );
      await client.query(`UPDATE app.brand_assets SET sha256 = $1 WHERE id = $2`, [
        sha256('otra marca de ejemplo'),
        asset.id,
      ]);
      // Renamed, keeping its bytes: nothing stopped naming anything.
      await client.query(
        `UPDATE app.brand_assets SET name = 'Marca de ejemplo renombrada' WHERE id = $1`,
        [BRAND_ASSETS.unused.id],
      );
      // As the scheduled sweep reads it: its own login, which RLS would show nothing, through its one function.
      await client.query('SET LOCAL ROLE aiontheballot_sweeper');
      const listed = await client.query<{ line: string }>(LIST);
      await client.query('RESET ROLE');
      const { rows: identity } = await client.query<{
        cluster: string;
        database: string;
        audit: string;
      }>(
        `SELECT (SELECT to_hex(system_identifier) FROM pg_control_system()) AS cluster,
                (SELECT oid FROM pg_database WHERE datname = current_database())::text AS database,
                'app.audit_log'::regclass::oid::text AS audit`,
      );
      const { rows } = await client.query<{ files: string; assets: string }>(
        'SELECT (SELECT count(*) FROM app.files) AS files, (SELECT count(*) FROM app.brand_assets) AS assets',
      );
      return {
        identity: identity[0]!,
        oldAsset: before[0]!.sha256,
        text: listed.rows.map((row) => row.line).join('\n'),
        rows: Number(rows[0]!.files) + Number(rows[0]!.assets),
      };
    });
    const input = parseSweepInput(result.text);
    const lines = result.text.split('\n');
    expect(
      lines.filter((line) => !line.startsWith('deleted ') && !line.startsWith('end ')),
    ).toHaveLength(result.rows);
    expect(
      input.named.has(
        fileKey({ tenantId: TENANT_A, bucket: 'sources' }, sha256(FILES.sourceA.content)),
      ),
    ).toBe(true);
    const deletedFile = fileKey(
      { tenantId: TENANT_A, bucket: 'public_assets' },
      sha256(FILES.unusedImageA.content),
    );
    expect(input.named.has(deletedFile)).toBe(false);
    expect([...input.deletedAt.keys()].sort()).toEqual(
      [deletedFile, `platform/${result.oldAsset}`].sort(),
    );
    for (const key of [deletedFile, `platform/${result.oldAsset}`]) {
      expect(Math.abs((input.deletedAt.get(key)?.getTime() ?? 0) - Date.now()), key).toBeLessThan(
        60_000,
      );
    }
    expect(Math.abs(input.snapshot.getTime() - Date.now())).toBeLessThan(60_000);
    expect(input.auditSequence).toBeGreaterThan(0);
    // The cluster, its timeline, the database and the audit table: what a restore changes.
    const [cluster, timeline, database, audit] = input.incarnation.split('-');
    // The cluster's id in hex, so one made after 2038 (a negative id) still reads as one word.
    expect(cluster).toBe(result.identity.cluster);
    expect(timeline).toMatch(/^\d+$/);
    expect([database, audit]).toEqual([result.identity.database, result.identity.audit]);
  });

  it.each([
    // The function runs as the tables' owner, whom RLS filters only if a table forces it.
    ['a table forcing row security on its owner', 'ALTER TABLE app.files FORCE ROW LEVEL SECURITY'],
    // Or a table owned by someone else, whose RLS applies to the function's owner.
    [
      'a table owned by another role',
      'ALTER TABLE app.brand_assets OWNER TO postgres; GRANT SELECT ON app.brand_assets TO aiontheballot_owner',
    ],
  ])('says so when it may have left rows out: %s', async (_case, change) => {
    const text = await inRolledBackTransaction(async (client) => {
      await client.query(change);
      await client.query('SET LOCAL ROLE aiontheballot_sweeper');
      const listed = await client.query<{ line: string }>(LIST);
      return listed.rows.map((row) => row.line).join('\n');
    });
    expect(text).toMatch(/ false$/);
    expect(() => parseSweepInput(text)).toThrow('row security on');
  });

  it('gives a superuser the same list by hand, as the manual sweep reads it', async () => {
    const [bySweeper, byHand] = await inRolledBackTransaction(async (client) => {
      await client.query('SET LOCAL ROLE aiontheballot_sweeper');
      const first = await client.query<{ line: string }>(LIST);
      await client.query('RESET ROLE');
      const second = await client.query<{ line: string }>(LIST);
      return [first.rows, second.rows].map((list) => list.map((row) => row.line).join('\n'));
    });
    const [sweeper, hand] = [parseSweepInput(bySweeper ?? ''), parseSweepInput(byHand ?? '')];
    expect([...hand.named].sort()).toEqual([...sweeper.named].sort());
    expect([...hand.deletedAt.keys()].sort()).toEqual([...sweeper.deletedAt.keys()].sort());
    expect(hand.incarnation).toBe(sweeper.incarnation);
  });

  it.each(RUNTIME_ROLES.filter((role) => role !== 'aiontheballot_sweeper'))(
    'is nobody else’s to read: %s',
    async (role) => {
      const code = await inRolledBackTransaction(async (client) => {
        await client.query(`SET LOCAL ROLE ${role}`);
        return errorCode(client, LIST);
      });
      expect(code).toBe(INSUFFICIENT_PRIVILEGE);
    },
  );
});
