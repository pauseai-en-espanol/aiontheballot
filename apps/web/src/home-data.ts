import type { PublicHome } from '@aiontheballot/domain/public-home';

import { readTheme } from '@aiontheballot/domain/site-theme';

import { fetchStaged, type PreviewAccess, stagePath } from './data-stage';
import { createRefreshQueue } from './refresh-queue';

export type HomeResult =
  | { kind: 'found'; home: PublicHome }
  /** No active tenant has the slug (the API answered 404). */
  | { kind: 'missing' }
  /** No API, or it failed and there is no earlier copy. */
  | { kind: 'unavailable' };

export interface HomeLoaderOptions {
  /** The API's base URL, inside the cluster. */
  apiUrl: string | undefined;
  /** How long a tenant's data is used before it is fetched again. */
  maxAgeMs?: number;
  /** The youngest copy a `fresh` load refetches: it bounds API calls to one per tenant per interval, whatever comes. */
  freshAfterMs?: number;
  /** The admin's preview's data instead of the public's (PLAN R181), with the secret the API asks for. */
  preview?: PreviewAccess | undefined;
  fetch?: typeof fetch;
  now?: () => number;
}

/**
 * Fields newer than the API: web and API roll out together, so a new web pod can read an old API pod for a while.
 * Missing ones get their empty value rather than failing the page. The site's colours are checked again as the API
 * checks them (R178): drawing one that isn't a readable `#rrggbb` would fail every page, image and manifest of the
 * site, so any other is left to the platform's.
 */
const withDefaults = (home: PublicHome): PublicHome => {
  const older = home as Partial<PublicHome>;
  const olderOperator = home.operator as Partial<PublicHome['operator']>;
  return {
    ...home,
    tenant: { ...home.tenant, theme: readTheme(home.tenant.theme) },
    brand: older.brand ?? {},
    documents: older.documents ?? {},
    elections: older.elections ?? [],
    signups: older.signups ?? false,
    operator: {
      ...home.operator,
      legalName: olderOperator.legalName ?? '',
      taxId: olderOperator.taxId ?? null,
      address: olderOperator.address ?? null,
      registryEntry: olderOperator.registryEntry ?? null,
      privacyEmail: olderOperator.privacyEmail ?? null,
    },
  };
};

interface Entry {
  result: Exclude<HomeResult, { kind: 'unavailable' }>;
  loadedAt: number;
}

/**
 * Loads each tenant's home data from the API and keeps it for `maxAgeMs`. When a refresh fails, the last good copy
 * stays in use (ADR-0003: the public web keeps serving its cache when the API errors). Slugs come from the routing
 * table, so the cache holds at most one entry per tenant.
 */
export const createHomeLoader = ({
  apiUrl,
  maxAgeMs = 60_000,
  freshAfterMs = 5_000,
  preview,
  fetch: fetchImpl = fetch,
  now = Date.now,
}: HomeLoaderOptions): ((
  slug: string,
  options?: { fresh?: boolean; force?: boolean },
) => Promise<HomeResult>) => {
  const entries = new Map<string, Entry>();

  const refresh = async (slug: string): Promise<void> => {
    if (!apiUrl) {
      return;
    }
    const tenantPath = `/tenants/${encodeURIComponent(slug)}/home`;
    const path = stagePath(preview, tenantPath);
    try {
      const response = await fetchStaged(fetchImpl, apiUrl, preview, tenantPath);
      if (response.status === 404) {
        entries.set(slug, { result: { kind: 'missing' }, loadedAt: now() });
        return;
      }
      if (!response.ok) {
        throw new Error(`GET ${path} answered ${response.status}`);
      }
      const home = withDefaults((await response.json()) as PublicHome);
      entries.set(slug, { result: { kind: 'found', home }, loadedAt: now() });
    } catch (error) {
      console.error(`Could not refresh the home data of ${slug}; keeping the last copy`, error);
    }
  };

  const queue = createRefreshQueue(refresh);

  // `fresh` refetches unless the copy is only seconds old: for a caller that must not act on data older than another's.
  // `force` refetches after any fetch already on its way, which may have started before what is to be seen: the API's
  // word that the site changed (R151).
  return async (slug, { fresh = false, force = false } = {}) => {
    if (force) {
      await queue.force(slug);
    } else {
      const entry = entries.get(slug);
      const age = entry ? now() - entry.loadedAt : Infinity;
      if (age >= maxAgeMs || (fresh && age >= freshAfterMs)) {
        await queue.join(slug);
      }
    }
    return entries.get(slug)?.result ?? { kind: 'unavailable' };
  };
};
