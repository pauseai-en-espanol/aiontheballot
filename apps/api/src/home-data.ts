import type { Database } from '@aiontheballot/db/client';
import type { PublicHome } from '@aiontheballot/domain/public-home';

import { isLocalized, type Localized } from '@aiontheballot/domain/localized';
import { sql } from 'kysely';

/** A tenant's home data by slug; undefined when no active tenant has that slug. */
export type HomeSource = (slug: string) => Promise<PublicHome | undefined>;

const localized = (value: unknown, column: string): Localized => {
  if (!isLocalized(value)) {
    throw new Error(`${column} is not localized text`);
  }
  return value;
};

/**
 * Reads a tenant's home data as aiontheballot_web, so RLS decides what is public: an inactive tenant doesn't exist,
 * and neither does an election that isn't public.
 */
export const createHomeSource =
  (db: Database): HomeSource =>
  async (slug) => {
    const tenant = await db
      .selectFrom('app.tenants')
      .select(['id', 'display_name', 'default_locale', 'methodology_kind'])
      .where('slug', '=', slug)
      .executeTakeFirst();
    if (!tenant) {
      return undefined;
    }
    const [operator, election] = await Promise.all([
      db
        .selectFrom('app.tenant_organizations as link')
        .innerJoin('app.organizations as o', 'o.id', 'link.organization_id')
        .select(['o.display_name', 'o.url', 'o.contact_email', 'o.newsletter_url'])
        .where('link.tenant_id', '=', tenant.id)
        .where('link.role', '=', 'operator')
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('app.elections')
        // A date as text: pg would turn it into a Date at local midnight, which can shift the day.
        .select(['name', sql<string | null>`election_date::text`.as('date')])
        .where('tenant_id', '=', tenant.id)
        .where('status', '<>', 'archived')
        .where((eb) =>
          eb.or([
            eb('election_date', 'is', null),
            eb('election_date', '>=', sql<Date>`current_date`),
          ]),
        )
        .orderBy(sql`election_date nulls last`)
        .orderBy('created_at')
        .limit(1)
        .executeTakeFirst(),
    ]);
    return {
      tenant: {
        displayName: localized(tenant.display_name, 'tenants.display_name'),
        defaultLocale: tenant.default_locale,
        methodologyKind: tenant.methodology_kind,
      },
      operator: {
        displayName: localized(operator.display_name, 'organizations.display_name'),
        url: operator.url,
        contactEmail: operator.contact_email,
        newsletterUrl: operator.newsletter_url,
      },
      election: election
        ? { name: localized(election.name, 'elections.name'), date: election.date }
        : null,
    };
  };
