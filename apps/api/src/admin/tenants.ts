import type { DB } from '@aiontheballot/db/generated/db';
import type { Transaction } from 'kysely';

import { isLocalized, type Localized } from '@aiontheballot/domain/localized';

export interface TenantSummary {
  slug: string;
  name: Localized;
  defaultLocale: string;
}

/**
 * The tenants a signed-in user may open (editorial workflow A6): read in the caller's `withActor` transaction, so RLS
 * decides. A member sees the tenants they hold a role in, a platform admin every tenant, and a session without TOTP
 * nothing at all, since every policy helper requires aal2 (ADR-0002 §9).
 */
export const listTenants = async (trx: Transaction<DB>): Promise<TenantSummary[]> => {
  const rows = await trx
    .selectFrom('app.tenants')
    .select(['slug', 'display_name', 'default_locale'])
    .orderBy('slug')
    .execute();
  return rows.map((row) => {
    if (!isLocalized(row.display_name)) {
      throw new Error('tenants.display_name is not localized text');
    }
    return { slug: row.slug, name: row.display_name, defaultLocale: row.default_locale };
  });
};
