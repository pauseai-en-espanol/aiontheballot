import type { Database } from '@aiontheballot/db/client';
import type { TenantHostname, TenantRoute } from '@aiontheballot/domain/routing';

import { sql } from 'kysely';

/** What the public site routes by (ADR-0002, routing): active tenants and their verified hostnames. */
export interface RoutingData {
  tenants: { tenant: TenantRoute; hostnames: TenantHostname[] }[];
}

export type RoutingSource = () => Promise<RoutingData>;

/**
 * Reads the routing data as aiontheballot_web, so RLS decides what is public: only active tenants, and only their
 * verified hostnames (retired ones included: they redirect forever).
 */
export const createRoutingSource =
  (db: Database): RoutingSource =>
  async () => {
    const [tenants, hostnames] = await Promise.all([
      db
        .selectFrom('app.tenants')
        // An array of a domain type comes back from pg as text unless cast to a plain array.
        .select([
          'id',
          'slug',
          'default_locale',
          sql<string[]>`enabled_locales::text[]`.as('enabled_locales'),
        ])
        .orderBy('slug')
        .execute(),
      db
        .selectFrom('app.tenant_hostnames')
        .select(['hostname', 'tenant_id', 'is_canonical'])
        .orderBy('hostname')
        .execute(),
    ]);
    return {
      tenants: tenants.map((t) => ({
        tenant: {
          id: t.id,
          slug: t.slug,
          defaultLocale: t.default_locale,
          enabledLocales: t.enabled_locales,
        },
        hostnames: hostnames
          .filter((h) => h.tenant_id === t.id)
          .map((h) => ({ hostname: h.hostname, isCanonical: h.is_canonical, verified: true })),
      })),
    };
  };
