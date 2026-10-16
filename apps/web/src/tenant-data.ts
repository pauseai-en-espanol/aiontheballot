import type { PublicHome } from '@aiontheballot/domain/public-home';

import { canonicalBase, type RoutingConfig, type TenantRoute } from '@aiontheballot/domain/routing';

import type { PreviewAccess } from './data-stage';

import { analyticsFrom } from './analytics';
import { createHomeLoader } from './home-data';
import { processWide } from './process-wide';
import { readPreviewToken } from './routing-proxy';
import { createRoutingTableLoader } from './routing-table';

/** The platform domain is optional (ADR-0002, hostnames): without it, tenants are reachable only on their own hostnames. */
export const routingConfig: RoutingConfig = {
  platformHost: process.env.PLATFORM_HOST || undefined,
  // The preview host (public-site spec §2): an in-cluster name for the admin's preview, which needs the token.
  previewHost: process.env.PREVIEW_HOST || undefined,
};

/** What is counted, and where (PLAN R135): `PLAUSIBLE_URL`, and each site's script from the routing data. */
export const loadAnalytics = async () => analyticsFrom(process.env, await loadRoutingTable());

// One copy per process, shared by the proxy, the pages and the routes (process-wide.ts).
export const loadRoutingTable = processWide('routingTable', () =>
  createRoutingTableLoader({ apiUrl: process.env.API_URL, config: routingConfig }),
);

export const loadHome = processWide('home', () =>
  createHomeLoader({ apiUrl: process.env.API_URL }),
);

/**
 * The admin's preview's access to the API's preview data (PLAN R181): the secret the admin sends this app, which the
 * API asks for too. None while the preview is off, and then nothing is read for it.
 */
export const previewAccess = processWide('previewAccess', (): PreviewAccess | undefined => {
  const token = readPreviewToken(process.env.PREVIEW_TOKEN);
  return token ? { token } : undefined;
});

/**
 * The preview's home data, apart from the public's: never the same cache, and kept only seconds, since those who
 * preview a site are checking what they just changed.
 */
export const loadPreviewHome = processWide('previewHome', () =>
  createHomeLoader({
    apiUrl: previewAccess ? process.env.API_URL : undefined,
    preview: previewAccess,
    maxAgeMs: 2_000,
  }),
);

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
  { preview = false, ...options }: { fresh?: boolean; preview?: boolean } = {},
): Promise<TenantPage> => {
  const [table, home] = await Promise.all([
    loadRoutingTable(),
    (preview ? loadPreviewHome : loadHome)(slug, options),
  ]);
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
