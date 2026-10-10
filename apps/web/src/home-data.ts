import type { PublicHome } from '@aiontheballot/domain/public-home';

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
  fetch?: typeof fetch;
  now?: () => number;
}

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
  fetch: fetchImpl = fetch,
  now = Date.now,
}: HomeLoaderOptions): ((slug: string) => Promise<HomeResult>) => {
  const entries = new Map<string, Entry>();
  const refreshing = new Map<string, Promise<void>>();

  const refresh = async (slug: string): Promise<void> => {
    if (!apiUrl) {
      return;
    }
    try {
      const response = await fetchImpl(
        new URL(`/public/tenants/${encodeURIComponent(slug)}/home`, apiUrl),
        { signal: AbortSignal.timeout(5_000) },
      );
      if (response.status === 404) {
        entries.set(slug, { result: { kind: 'missing' }, loadedAt: now() });
        return;
      }
      if (!response.ok) {
        throw new Error(`GET /public/tenants/${slug}/home answered ${response.status}`);
      }
      const home = (await response.json()) as PublicHome;
      entries.set(slug, { result: { kind: 'found', home }, loadedAt: now() });
    } catch (error) {
      console.error(`Could not refresh the home data of ${slug}; keeping the last copy`, error);
    }
  };

  return async (slug) => {
    const entry = entries.get(slug);
    if (!entry || now() - entry.loadedAt >= maxAgeMs) {
      let pending = refreshing.get(slug);
      if (!pending) {
        pending = refresh(slug).finally(() => refreshing.delete(slug));
        refreshing.set(slug, pending);
      }
      await pending;
    }
    return entries.get(slug)?.result ?? { kind: 'unavailable' };
  };
};
