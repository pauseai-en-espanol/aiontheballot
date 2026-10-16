import { NO_PUBLIC_ELECTION, type PublicElection } from '@aiontheballot/domain/public-election';

import { fetchStaged, type PreviewAccess, stagePath } from './data-stage';
import { createRefreshQueue } from './refresh-queue';

export type ElectionResult =
  | { kind: 'found'; election: PublicElection }
  /** No public election has these slugs (the API said so). */
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
  /** The youngest copy a `fresh` load refetches: it bounds API calls to one per election per interval. */
  freshAfterMs?: number;
  /**
   * Told when a refresh brings an election that differs from the copy it replaces (or the first copy, `previous`
   * undefined), after it is in use: what changed can be pre-rendered (R148).
   */
  onChange?: (slug: string, next: PublicElection, previous: PublicElection | undefined) => void;
  /** The admin's preview's data instead of the public's (PLAN R181), with the secret the API asks for. */
  preview?: PreviewAccess | undefined;
  fetch?: typeof fetch;
  now?: () => number;
}

interface Entry {
  result: Exclude<ElectionResult, { kind: 'unavailable' }>;
  loadedAt: number;
  /** The answer as it came, to tell whether a refresh changed anything. */
  text?: string;
}

/**
 * Loads a public election's data from the API and keeps it for `maxAgeMs` (public-site spec §9), as the home data is
 * kept (PLAN R45): when a refresh fails, the last good copy stays in use (ADR-0003 guardrail 3). The pages ask only
 * for elections the home lists, so made-up slugs never get here; the cache is bounded all the same. Only the API's own
 * "no public election" is a missing one: any other answer, a route an older API lacks included, is a failure.
 */
export const createElectionLoader = ({
  apiUrl,
  maxAgeMs = 60_000,
  maxEntries = 200,
  freshAfterMs = 5_000,
  onChange,
  preview,
  fetch: fetchImpl = fetch,
  now = Date.now,
}: ElectionLoaderOptions): ((
  slug: string,
  election: string,
  options?: { fresh?: boolean; force?: boolean },
) => Promise<ElectionResult>) => {
  const entries = new Map<string, Entry>();

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

  const refresh = async ([slug, election]: readonly [string, string]): Promise<void> => {
    if (!apiUrl) {
      return;
    }
    const key = `${slug}/${election}`;
    const electionPath = `/tenants/${encodeURIComponent(slug)}/elections/${encodeURIComponent(election)}`;
    const path = stagePath(preview, electionPath);
    try {
      const response = await fetchStaged(fetchImpl, apiUrl, preview, electionPath);
      if (response.status === 404) {
        const body = (await response.json().catch(() => undefined)) as
          { error?: unknown } | undefined;
        if (body?.error === NO_PUBLIC_ELECTION) {
          keep(key, { result: { kind: 'missing' }, loadedAt: now() });
          return;
        }
      }
      if (!response.ok) {
        throw new Error(`GET ${path} answered ${response.status}`);
      }
      const text = await response.text();
      const previous = entries.get(key);
      const unchanged = previous?.text === text;
      keep(key, {
        result: { kind: 'found', election: JSON.parse(text) as PublicElection },
        loadedAt: now(),
        text,
      });
      if (!unchanged && onChange) {
        const next = entries.get(key)?.result;
        if (next?.kind === 'found') {
          onChange(
            slug,
            next.election,
            previous?.result.kind === 'found' ? previous.result.election : undefined,
          );
        }
      }
    } catch (error) {
      console.error(
        `Could not refresh the election ${slug}/${election}; keeping the last copy`,
        error,
      );
    }
  };

  // Keyed by the pair as JSON (a slug from a path may hold anything), so one election's loads share their refreshes.
  const queue = createRefreshQueue<string>((pair) => refresh(JSON.parse(pair) as [string, string]));

  // `fresh` refetches unless the copy is only seconds old: for a caller that must not act on data older than another's.
  // `force` refetches after any fetch already on its way: the API's word that the election changed (R151).
  return async (slug, election, { fresh = false, force = false } = {}) => {
    const key = `${slug}/${election}`;
    const pair = JSON.stringify([slug, election]);
    if (force) {
      await queue.force(pair);
    } else {
      const entry = entries.get(key);
      const age = entry ? now() - entry.loadedAt : Number.POSITIVE_INFINITY;
      if (age >= maxAgeMs || (fresh && age >= freshAfterMs)) {
        await queue.join(pair);
      }
    }
    return entries.get(key)?.result ?? { kind: 'unavailable' };
  };
};
