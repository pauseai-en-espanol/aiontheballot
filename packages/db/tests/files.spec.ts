import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { FILES, TENANT_A, TENANT_B, USERS } from './rls/matrix.js';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
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

describe('app.files and app.file_blobs', () => {
  it('records the uploader from the session, and stores the bytes that match the hash and size', async () => {
    await asEditorA(async (client) => {
      const { rows } = await client.query<{ id: string; created_by: string }>(
        upload('sources', 'text/plain', 'texto'),
      );
      expect(rows[0]?.created_by).toBe(USERS.editorA);
      const blob = (content: string): Promise<string | null> =>
        errorCode(
          client,
          `INSERT INTO app.file_blobs (file_id, tenant_id, content) VALUES ('${rows[0]?.id}', '${TENANT_A}', convert_to('${content}', 'UTF8'))`,
        );
      expect(await blob('textx')).toBe(CHECK_VIOLATION); // same size, other bytes
      expect(await blob('texto')).toBeNull();
    });
  });

  it('refuses bytes whose size differs from the recorded one, even with the right hash', async () => {
    await asEditorA(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        upload('sources', 'text/plain', 'texto', '6'),
      );
      expect(
        await errorCode(
          client,
          `INSERT INTO app.file_blobs (file_id, tenant_id, content) VALUES ('${rows[0]?.id}', '${TENANT_A}', convert_to('texto', 'UTF8'))`,
        ),
      ).toBe(CHECK_VIOLATION);
    });
  });

  it.each([
    [
      'a public asset that is not a PNG, JPEG or WebP image',
      upload('public_assets', 'image/svg+xml', 'svg'),
    ],
    ['a file over 50 MB', upload('sources', 'application/pdf', 'grande', '52428801')],
    ['a malformed content type', upload('sources', 'PDF', 'pdf')],
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

  it("never pairs a file with another tenant's bytes", async () => {
    const code = await inRolledBackTransaction((client) =>
      errorCode(
        client,
        `INSERT INTO app.file_blobs (file_id, tenant_id, content)
         VALUES ('${FILES.awaitingA.id}', '${TENANT_B}', convert_to('${FILES.awaitingA.content}', 'UTF8'))`,
      ),
    );
    expect(code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it('never changes a stored file or its bytes, not even as the owner', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query('SET LOCAL ROLE aiontheballot_owner');
      expect(
        await errorCode(
          client,
          `UPDATE app.files SET original_filename = 'x' WHERE id = '${FILES.sourceA.id}'`,
        ),
      ).toBe(RESTRICT_VIOLATION);
      expect(
        await errorCode(
          client,
          `UPDATE app.file_blobs SET content = content WHERE file_id = '${FILES.sourceA.id}'`,
        ),
      ).toBe(RESTRICT_VIOLATION);
      expect(
        await errorCode(client, `DELETE FROM app.file_blobs WHERE file_id = '${FILES.sourceA.id}'`),
      ).toBe(RESTRICT_VIOLATION);
    });
  });

  it('removes the bytes with the file, when an editor deletes an unreferenced file', async () => {
    const left = await asEditorA(async (client) => {
      await client.query(`DELETE FROM app.files WHERE id = $1`, [FILES.unusedImageA.id]);
      await client.query('RESET ROLE');
      return (
        await client.query(`SELECT 1 FROM app.file_blobs WHERE file_id = $1`, [
          FILES.unusedImageA.id,
        ])
      ).rowCount;
    });
    expect(left).toBe(0);
  });
});
