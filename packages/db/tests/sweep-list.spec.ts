import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { fileKey, parseSweepInput, SWEEP_LIST_SQL } from '../src/file-sweep.js';
import { inRolledBackTransaction } from './db.js';
import { FILES, TENANT_A, USERS } from './rls/matrix.js';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** The query inside its COPY, so it runs as a plain query: what the owner's psql prints, line by line. */
const LIST = SWEEP_LIST_SQL.replace(/^COPY \(/, '').replace(/\) TO STDOUT$/, '');

describe("the sweep's list of named files", () => {
  it('names every file row and brand asset, and the last deletion of every deleted one, from one snapshot', async () => {
    const lines = await inRolledBackTransaction(async (client) => {
      await client.query('SET LOCAL row_security = off');
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [USERS.platformAdmin]);
      const { rows } = await client.query<{ sha256: string }>(
        'DELETE FROM app.files WHERE id = $1 RETURNING sha256',
        [FILES.unusedImageA.id],
      );
      const listed = await client.query<{ line: string }>(LIST);
      return { deleted: rows[0]!.sha256, text: listed.rows.map((row) => row.line).join('\n') };
    });
    const input = parseSweepInput(lines.text);
    const { rows: counts } = await inRolledBackTransaction((client) =>
      client.query<{ files: string; assets: string }>(
        'SELECT (SELECT count(*) FROM app.files) AS files, (SELECT count(*) FROM app.brand_assets) AS assets',
      ),
    );
    // Every file but the one deleted, and every brand asset (some share a hash).
    expect(input.named.size).toBeLessThanOrEqual(
      Number(counts[0]!.files) - 1 + Number(counts[0]!.assets),
    );
    expect(
      input.named.has(
        fileKey({ tenantId: TENANT_A, bucket: 'sources' }, sha256(FILES.sourceA.content)),
      ),
    ).toBe(true);
    expect([...input.named].some((key) => key.startsWith('platform/'))).toBe(true);
    const deletedKey = fileKey({ tenantId: TENANT_A, bucket: 'public_assets' }, lines.deleted);
    expect(input.named.has(deletedKey)).toBe(false);
    expect(Math.abs((input.deletedAt.get(deletedKey)?.getTime() ?? 0) - Date.now())).toBeLessThan(
      60_000,
    );
    expect(Math.abs(input.snapshot.getTime() - Date.now())).toBeLessThan(60_000);
  });
});
