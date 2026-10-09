import {
  buildRoutingTable,
  type RoutingConfig,
  type RoutingTable,
  type TenantHostname,
  type TenantRoute,
} from '@aiontheballot/domain/routing';

/** What the API serves at GET /public/routing: active tenants and their verified hostnames. */
export interface RoutingData {
  tenants: { tenant: TenantRoute; hostnames: TenantHostname[] }[];
}

export interface RoutingTableLoaderOptions {
  /** The API's base URL, inside the cluster. Without it there is no routing data, so nothing is served. */
  apiUrl: string | undefined;
  config: RoutingConfig;
  /** How long a table is used before it is fetched again. */
  maxAgeMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

/**
 * Loads the routing table from the API and keeps it for `maxAgeMs`. When a refresh fails (the API is down, or its
 * data breaks a hostname invariant), the last good table stays in use; with none, the result is undefined and the
 * proxy answers 503. There is never a fallback tenant.
 */
export const createRoutingTableLoader = ({
  apiUrl,
  config,
  maxAgeMs = 30_000,
  fetch: fetchImpl = fetch,
  now = Date.now,
}: RoutingTableLoaderOptions): (() => Promise<RoutingTable | undefined>) => {
  let current: { table: RoutingTable; loadedAt: number } | undefined;
  let refreshing: Promise<void> | undefined;

  const refresh = async (): Promise<void> => {
    if (!apiUrl) {
      return;
    }
    try {
      const response = await fetchImpl(new URL('/public/routing', apiUrl), {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        throw new Error(`GET /public/routing answered ${response.status}`);
      }
      const data = (await response.json()) as RoutingData;
      current = { table: buildRoutingTable(data.tenants, config), loadedAt: now() };
    } catch (error) {
      console.error('Could not refresh the routing table; keeping the last one', error);
    }
  };

  return async () => {
    if (!current || now() - current.loadedAt >= maxAgeMs) {
      refreshing ??= refresh().finally(() => {
        refreshing = undefined;
      });
      await refreshing;
    }
    return current?.table;
  };
};
