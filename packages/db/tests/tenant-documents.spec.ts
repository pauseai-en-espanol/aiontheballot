import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { TENANT_A, TENANT_B, TENANT_DOCUMENTS, USERS } from './rls/matrix.js';

const CHECK_VIOLATION = '23514';
const RESTRICT_VIOLATION = '23001';

const asCountryAdminA = <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await client.query('SET LOCAL ROLE aiontheballot_admin');
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
      [USERS.countryAdminA],
    );
    return fn(client);
  });

const draft = (tenant: string, kind: string, body = '{"es": "Texto de ejemplo"}'): string =>
  `INSERT INTO app.tenant_documents (tenant_id, kind, body, version) VALUES ('${tenant}', '${kind}', '${body}', 99)
   RETURNING version`;

describe('app.tenant_documents', () => {
  it('numbers versions per tenant and kind, whatever the caller sends', async () => {
    const versions = await inRolledBackTransaction(async (client) => {
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [USERS.platformAdmin]);
      const next = async (sql: string): Promise<number | undefined> =>
        (await client.query<{ version: number }>(sql)).rows[0]?.version;
      return [
        await next(draft(TENANT_A, 'privacy_policy')),
        await next(draft(TENANT_A, 'privacy_policy')),
        await next(draft(TENANT_A, 'about_operator')),
        await next(draft(TENANT_B, 'privacy_policy')),
      ];
    });
    expect(versions).toEqual([3, 4, 1, 2]);
  });

  it('publishes a draft at the transaction time, whatever time the caller sends', async () => {
    const [row] = await asCountryAdminA(
      async (client) =>
        (
          await client.query(
            `UPDATE app.tenant_documents SET published_at = '2000-01-01' WHERE id = $1
           RETURNING published_at = now() AS now`,
            [TENANT_DOCUMENTS.draftA.id],
          )
        ).rows,
    );
    expect(row).toEqual({ now: true });
  });

  it("refuses to publish without text in the tenant's default locale", async () => {
    const code = await asCountryAdminA(async (client) => {
      await client.query(
        `UPDATE app.tenant_documents SET body = '{"en": "Example text"}' WHERE id = $1`,
        [TENANT_DOCUMENTS.draftA.id],
      );
      return errorCode(
        client,
        `UPDATE app.tenant_documents SET published_at = now() WHERE id = '${TENANT_DOCUMENTS.draftA.id}'`,
      );
    });
    expect(code).toBe(CHECK_VIOLATION);
  });

  it('never changes a published version, not even as the owner', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query('SET LOCAL ROLE aiontheballot_owner');
      const published = `id = '${TENANT_DOCUMENTS.publishedA.id}'`;
      for (const set of [
        `body = '{"es": "Otro texto"}'`,
        'published_at = NULL',
        'published_at = now()',
      ]) {
        expect(
          await errorCode(client, `UPDATE app.tenant_documents SET ${set} WHERE ${published}`),
        ).toBe(RESTRICT_VIOLATION);
      }
    });
  });
});
