import type { DB } from '@aiontheballot/db/generated/db';

import { sql, type Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';

import { createHomeSource } from '../src/home-data.js';
import { inRolledBackTransaction } from './db.js';
import { TENANT_A } from './fixtures.js';

const asPublic = (trx: Transaction<DB>) => sql`SET LOCAL ROLE aiontheballot_web`.execute(trx);

describe("a site's home data", () => {
  it("holds the operator's legal fields and the latest published version of each policy text, never a draft", async () => {
    await inRolledBackTransaction(async (trx) => {
      await asPublic(trx);
      const home = await createHomeSource(trx)('test-a');
      expect(home?.operator).toMatchObject({ legalName: 'Organización de Ejemplo A', taxId: null });
      expect(Object.keys(home?.documents ?? {})).toEqual(['privacy_policy']);
      expect(home?.documents.privacy_policy).toMatchObject({
        body: { es: 'Política de privacidad de ejemplo' },
        version: 1,
      });
      expect(Date.parse(home?.documents.privacy_policy?.publishedAt ?? '')).not.toBeNaN();
    });
  });

  it('offers the signup list only when mail can be sent and the privacy policy is published', async () => {
    await inRolledBackTransaction(async (trx) => {
      await asPublic(trx);
      expect((await createHomeSource(trx)('test-a'))?.signups).toBe(false);
      expect((await createHomeSource(trx, { mail: true })('test-a'))?.signups).toBe(true);
      await sql`RESET ROLE`.execute(trx);
      await sql`DELETE FROM app.tenant_documents WHERE tenant_id = ${TENANT_A} AND published_at IS NOT NULL`.execute(
        trx,
      );
      await asPublic(trx);
      const home = await createHomeSource(trx, { mail: true })('test-a');
      expect(home?.signups).toBe(false);
      expect(home?.documents).toEqual({});
    });
  });

  it("offers it only when the emails' links have an address: the site's own hostname, or the platform's path", async () => {
    await inRolledBackTransaction(async (trx) => {
      await sql`UPDATE app.tenant_hostnames SET is_canonical = false WHERE hostname = 'test-a.example.test'`.execute(
        trx,
      );
      await asPublic(trx);
      expect((await createHomeSource(trx, { mail: true })('test-a'))?.signups).toBe(false);
      expect(
        (
          await createHomeSource(trx, { mail: true, platformHost: 'plataforma.example.test' })(
            'test-a',
          )
        )?.signups,
      ).toBe(true);
    });
  });

  it('is nothing for an inactive site', async () => {
    await inRolledBackTransaction(async (trx) => {
      await asPublic(trx);
      expect(await createHomeSource(trx, { mail: true })('test-inactive')).toBeUndefined();
    });
  });
});
