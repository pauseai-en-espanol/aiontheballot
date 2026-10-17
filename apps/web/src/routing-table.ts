import {
  buildRoutingTable,
  type RoutingConfig,
  type RoutingTable,
  type TenantHostname,
  type TenantRoute,
} from '@aiontheballot/domain/routing';

import { fetchApi } from './data-stage';
import { createRefreshQueue } from './refresh-queue';

type Setting = 'open' | 'indexed' | 'plausibleScript';

/**
 * What the API serves at GET /public/routing: active tenants with their public settings, and their verified hostnames.
 * An API older than the settings (PLAN R135) leaves them out.
 */
export interface RoutingData {
  tenants: {
    tenant: Omit<TenantRoute, Setting> & Partial<Pick<TenantRoute, Setting>>;
    hostnames: TenantHostname[];
  }[];
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
 * The routing data's tenants with their public settings (PLAN R135), as the database's defaults where an API older
 * than them (a rollout's old pod) leaves them out: coming soon, indexed, counted nowhere. Never hidden by mistake.
 */
export const withSettings = (
  tenants: RoutingData['tenants'],
): { tenant: TenantRoute; hostnames: TenantHostname[] }[] =>
  tenants.map(({ tenant, hostnames }) => ({
    tenant: {
      ...tenant,
      open: tenant.open ?? false,
      indexed: tenant.indexed ?? true,
      plausibleScript: tenant.plausibleScript ?? null,
    },
    hostnames,
  }));

/**
 * Loads the routing table from the API and keeps it for `maxAgeMs`. Past that age the table is still answered at once
 * while a refresh runs behind it, so a slow API or database never holds a request on routing (PLAN R211); only the
 * first load, and a forced one, wait for the API. When a refresh fails (the API is down, or its data breaks a hostname invariant), the
 * last good table stays in use; with none, the result is undefined and the proxy answers 503. There is never a
 * fallback tenant.
 */
export const createRoutingTableLoader = ({
  apiUrl,
  config,
  maxAgeMs = 30_000,
  fetch: fetchImpl = fetch,
  now = Date.now,
}: RoutingTableLoaderOptions): ((options?: {
  force?: boolean;
}) => Promise<RoutingTable | undefined>) => {
  let current: { table: RoutingTable; loadedAt: number } | undefined;

  const refresh = async (): Promise<void> => {
    if (!apiUrl) {
      return;
    }
    try {
      const response = await fetchApi(fetchImpl, new URL('/public/routing', apiUrl));
      if (!response.ok) {
        throw new Error(`GET /public/routing answered ${response.status}`);
      }
      const data = (await response.json()) as RoutingData;
      current = { table: buildRoutingTable(withSettings(data.tenants), config), loadedAt: now() };
    } catch (error) {
      console.error('Could not refresh the routing table; keeping the last one', error);
    }
  };

  const queue = createRefreshQueue(refresh);

  // `force` refetches after any fetch already on its way: the API's word that a site changed (R151).
  return async ({ force = false } = {}) => {
    if (force) {
      await queue.force(undefined);
    } else if (!current) {
      await queue.join(undefined);
    } else if (now() - current.loadedAt >= maxAgeMs) {
      // refresh() catches its own failures, so nothing rejects unhandled here.
      void queue.join(undefined);
    }
    return current?.table;
  };
};
