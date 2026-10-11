import type { DB } from '@aiontheballot/db/generated/db';

import { sql, type Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';

import {
  addHostname,
  createSite,
  getSite,
  listSites,
  setSiteActive,
  type SiteFields,
} from '../src/admin/sites.js';
import { inRolledBackTransaction } from './db.js';
import { UNLINKED_ORGANIZATION, USERS } from './fixtures.js';

/** As `userId` through the admin role, the way withActor sets it. */
const actAs = async (trx: Transaction<DB>, userId: string) => {
  await sql`SET LOCAL ROLE aiontheballot_admin`.execute(trx);
  await sql`SELECT set_config('app.user_id', ${userId}, true), set_config('app.aal', '2', true)`.execute(
    trx,
  );
};

/** A fictional demo site's fields: a user-assigned country code, which no country has. */
const FIELDS: SiteFields = {
  slug: 'sitio-de-prueba',
  name: { es: 'Sitio de prueba', en: 'Test site' },
  countryCode: 'XD',
  defaultLocale: 'es',
  enabledLocales: ['es', 'en'],
  methodologyKind: 'descriptive',
  operatorId: UNLINKED_ORGANIZATION,
  reportRetentionDays: 30,
};

/** The deferred check that an active site has an operator, run now rather than at a commit that never comes. */
const checkNow = (trx: Transaction<DB>) => sql`SET CONSTRAINTS ALL IMMEDIATE`.execute(trx);

describe('sites (PLAN R129)', () => {
  it('are created off by a platform admin, with their operator, and listed with what they hold', async () => {
    await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.platformAdmin);
      await createSite(trx, FIELDS);
      expect((await listSites(trx)).find(({ slug }) => slug === FIELDS.slug)).toEqual({
        slug: FIELDS.slug,
        name: FIELDS.name,
        defaultLocale: 'es',
        countryCode: 'XD',
        active: false,
        hostnames: [],
      });
      expect(await getSite(trx, FIELDS.slug)).toMatchObject({
        enabledLocales: ['es', 'en'],
        methodologyKind: 'descriptive',
        reportRetentionDays: 30,
        operator: { id: UNLINKED_ORGANIZATION },
      });
      expect(await getSite(trx, 'no-existe')).toBeUndefined();
    });
  });

  it.each([
    ['a country admin', USERS.countryAdminA],
    ['an editor', USERS.editorA],
  ])('are created by no one else: not %s', async (_name, user) => {
    await inRolledBackTransaction(async (trx) => {
      await actAs(trx, user);
      await expect(createSite(trx, FIELDS)).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('turn on with an operator, and the database refuses one on without', async () => {
    await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.platformAdmin);
      const { id } = await createSite(trx, FIELDS);
      expect(await setSiteActive(trx, id, true)).toBe(true);
      await checkNow(trx);
      expect((await getSite(trx, FIELDS.slug))?.active).toBe(true);
      await expect(
        sql`DELETE FROM app.tenant_organizations WHERE tenant_id = ${id}`.execute(trx),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  it('take addresses, the main one moving to the newest when asked, the old one staying theirs', async () => {
    await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.platformAdmin);
      const { id } = await createSite(trx, FIELDS);
      await addHostname(trx, id, 'prueba-uno.example.test', true);
      await addHostname(trx, id, 'prueba-alias.example.test', false);
      await addHostname(trx, id, 'prueba-dos.example.test', true);
      expect((await getSite(trx, FIELDS.slug))?.hostnames).toEqual([
        { hostname: 'prueba-dos.example.test', canonical: true, verified: true, retired: false },
        { hostname: 'prueba-alias.example.test', canonical: false, verified: true, retired: false },
        { hostname: 'prueba-uno.example.test', canonical: false, verified: true, retired: false },
      ]);
    });
  });

  it("never take another site's address, nor one the platform reserves", async () => {
    await inRolledBackTransaction(async (trx) => {
      await sql`INSERT INTO app.platform_hostnames (hostname) VALUES ('reservada.example.test')`.execute(
        trx,
      );
      await actAs(trx, USERS.platformAdmin);
      const { id } = await createSite(trx, FIELDS);
      await expect(addHostname(trx, id, 'test-a.example.test', false)).rejects.toMatchObject({
        code: '23505',
      });
    });
    await inRolledBackTransaction(async (trx) => {
      await sql`INSERT INTO app.platform_hostnames (hostname) VALUES ('reservada.example.test')`.execute(
        trx,
      );
      await actAs(trx, USERS.platformAdmin);
      const { id } = await createSite(trx, FIELDS);
      await expect(addHostname(trx, id, 'reservada.example.test', false)).rejects.toMatchObject({
        code: '23001',
      });
    });
  });

  it('are listed whole to a platform admin only: a member sees their own sites, with nothing to change', async () => {
    await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.editorA);
      expect((await listSites(trx)).map(({ slug }) => slug)).toEqual(['test-a']);
      const site = await getSite(trx, 'test-a');
      expect(site).toBeDefined();
      expect(await setSiteActive(trx, site?.id ?? '', false)).toBe(false);
    });
  });
});
