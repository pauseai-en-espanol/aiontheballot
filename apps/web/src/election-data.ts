import type { PublicElection } from '@aiontheballot/domain/public-election';

export type ElectionResult =
  | { kind: 'found'; election: PublicElection }
  /** No public election has these slugs (the API answered 404). */
  | { kind: 'missing' }
  /** No API, or it failed and there is no earlier copy. */
  | { kind: 'unavailable' };

export interface ElectionLoaderOptions {
  /** The API's base URL, inside the cluster. */
  apiUrl: string | undefined;
  /** How long an election's data is used before it is fetched again. */
  maxAgeMs?: number;
  /** At most this many elections are kept; past it, the oldest copy is dropped first. */
  maxEntries?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

interface Entry {
  result: Exclude<ElectionResult, { kind: 'unavailable' }>;
  loadedAt: number;
}

/**
 * Loads a public election's data from the API and keeps it for `maxAgeMs` (public-site spec §9), as the home data is
 * kept (PLAN R45): when a refresh fails, the last good copy stays in use (ADR-0003 guardrail 3). Slugs come from
 * requests, so the cache holds a bounded number of entries; a missing election is remembered too, so asking for
 * made-up slugs can't make every request reach the API.
 */
export const createElectionLoader = ({
  apiUrl,
  maxAgeMs = 60_000,
  maxEntries = 200,
  fetch: fetchImpl = fetch,
  now = Date.now,
}: ElectionLoaderOptions): ((slug: string, election: string) => Promise<ElectionResult>) => {
  const entries = new Map<string, Entry>();
  const refreshing = new Map<string, Promise<void>>();

  const keep = (key: string, entry: Entry) => {
    entries.delete(key);
    if (entries.size >= maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) {
        entries.delete(oldest);
      }
    }
    entries.set(key, entry);
  };

  const refresh = async (key: string, slug: string, election: string): Promise<void> => {
    if (!apiUrl) {
      return;
    }
    const path = `/public/tenants/${encodeURIComponent(slug)}/elections/${encodeURIComponent(election)}`;
    try {
      const response = await fetchImpl(new URL(path, apiUrl), {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status === 404 || response.status === 400) {
        keep(key, { result: { kind: 'missing' }, loadedAt: now() });
        return;
      }
      if (!response.ok) {
        throw new Error(`GET ${path} answered ${response.status}`);
      }
      keep(key, {
        result: { kind: 'found', election: (await response.json()) as PublicElection },
        loadedAt: now(),
      });
    } catch (error) {
      console.error(
        `Could not refresh the election ${slug}/${election}; keeping the last copy`,
        error,
      );
    }
  };

  return async (slug, election) => {
    const key = `${slug}/${election}`;
    const entry = entries.get(key);
    if (!entry || now() - entry.loadedAt >= maxAgeMs) {
      let pending = refreshing.get(key);
      if (!pending) {
        pending = refresh(key, slug, election).finally(() => refreshing.delete(key));
        refreshing.set(key, pending);
      }
      await pending;
    }
    return entries.get(key)?.result ?? { kind: 'unavailable' };
  };
};
