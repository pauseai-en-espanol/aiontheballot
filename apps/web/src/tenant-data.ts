import type { PublicHome } from '@aiontheballot/domain/public-home';

import { canonicalBase, type RoutingConfig, type TenantRoute } from '@aiontheballot/domain/routing';

import { analyticsFrom } from './analytics';
import { createHomeLoader } from './home-data';
import { createRoutingTableLoader } from './routing-table';

/** The platform domain is optional (ADR-0002, hostnames): without it, tenants are reachable only on their own hostnames. */
export const routingConfig: RoutingConfig = {
  platformHost: process.env.PLATFORM_HOST || undefined,
  // The preview host (public-site spec §2), on the private gateway only.
  previewHost: process.env.PREVIEW_HOST || undefined,
};

/** What is counted, and where (PLAN R135): `PLAUSIBLE_URL`, and each site's script from the routing data. */
export const loadAnalytics = async () => analyticsFrom(process.env, await loadRoutingTable());

export const loadRoutingTable = createRoutingTableLoader({
  apiUrl: process.env.API_URL,
  config: routingConfig,
});

export const loadHome = createHomeLoader({ apiUrl: process.env.API_URL });

export type TenantPage =
  | { kind: 'found'; home: PublicHome; tenant: TenantRoute; base: string }
  | { kind: 'missing' }
  | { kind: 'unavailable' };

/**
 * What a tenant's pages and images are built from: its home data, and its canonical base from the routing table
 * (ADR-0002: the only source for canonical, OG and share URLs, never the Host header).
 */
export const loadTenantPage = async (
  slug: string,
  options: { fresh?: boolean } = {},
): Promise<TenantPage> => {
  const [table, home] = await Promise.all([loadRoutingTable(), loadHome(slug, options)]);
  if (!table || home.kind === 'unavailable') {
    return { kind: 'unavailable' };
  }
  const tenant = table.tenantsBySlug.get(slug);
  const base = tenant && canonicalBase(table, tenant, routingConfig);
  if (home.kind === 'missing' || !tenant || !base) {
    return { kind: 'missing' };
  }
  return { kind: 'found', home: home.home, tenant, base };
};
