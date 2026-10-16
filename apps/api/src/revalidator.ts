import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Instant refresh on publish (ADR-0003, the public cache; editorial workflow PC1.2; PLAN R151): once a write to a site
 * has committed, the API tells every replica of the public site which site (and election) changed, and each refetches
 * them from the API and pre-renders the link previews that changed. The web's pods are found through a headless
 * Service, whose name resolves to every ready pod's address; each gets `POST /_internal/revalidate`, which the web
 * answers only on such an internal address. Fire and forget: a replica that misses it catches up within its minute.
 */
export interface RevalidateTarget {
  tenant: string;
  election?: string;
}

export const createRevalidator = ({
  url,
  fetch: fetchImpl = fetch,
  resolve = async (host: string) =>
    (await lookup(host, { all: true })).map((found) => found.address),
  onError,
  timeoutMs = 5_000,
}: {
  /** The web pods' Service, e.g. `http://aiontheballot-web-pods:3000`: a name resolving to every pod. */
  url: string;
  fetch?: typeof fetch;
  resolve?: (host: string) => Promise<string[]>;
  /** That some replicas weren't told, and how many: never what changed. */
  onError: (error: Error) => void;
  timeoutMs?: number;
}): ((target: RevalidateTarget) => void) => {
  const base = new URL(url);
  const port = base.port || '80';
  return (target) => {
    void (async () => {
      const host = base.hostname.replace(/^\[(.*)\]$/u, '$1');
      const addresses = isIP(host) ? [host] : await resolve(host);
      const results = await Promise.allSettled(
        addresses.map(async (address) => {
          const response = await fetchImpl(
            `${base.protocol}//${isIP(address) === 6 ? `[${address}]` : address}:${port}/_internal/revalidate`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(target),
              signal: AbortSignal.timeout(timeoutMs),
            },
          );
          await response.body?.cancel();
          if (!response.ok) {
            throw new Error(`answered ${response.status}`);
          }
        }),
      );
      const failed = results.filter((result) => result.status === 'rejected').length;
      if (failed > 0) {
        throw new Error(
          `${failed} of ${addresses.length} web replicas weren't told a site changed`,
        );
      }
    })().catch((error: unknown) =>
      onError(
        error instanceof Error ? error : new Error("The web replicas weren't told a site changed"),
      ),
    );
  };
};
