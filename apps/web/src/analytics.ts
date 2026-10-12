import { normalizeHost, type RoutingTable } from '@aiontheballot/domain/routing';
import { readLimited } from '@aiontheballot/observability/relay';
import { BlockList, isIP } from 'node:net';

/**
 * Plausible behind the public site's own host (PLAN R83), the proxy Plausible documents: the site serves each tenant's
 * Plausible script and forwards its events, so the browser talks to no other host, loads nothing from elsewhere and
 * keeps no cookie, while every Plausible feature (time on page, scroll depth, outbound links, downloads, forms)
 * works. The upstream is Plausible's service inside the cluster: the public gateway drops `X-Forwarded-For`, so going
 * out and back in would make every visitor one.
 */
export interface Analytics {
  /** Plausible's base URL inside the cluster, e.g. `http://plausible.plausible.svc.cluster.local`. */
  url: string;
  /** Each site's Plausible script (`pa-….js`, from the site's installation snippet), by its canonical host. */
  sites: ReadonlyMap<string, string>;
}

/** Logs what an operator should know, nothing of a visitor's: each message at most once a minute. */
export type Warn = (message: string) => void;

const WARN_EVERY_MS = 60 * 1000;
const lastWarned = new Map<string, number>();
export const throttledWarn: Warn = (message) => {
  const at = Date.now();
  if (at - (lastWarned.get(message) ?? Number.NEGATIVE_INFINITY) < WARN_EVERY_MS) {
    return;
  }
  lastWarned.set(message, at);
  console.warn(message);
};

const SCRIPT_FILE = /^pa-[\w-]+\.js$/;

/**
 * The analytics configuration (PLAN R83, R135): Plausible's base URL inside the cluster, `PLAUSIBLE_URL`, the one
 * setting the deployment gives; and each site's script, which a platform admin sets on the site's page, by the site's
 * canonical host, the only one where it is counted (an alias redirects there; the preview and platform hosts are never
 * counted). Without the URL or routing data nothing is counted; a malformed URL says so in the log.
 */
export const analyticsFrom = (
  env: Record<string, string | undefined>,
  table: RoutingTable | undefined,
  warn: Warn = throttledWarn,
): Analytics | undefined => {
  const url = env.PLAUSIBLE_URL;
  if (!table) {
    return undefined;
  }
  if (!url) {
    if ([...table.tenantsBySlug.values()].some((tenant) => tenant.plausibleScript)) {
      warn('A site has a Plausible script but PLAUSIBLE_URL is not set: nothing is counted');
    }
    return undefined;
  }
  let base: URL | undefined;
  try {
    base = new URL(url);
  } catch {
    base = undefined;
  }
  if (!base || (base.protocol !== 'http:' && base.protocol !== 'https:')) {
    warn('PLAUSIBLE_URL is malformed: nothing is counted');
    return undefined;
  }
  const sites = new Map<string, string>();
  for (const tenant of table.tenantsBySlug.values()) {
    const host = table.canonicalHosts.get(tenant.id);
    const file = tenant.plausibleScript;
    // The database checks the file's form too; this keeps anything else out of the upstream path.
    if (host && file && SCRIPT_FILE.test(file)) {
      sites.set(host, file);
    }
  }
  return { url: base.href.replace(/\/$/, ''), sites };
};

/**
 * The hostname a request was sent to, read as routing reads it (no port, no trailing dot). It only picks the analytics
 * site; it grants nothing.
 */
export const hostnameOf = (host: string | null): string | undefined =>
  host === null ? undefined : normalizeHost(host);

const reply = (status: number): Response =>
  new Response(null, { status, headers: { 'cache-control': 'no-store' } });

const httpUrl = (value: unknown): URL | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : undefined;
  } catch {
    return undefined;
  }
};

/** Addresses no visitor on the internet has: this cluster's own, the VPN's, loopback and link-local. */
const NOT_A_VISITOR = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const) {
  NOT_A_VISITOR.addSubnet(network, prefix, 'ipv4');
}
// IPv4-compatible (with :: and ::1), SIIT, NAT64, unique local and link-local. IPv4-mapped addresses are checked
// against the IPv4 rules (BlockList does so itself; dotted ones are unwrapped first).
for (const [network, prefix] of [
  ['::', 96],
  ['::ffff:0:0:0', 96],
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  NOT_A_VISITOR.addSubnet(network, prefix, 'ipv6');
}

/** A visitor's public address, an IPv4-mapped one unwrapped; undefined for anything else. */
const visitorAddress = (value: string | undefined): string | undefined => {
  const address = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value ?? '')?.[1] ?? value ?? '';
  const family = isIP(address);
  return family === 0 || NOT_A_VISITOR.check(address, family === 4 ? 'ipv4' : 'ipv6')
    ? undefined
    : address;
};

/** An event is a URL, a name and a few counters; Plausible takes paths up to 2,000 characters. */
export const EVENT_MAX_BYTES = 8 * 1024;
const EVENT_NAME_MAX = 120;
const UPSTREAM_TIMEOUT_MS = 3000;

export interface RelayOptions {
  analytics: Analytics | undefined;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  warn?: Warn;
}

/**
 * Forwards an event from the tenant's Plausible script to Plausible's events API:
 *
 * - only for a host with a Plausible site, and only an event of that site (its `d`) about a page of that host (its
 *   `u`, a normalised address), with a name;
 * - as parsed, written out again, so a repeated key can't mean one thing here and another to Plausible;
 * - a browser's `Origin` must be this host, so another site can't count views here;
 * - with the browser's User-Agent and the visitor's address: the last `X-Forwarded-For` entry, the one the gateway
 *   adds after dropping any the client sends. Without a public one (Next fills in the socket's when nothing set it),
 *   nothing is sent, or every such visitor would be one. Plausible hashes them with a daily salt and stores neither.
 *   The relay keeps nothing, and logs only Plausible's failures, with nothing of the visitor's.
 *
 * It answers 202 whatever Plausible does: counting is best effort.
 */
export const relayEvent = async (request: Request, options: RelayOptions): Promise<Response> => {
  const {
    analytics,
    timeoutMs = UPSTREAM_TIMEOUT_MS,
    fetch: send = globalThis.fetch,
    warn = throttledWarn,
  } = options;
  const hostname = hostnameOf(request.headers.get('host'));
  if (!analytics || !hostname || !analytics.sites.has(hostname)) {
    return reply(404);
  }
  const origin = request.headers.get('origin');
  if (origin !== null && hostnameOf(httpUrl(origin)?.host ?? null) !== hostname) {
    return reply(403);
  }
  if (Number(request.headers.get('content-length') ?? 0) > EVENT_MAX_BYTES) {
    return reply(413);
  }
  let body: Awaited<ReturnType<typeof readLimited>>;
  try {
    body = await readLimited(request.body, EVENT_MAX_BYTES);
  } catch {
    // The browser gave up halfway (a phone losing signal): nothing to count.
    return reply(400);
  }
  if (!body) {
    return reply(413);
  }
  let event: unknown;
  try {
    event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    return reply(400);
  }
  const fields =
    typeof event === 'object' && event !== null && !Array.isArray(event)
      ? (event as Record<string, unknown>)
      : {};
  const url = httpUrl(fields.u);
  const userAgent = request.headers.get('user-agent');
  if (
    !url ||
    url.href !== fields.u ||
    hostnameOf(url.host) !== hostname ||
    typeof fields.n !== 'string' ||
    fields.n === '' ||
    fields.n.length > EVENT_NAME_MAX ||
    !userAgent
  ) {
    return reply(400);
  }
  if (fields.d !== hostname) {
    warn(
      `An event on ${hostname} named another Plausible site; if all do, name the site ${hostname}`,
    );
    return reply(400);
  }
  const address = visitorAddress(
    request.headers
      .get('x-forwarded-for')
      ?.split(',')
      .map((entry) => entry.trim())
      .at(-1),
  );
  if (!address) {
    return reply(202);
  }

  try {
    const response = await send(`${analytics.url}/api/event`, {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'user-agent': userAgent,
        'x-forwarded-for': address,
      },
      body: JSON.stringify(fields),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    await response.body?.cancel();
    // Plausible's own trouble; a 4xx is about the event, which anyone can make bad.
    if (response.status >= 500 || response.status === 429) {
      warn(`Plausible answered ${response.status} to an event`);
    }
  } catch {
    warn('Plausible did not answer an event');
  }
  return reply(202);
};

/** How long the site keeps a script before asking Plausible again, as Plausible's proxy guides do. */
export const SCRIPT_TTL_MS = 5 * 60 * 1000;
/** How long the site waits after Plausible fails before asking again, serving what it has meanwhile. */
export const SCRIPT_RETRY_MS = 60 * 1000;

/** One script: the last copy and when it came, when Plausible last failed, and the fetch under way. */
export interface ScriptEntry {
  body?: string;
  fetchedAt?: number;
  failedAt?: number;
  pending?: Promise<void>;
}

export interface ScriptOptions {
  analytics: Analytics | undefined;
  /** Scripts by file: one per process. */
  cache: Map<string, ScriptEntry>;
  now?: () => number;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  warn?: Warn;
}

const script = (body: string): Response =>
  new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': `public, max-age=${SCRIPT_TTL_MS / 1000}`,
    },
  });

/**
 * Serves the requesting host's Plausible script, fetched from Plausible and kept for five minutes. Requests that
 * arrive during a fetch wait for that one. When Plausible fails, the last copy is served, however old, and Plausible
 * is left alone for a minute; with no copy, 503. A host with no site gets 404. Nothing from Plausible's response but
 * the script itself reaches the browser.
 */
export const serveScript = async (request: Request, options: ScriptOptions): Promise<Response> => {
  const {
    analytics,
    cache,
    now = Date.now,
    timeoutMs = UPSTREAM_TIMEOUT_MS,
    fetch: send = globalThis.fetch,
    warn = throttledWarn,
  } = options;
  const hostname = hostnameOf(request.headers.get('host'));
  const file = hostname === undefined ? undefined : analytics?.sites.get(hostname);
  if (!analytics || !file) {
    return reply(404);
  }
  const entry = cache.get(file) ?? {};
  cache.set(file, entry);
  const at = now();
  const fresh = entry.fetchedAt !== undefined && at - entry.fetchedAt < SCRIPT_TTL_MS;
  const resting = entry.failedAt !== undefined && at - entry.failedAt < SCRIPT_RETRY_MS;
  if (!fresh && !resting) {
    const fetchScript = async () => {
      try {
        const response = await send(`${analytics.url}/js/${file}`, {
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'error',
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`Plausible answered ${response.status}`);
        }
        entry.body = await response.text();
        entry.fetchedAt = now();
      } catch (error) {
        entry.failedAt = now();
        warn(`Could not fetch ${file} from Plausible: ${String(error)}`);
      }
    };
    // Cleared in `.finally`, which always runs later: even a fetch that fails at once can't leave it set for good.
    entry.pending ??= fetchScript().finally(() => {
      entry.pending = undefined;
    });
    await entry.pending;
  }
  return entry.body === undefined ? reply(503) : script(entry.body);
};
