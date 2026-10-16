import type { DB } from '@aiontheballot/db/generated/db';

import { sql, type Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';

import { createHomeSource } from '../src/home-data.js';
import { inRolledBackTransaction } from './db.js';
import { ELECTIONS_A, TENANT_A } from './fixtures.js';

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

  it("carries the site's colours as the public role reads them, only those the site can draw (R178)", async () => {
    await inRolledBackTransaction(async (trx) => {
      await asPublic(trx);
      expect((await createHomeSource(trx)('test-a'))?.tenant.theme).toEqual({});
      await sql`RESET ROLE`.execute(trx);
      await sql`UPDATE app.tenants SET theme = '{"accent": "#1d3557"}' WHERE id = ${TENANT_A}`.execute(
        trx,
      );
      await asPublic(trx);
      expect((await createHomeSource(trx)('test-a'))?.tenant.theme).toEqual({ accent: '#1d3557' });
      // One written past the API that no text reads on, or a name the site doesn't use: the platform's instead.
      await sql`RESET ROLE`.execute(trx);
      await sql`UPDATE app.tenants SET theme = '{"accent": "#7a7a7a", "primary": "#123456"}' WHERE id = ${TENANT_A}`.execute(
        trx,
      );
      await asPublic(trx);
      expect((await createHomeSource(trx)('test-a'))?.tenant.theme).toEqual({});
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

  it('offers the right-of-reply form only while reports are taken and the privacy policy is published (R149)', async () => {
    await inRolledBackTransaction(async (trx) => {
      await asPublic(trx);
      // Not while the API takes no reports: their retention isn't enforced there.
      expect((await createHomeSource(trx)('test-a'))?.reports).toBe(false);
      expect((await createHomeSource(trx, { reports: true })('test-a'))?.reports).toBe(true);
      await sql`RESET ROLE`.execute(trx);
      await sql`DELETE FROM app.tenant_documents WHERE tenant_id = ${TENANT_A} AND published_at IS NOT NULL`.execute(
        trx,
      );
      await asPublic(trx);
      expect((await createHomeSource(trx, { reports: true })('test-a'))?.reports).toBe(false);
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

  it('lists the public elections, the live one first, never a draft', async () => {
    await inRolledBackTransaction(async (trx) => {
      await asPublic(trx);
      const home = await createHomeSource(trx)('test-a');
      expect(home?.elections.map(({ slug, status }) => ({ slug, status }))).toEqual([
        { slug: ELECTIONS_A.live.slug, status: 'live' },
        { slug: ELECTIONS_A.archived.slug, status: 'archived' },
      ]);
    });
  });

  it("lists an election in preview, as live, only in the preview's (PLAN R181)", async () => {
    await inRolledBackTransaction(async (trx) => {
      await sql`SET LOCAL ROLE aiontheballot_preview`.execute(trx);
      const previewed = await createHomeSource(trx, { preview: true })('test-a');
      // Both current ones have no date and were made at once: by slug.
      expect(previewed?.elections.map(({ slug, status }) => ({ slug, status }))).toEqual([
        { slug: ELECTIONS_A.preview.slug, status: 'live' },
        { slug: ELECTIONS_A.live.slug, status: 'live' },
        { slug: ELECTIONS_A.archived.slug, status: 'archived' },
      ]);
      // The public source never asks for one, whatever role reads it.
      const listed = await createHomeSource(trx)('test-a');
      expect(listed?.elections.map(({ slug }) => slug)).not.toContain(ELECTIONS_A.preview.slug);
    });
  });

  it('is nothing for an inactive site', async () => {
    await inRolledBackTransaction(async (trx) => {
      await asPublic(trx);
      expect(await createHomeSource(trx, { mail: true })('test-inactive')).toBeUndefined();
    });
  });
});
