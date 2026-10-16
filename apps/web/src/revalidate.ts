import { readLimited } from '@aiontheballot/observability/relay';
import { isIP } from 'node:net';

/**
 * Instant refresh on publish (ADR-0003, the public cache; editorial workflow PC1.2; PLAN R151): after a write to a
 * site's public data commits, the API tells every web replica which site (and election) changed, and each refetches
 * them at once, so the public sees the change in a second instead of within the minute its copies last; refetching an
 * election pre-renders the link previews of the views whose cards changed (R148). The 60-second refresh stays the
 * safety net.
 *
 * The request carries no data, only what to refetch from the API, which decides what is public; so it needs no
 * secret. It is answered only on an internal host (a pod's address, a cluster name, localhost), which the gateway
 * never forwards: from the internet it is a 404 like any other unknown path, whatever the method (the proxy checks it
 * too). A site the routing table doesn't list is refetched no further, so nothing but real sites is ever kept; work for
 * one site (and election) coalesces: one runs at a time, and one more follows if asked meanwhile, since the running one
 * may have started before what changed. A bounded number of them run at once; past it, the answer is 503. So the worst
 * another pod in the cluster can do is make the replicas refetch real sites, one at a time.
 */

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
/** A Host header: a bracketed IPv6 address or a name, and an optional port. */
const HOST = /^(?:\[([0-9a-f:.]+)\]|([a-z0-9.-]+))(?::\d{1,5})?$/u;

/** Where the API posts it: a system path (routing's SYSTEM_PATHS), answered before any site is resolved. */
export const REVALIDATE_PATH = '/_internal/revalidate';

/** How many sites (or elections) are refetched at once, at most. */
export const MAX_REVALIDATIONS = 32;

/** A pod's or the cluster's own address: never a hostname the gateway routes. */
export const isInternalHost = (host: string | null): boolean => {
  const match = HOST.exec((host ?? '').toLowerCase());
  if (!match) {
    return false;
  }
  const [, ipv6, name = ''] = match;
  if (ipv6 !== undefined) {
    return isIP(ipv6) === 6;
  }
  return isIP(name) === 4 || name === 'localhost' || name.endsWith('.cluster.local');
};

export interface Revalidation {
  tenant: string;
  election?: string;
}

export const parseRevalidation = (value: unknown): Revalidation | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const { tenant, election } = value as { tenant?: unknown; election?: unknown };
  if (typeof tenant !== 'string' || !SLUG.test(tenant)) {
    return undefined;
  }
  if (election === undefined) {
    return { tenant };
  }
  return typeof election === 'string' && SLUG.test(election) ? { tenant, election } : undefined;
};

/**
 * Runs `work` for `key`, once at a time, and once more if asked again while it runs; undefined, and nothing run, when
 * `maxKeys` keys are already running.
 */
export const createCoalescer = (maxKeys = MAX_REVALIDATIONS) => {
  const running = new Map<string, { done: Promise<void>; again: boolean }>();
  return (key: string, work: () => Promise<void>): Promise<void> | undefined => {
    const current = running.get(key);
    if (current) {
      current.again = true;
      return current.done;
    }
    if (running.size >= maxKeys) {
      return undefined;
    }
    const state = { done: Promise.resolve(), again: false };
    state.done = (async () => {
      try {
        do {
          state.again = false;
          await work();
        } while (state.again);
      } finally {
        running.delete(key);
      }
    })();
    running.set(key, state);
    return state.done;
  };
};

export interface RevalidateTargets {
  /**
   * Refetch the routing table (a site opened or hidden) and say whether it lists the site; then the site's home data,
   * and an election's data.
   */
  routing: (tenant: string) => Promise<boolean>;
  home: (tenant: string) => Promise<{ elections: string[] } | undefined>;
  election: (tenant: string, election: string) => Promise<unknown>;
}

/**
 * `POST /_internal/revalidate` with `{ tenant, election? }`: answered at once (202), the refetch running after. A
 * named election is refetched; without one, every election the site lists, since what changed may show on all of them
 * (the operator's name, a logo).
 */
export const handleRevalidate = async (
  request: Request,
  targets: RevalidateTargets,
  coalesce: ReturnType<typeof createCoalescer>,
): Promise<Response> => {
  const reply = (status: number) =>
    new Response(null, { status, headers: { 'cache-control': 'no-store' } });
  if (!isInternalHost(request.headers.get('host'))) {
    return reply(404);
  }
  const body = await readLimited(request.body, 1024);
  let parsed: unknown;
  try {
    parsed = body ? JSON.parse(new TextDecoder().decode(body)) : undefined;
  } catch {
    parsed = undefined;
  }
  const what = parseRevalidation(parsed);
  if (!what) {
    return reply(400);
  }
  const work = async () => {
    if (!(await targets.routing(what.tenant))) {
      return;
    }
    const home = await targets.home(what.tenant);
    const elections = what.election ? [what.election] : (home?.elections ?? []);
    for (const election of elections) {
      await targets.election(what.tenant, election);
    }
  };
  const running = coalesce(`${what.tenant}/${what.election ?? '*'}`, work);
  if (!running) {
    return reply(503);
  }
  running.catch((error: unknown) => {
    console.error('Could not revalidate a site', error);
  });
  return reply(202);
};
