import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { FILES, TENANT_A, USERS } from './rls/matrix.js';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const RESTRICT_VIOLATION = '23001';

const asEditorA = <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await client.query('SET LOCAL ROLE aiontheballot_admin');
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
      [USERS.editorA],
    );
    return fn(client);
  });

const upload = (
  bucket: string,
  type: string,
  content: string,
  size = `octet_length(convert_to('${content}', 'UTF8'))`,
): string =>
  `INSERT INTO app.files (tenant_id, bucket, content_type, byte_size, sha256)
   VALUES ('${TENANT_A}', '${bucket}', '${type}', ${size}, encode(sha256(convert_to('${content}', 'UTF8')), 'hex'))
   RETURNING id, created_by`;

describe('app.files (the bytes live on the volume, under their hash)', () => {
  it('records the uploader from the session', async () => {
    await asEditorA(async (client) => {
      const { rows } = await client.query<{ id: string; created_by: string }>(
        upload('sources', 'text/plain', 'texto'),
      );
      expect(rows[0]?.created_by).toBe(USERS.editorA);
    });
  });

  it.each([
    [
      'a public asset that is not a PNG, JPEG or WebP image',
      upload('public_assets', 'image/svg+xml', 'svg'),
    ],
    ['a file over 50 MB', upload('sources', 'application/pdf', 'grande', '52428801')],
    ['a malformed content type', upload('sources', 'PDF', 'pdf')],
    [
      'a malformed hash',
      `INSERT INTO app.files (tenant_id, bucket, content_type, byte_size, sha256)
       VALUES ('${TENANT_A}', 'sources', 'application/pdf', 3, '../../x')`,
    ],
  ])('refuses %s', async (_name, sql) => {
    expect(await asEditorA((c) => errorCode(c, sql))).toBe(CHECK_VIOLATION);
  });

  it('stores the same content once per tenant and bucket', async () => {
    await asEditorA(async (client) => {
      expect(
        await errorCode(client, upload('sources', 'application/pdf', FILES.sourceA.content)),
      ).toBe(UNIQUE_VIOLATION);
      expect(
        await errorCode(client, upload('public_assets', 'image/png', FILES.sourceA.content)),
      ).toBeNull();
    });
  });

  it('never changes a stored file, not even as the owner', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query('SET LOCAL ROLE aiontheballot_owner');
      expect(
        await errorCode(
          client,
          `UPDATE app.files SET original_filename = 'x' WHERE id = '${FILES.sourceA.id}'`,
        ),
      ).toBe(RESTRICT_VIOLATION);
    });
  });

  it('lets an editor delete a file nothing references', async () => {
    const left = await asEditorA(async (client) => {
      await client.query(`DELETE FROM app.files WHERE id = $1`, [FILES.unusedImageA.id]);
      return (await client.query(`SELECT 1 FROM app.files WHERE id = $1`, [FILES.unusedImageA.id]))
        .rowCount;
    });
    expect(left).toBe(0);
  });
});
