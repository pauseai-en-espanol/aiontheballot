/**
 * Public-site routing (ADR-0002, Routing): which tenant, if any, a request is for. The Host header only selects
 * public content; it never grants access, and it is never echoed back: redirects are built from the routing table.
 */

/** What routing needs to know about a tenant. Only active tenants are ever in the table. */
export interface TenantRoute {
  id: string;
  slug: string;
  defaultLocale: string;
  /** Public locales, including the default one. */
  enabledLocales: readonly string[];
}

export interface TenantHostname {
  hostname: string;
  isCanonical: boolean;
  verified: boolean;
}

export interface RoutingTable {
  hosts: ReadonlyMap<string, { tenant: TenantRoute; verified: boolean }>;
  tenantsBySlug: ReadonlyMap<string, TenantRoute>;
  canonicalHosts: ReadonlyMap<string, string>;
}

export interface RoutingConfig {
  /** The shared platform domain, which serves `/{tenant-slug}/…`. Optional: the Spain pilot runs without one. */
  platformHost?: string;
}

export interface RoutingRequest {
  /** The Host header, as received. X-Forwarded-Host and similar headers must never be passed here. */
  host: string;
  /** The path, percent-encoded as received, starting with `/`. */
  path: string;
  /** The query string, empty or starting with `?`. */
  search: string;
}

export type Resolution =
  /** Build assets, the health probe and the error relay: served as they are, on any host. */
  | { kind: 'system' }
  | { kind: 'not-found' }
  /** Always a 301, to an absolute URL on the tenant's canonical base. */
  | { kind: 'redirect'; location: string }
  | { kind: 'serve'; tenant: TenantRoute; locale: string; path: string; internalPath: string };

/**
 * Served pages are rewritten under this prefix, with the tenant and locale in the path, so render caches can never
 * mix tenants. Requests can't target it: every path whose first segment starts with `_` (even percent-encoded) is
 * reserved and gets 404, apart from the system paths. Slugs can never start with `_`.
 */
export const INTERNAL_PREFIX = '/_tenant';

const SYSTEM_PREFIXES = ['/_next/', '/_relay/'];
const SYSTEM_PATHS = ['/healthz'];

const NOT_FOUND: Resolution = { kind: 'not-found' };

/**
 * Normalizes a Host header: lowercase, no port, no trailing dot, IDNs in punycode. Returns undefined for anything
 * that isn't a plain hostname (userinfo, paths, IP literals with garbage, empty).
 */
export const normalizeHost = (host: string): string | undefined => {
  // `%` too: URL parsing would decode it, so `ex%61mple.org` would pass for `example.org`.
  if (host === '' || /[\s@/\\?#%]/u.test(host)) {
    return undefined;
  }
  let hostname: string;
  try {
    ({ hostname } = new URL(`http://${host}`));
  } catch {
    return undefined;
  }
  hostname = hostname.replace(/\.$/u, '');
  return hostname === '' ? undefined : hostname;
};

/**
 * Builds the routing table from the public hostname data, checking the same invariants as the database
 * (ADR-0002, Hostnames), so a bad row can't make routing ambiguous.
 */
export const buildRoutingTable = (
  tenants: readonly { tenant: TenantRoute; hostnames: readonly TenantHostname[] }[],
  config: RoutingConfig = {},
): RoutingTable => {
  const hosts = new Map<string, { tenant: TenantRoute; verified: boolean }>();
  const tenantsBySlug = new Map<string, TenantRoute>();
  const canonicalHosts = new Map<string, string>();
  for (const { tenant, hostnames } of tenants) {
    if (tenantsBySlug.has(tenant.slug)) {
      throw new Error(`Duplicate tenant slug ${tenant.slug}`);
    }
    if (!tenant.enabledLocales.includes(tenant.defaultLocale)) {
      throw new Error(`Tenant ${tenant.slug}: the default locale must be enabled`);
    }
    tenantsBySlug.set(tenant.slug, tenant);
    for (const { hostname, isCanonical, verified } of hostnames) {
      if (normalizeHost(hostname) !== hostname) {
        throw new Error(`Hostname ${hostname} is not normalized`);
      }
      if (hostname === config.platformHost) {
        throw new Error(`Hostname ${hostname} is reserved for the platform`);
      }
      if (hosts.has(hostname)) {
        throw new Error(`Hostname ${hostname} belongs to two tenants`);
      }
      hosts.set(hostname, { tenant, verified });
      if (isCanonical) {
        if (!verified) {
          throw new Error(`Hostname ${hostname} is canonical but not verified`);
        }
        if (canonicalHosts.has(tenant.id)) {
          throw new Error(`Tenant ${tenant.slug} has two canonical hostnames`);
        }
        canonicalHosts.set(tenant.id, hostname);
      }
    }
  }
  return { hosts, tenantsBySlug, canonicalHosts };
};

/**
 * The tenant's canonical base URL: its canonical hostname, else `{platform}/{slug}`, else none (the tenant is not
 * publicly reachable). The only source for rel=canonical, OG and share URLs, sitemaps and the URL on images.
 */
export const canonicalBase = (
  table: RoutingTable,
  tenant: TenantRoute,
  config: RoutingConfig = {},
): string | undefined => {
  const canonicalHost = table.canonicalHosts.get(tenant.id);
  if (canonicalHost) {
    return `https://${canonicalHost}`;
  }
  return config.platformHost ? `https://${config.platformHost}/${tenant.slug}` : undefined;
};

/** Whether the first path segment, percent-decoded, starts with `_` (reserved). Malformed encodings count too. */
const isReserved = (path: string): boolean => {
  const [, first = ''] = path.split('/');
  try {
    return decodeURIComponent(first).startsWith('_');
  } catch {
    return true;
  }
};

/**
 * Serves `path` (relative to the tenant's root) for the tenant, or redirects a default-locale prefix to the
 * unprefixed URL so every page has one address. Other enabled locales are prefixed: `/ca/generales-2026`.
 */
const serve = (
  table: RoutingTable,
  tenant: TenantRoute,
  path: string,
  search: string,
  config: RoutingConfig,
) => {
  const [, first = ''] = path.split('/');
  let locale = tenant.defaultLocale;
  let rest = path;
  if (first !== '' && tenant.enabledLocales.includes(first)) {
    rest = path.slice(first.length + 1) || '/';
    if (first === tenant.defaultLocale) {
      const base = canonicalBase(table, tenant, config);
      return base
        ? ({ kind: 'redirect', location: `${base}${rest}${search}` } as const)
        : NOT_FOUND;
    }
    locale = first;
  }
  const internalPath = `${INTERNAL_PREFIX}/${tenant.slug}/${locale}${rest === '/' ? '' : rest}`;
  return { kind: 'serve', tenant, locale, path: rest, internalPath } as const;
};

/**
 * Resolves a public request (ADR-0002, Routing):
 *
 * 1. Build assets, the health probe and the error relay pass through on any host; other `_` paths are 404.
 * 2. On the platform host, `/{slug}/…` is served, or 301s to the tenant's canonical host when it has one.
 * 3. A verified alias 301s to the tenant's canonical base, same path and query.
 * 4. The canonical hostname serves.
 * 5. Anything else, unverified hostnames included, is 404. There is never a default tenant.
 */
export const resolve = (
  request: RoutingRequest,
  table: RoutingTable,
  config: RoutingConfig = {},
): Resolution => {
  const { path, search } = request;
  // Paths and queries arrive percent-encoded; anything else could smuggle a header into a Location.
  if (
    !path.startsWith('/') ||
    /[^\x21-\x7e]/u.test(path + search) ||
    (search !== '' && !search.startsWith('?'))
  ) {
    return NOT_FOUND;
  }
  if (SYSTEM_PATHS.includes(path) || SYSTEM_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return { kind: 'system' };
  }
  if (isReserved(path)) {
    return NOT_FOUND;
  }
  const host = normalizeHost(request.host);
  if (!host) {
    return NOT_FOUND;
  }

  if (host === config.platformHost) {
    const [, slug = ''] = path.split('/');
    const tenant = table.tenantsBySlug.get(slug);
    if (!tenant) {
      return NOT_FOUND;
    }
    const rest = path.slice(slug.length + 1) || '/';
    const canonicalHost = table.canonicalHosts.get(tenant.id);
    if (canonicalHost) {
      return { kind: 'redirect', location: `https://${canonicalHost}${rest}${search}` };
    }
    return serve(table, tenant, rest, search, config);
  }

  const entry = table.hosts.get(host);
  if (!entry?.verified) {
    return NOT_FOUND;
  }
  if (table.canonicalHosts.get(entry.tenant.id) === host) {
    return serve(table, entry.tenant, path, search, config);
  }
  const base = canonicalBase(table, entry.tenant, config);
  return base ? { kind: 'redirect', location: `${base}${path}${search}` } : NOT_FOUND;
};
