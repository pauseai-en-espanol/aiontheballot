import type { DB } from '@aiontheballot/db/generated/db';

import { sql, type Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';

import {
  createOrganization,
  getOrganization,
  listOrganizations,
  type OrganizationFields,
  platformLanguages,
  updateOrganization,
} from '../src/admin/organizations.js';
import { inRolledBackTransaction } from './db.js';
import { OPERATOR_A, UNLINKED_ORGANIZATION, USERS } from './fixtures.js';

/** As `userId` through the admin role, the way withActor sets it. */
const actAs = async (trx: Transaction<DB>, userId: string) => {
  await sql`SET LOCAL ROLE aiontheballot_admin`.execute(trx);
  await sql`SELECT set_config('app.user_id', ${userId}, true), set_config('app.aal', '2', true)`.execute(
    trx,
  );
};

const as = <T>(userId: string, fn: (trx: Transaction<DB>) => Promise<T>) =>
  inRolledBackTransaction(async (trx) => {
    await actAs(trx, userId);
    return fn(trx);
  });

/** A fictional organization's fields. */
const FIELDS: OrganizationFields = {
  displayName: { es: 'Organización de ejemplo cambiada' },
  legalName: 'Organización de Ejemplo Cambiada',
  taxId: 'G00000000',
  address: 'Calle de Ejemplo 1, Ciudad de Ejemplo',
  registryEntry: 'Registro de ejemplo 0000',
  contactEmail: 'contacto@ejemplo.org',
  privacyEmail: 'privacidad@ejemplo.org',
  url: 'https://ejemplo.org',
  newsletterUrl: 'https://ejemplo.org/boletin',
  isPauseaiChapter: true,
};

describe('organizations (editorial workflow P2)', () => {
  it('are all listed to a platform admin, with the sites each runs or endorses', async () => {
    const listed = await as(USERS.platformAdmin, listOrganizations);
    const ids = listed.map(({ id }) => id);
    expect(ids).toContain(UNLINKED_ORGANIZATION);
    expect(listed.find(({ id }) => id === OPERATOR_A)?.tenants).toContainEqual(
      expect.objectContaining({ slug: 'test-a', role: 'operator' }),
    );
    expect(listed.find(({ id }) => id === UNLINKED_ORGANIZATION)?.tenants).toEqual([]);
  });

  it("are shown to a member only as far as their sites' are", async () => {
    const ids = (await as(USERS.editorA, listOrganizations)).map(({ id }) => id);
    expect(ids).toContain(OPERATOR_A);
    expect(ids).not.toContain(UNLINKED_ORGANIZATION);
  });

  it("take a name in any site's language", async () => {
    const languages = await as(USERS.platformAdmin, platformLanguages);
    expect(languages).toContain('es');
    expect(languages).toEqual([...new Set(languages)].sort());
  });

  it('are changed by a platform admin, every field, and audited', async () => {
    const { result, after, audited } = await as(USERS.platformAdmin, async (trx) => {
      const changed = await updateOrganization(trx, OPERATOR_A, FIELDS);
      const { rows } = await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM app.audit_log
         WHERE table_name = 'organizations' AND row_id = ${OPERATOR_A}`.execute(trx);
      return {
        result: changed,
        after: await getOrganization(trx, OPERATOR_A),
        audited: rows[0]?.n,
      };
    });
    expect(result).toBe('changed');
    expect(after).toMatchObject(FIELDS);
    expect(audited).toBeGreaterThan(0);
  });

  it('are changed by no one else, and an unlinked one is not even found', async () => {
    expect(
      await as(USERS.countryAdminA, (trx) => updateOrganization(trx, OPERATOR_A, FIELDS)),
    ).toBe('forbidden');
    expect(
      await as(USERS.countryAdminA, (trx) =>
        updateOrganization(trx, UNLINKED_ORGANIZATION, FIELDS),
      ),
    ).toBe('not-found');
  });

  it('are created by a platform admin only', async () => {
    const created = await as(USERS.platformAdmin, async (trx) => {
      const id = await createOrganization(trx, FIELDS);
      return getOrganization(trx, id);
    });
    expect(created).toMatchObject({ ...FIELDS, tenants: [] });
    const refused = await as(USERS.countryAdminA, (trx) =>
      createOrganization(trx, FIELDS).then(
        () => 'created',
        (error: { code?: string }) => error.code,
      ),
    );
    expect(refused).toBe('42501');
  });
});
