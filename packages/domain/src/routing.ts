import { TENANT_LEVEL_SEGMENTS, toInternalPath } from './site-paths.js';

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
  /** Open to the public, or still coming soon: a platform admin's switch (public-site spec §2; PLAN R135). */
  open: boolean;
  /** Whether search engines may index it, wherever it is served: a demo's fictional content may not be (PLAN R135). */
  indexed: boolean;
  /** Its Plausible script (`pa-….js`), counted on its canonical host only; null without one (PLAN R83, R135). */
  plausibleScript: string | null;
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
  /**
   * The preview host (public-site spec §2): `/{tenant-slug}/…` for every active tenant, as if its site were open, never
   * redirected to a canonical host. An in-cluster name the admin's preview uses with a shared token (ADR-0005), which
   * the web app's proxy checks. Optional.
   */
  previewHost?: string;
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
  /** Build assets, the health probe and the relays (errors, analytics): served as they are, on any host. */
  | { kind: 'system' }
  | { kind: 'not-found' }
  /** Always a 301, to an absolute URL on the tenant's canonical base. */
  | { kind: 'redirect'; location: string }
  | {
      kind: 'serve';
      tenant: TenantRoute;
      locale: string;
      path: string;
      internalPath: string;
      /** Where the tenant's root is on this host, for links between its pages: `` or `/{slug}`. */
      root: string;
      /** Served on the preview host. */
      preview: boolean;
    };

/**
 * Served pages are rewritten under this prefix, with the tenant and locale in the path, so render caches can never
 * mix tenants. Requests can't target it: every path whose first segment starts with `_` (even percent-encoded) is
 * reserved and gets 404, apart from the system paths. Slugs can never start with `_`.
 */
export const INTERNAL_PREFIX = '/_tenant';

/** Paths served as they are on every host, before any tenant: their first segments are never an election's. */
export const SYSTEM_PREFIXES: readonly string[] = ['/_next/', '/_relay/'];
/** The health probe, and where the API says a site changed (R151), which answers only on internal hosts. */
export const SYSTEM_PATHS: readonly string[] = ['/healthz', '/_internal/revalidate'];

/**
 * What an election's slug can never be. An election's pages live at `/{slug}` (ADR-0003 §6), and these first segments
 * are paths the public site serves itself on a tenant's address: brand images and site icons (`/brand/…`), share
 * images (`/og/…`), the health probe (`/healthz`, answered on every host before routing), and the site's own pages in
 * every language's words (`/aviso-legal`, `/legal-notice`…, public-site spec §3). The database refuses them
 * (migrations `reserved_election_slugs`, `reserved_site_paths`); a web test checks every route and system path is here
 * or can't be a slug.
 */
export const RESERVED_ELECTION_SLUGS: readonly string[] = [
  'brand',
  'healthz',
  'og',
  ...TENANT_LEVEL_SEGMENTS,
].sort();

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
      if (hostname === config.platformHost || hostname === config.previewHost) {
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

/**
 * The robots.txt of a host that serves tenants by path (public-site spec §8), which crawlers read only at a host's
 * root: on the preview host, nothing is to be crawled; on the platform host, everything, with the sitemap of each
 * tenant whose canonical base is there but one never to be indexed (undefined without routing data). Undefined for any
 * other host, which serves its own tenant's robots.txt.
 */
export const pathHostRobots = (
  requestHost: string,
  table: RoutingTable | undefined,
  config: RoutingConfig = {},
): string | undefined => {
  const host = normalizeHost(requestHost);
  if (!host) {
    return undefined;
  }
  // The preview host's needs no routing data, so it holds while the API is away.
  if (host === config.previewHost) {
    return 'User-agent: *\nDisallow: /\n';
  }
  if (host !== config.platformHost || !table) {
    return undefined;
  }
  const sitemaps = [...table.tenantsBySlug.values()]
    .filter((tenant) => !table.canonicalHosts.has(tenant.id) && tenant.indexed)
    .map((tenant) => `Sitemap: https://${host}/${tenant.slug}/sitemap.xml\n`)
    .sort();
  return `User-agent: *\nAllow: /\n${sitemaps.join('')}`;
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
  on: { root: string; preview: boolean },
): Resolution => {
  const [, first = ''] = path.split('/');
  let locale = tenant.defaultLocale;
  let rest = path;
  if (first !== '' && tenant.enabledLocales.includes(first)) {
    rest = path.slice(first.length + 1) || '/';
    if (first === tenant.defaultLocale) {
      // On the preview host, to the same page there; elsewhere, to the canonical address.
      const base = on.preview
        ? `https://${config.previewHost}/${tenant.slug}`
        : canonicalBase(table, tenant, config);
      return base ? { kind: 'redirect', location: `${base}${rest}${search}` } : NOT_FOUND;
    }
    locale = first;
  }
  // The site's words onto the app's routes; an app word the site doesn't use is no page (public-site spec §3).
  const internal = toInternalPath(tenant.defaultLocale, rest);
  if (internal === undefined) {
    return NOT_FOUND;
  }
  const internalPath = `${INTERNAL_PREFIX}/${tenant.slug}/${locale}${internal === '/' ? '' : internal}`;
  return { kind: 'serve', tenant, locale, path: rest, internalPath, ...on };
};

/**
 * Resolves a public request (ADR-0002, Routing):
 *
 * 1. Build assets, the health probe and the relays pass through on any host; other `_` paths are 404.
 * 2. On the preview host, `/{slug}/…` is served for every tenant, never redirected to its canonical host.
 * 3. On the platform host, `/{slug}/…` is served, or 301s to the tenant's canonical host when it has one.
 * 4. A verified alias 301s to the tenant's canonical base, same path and query.
 * 5. The canonical hostname serves.
 * 6. Anything else, unverified hostnames included, is 404. There is never a default tenant.
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

  if (host === config.previewHost || host === config.platformHost) {
    const [, slug = ''] = path.split('/');
    const tenant = table.tenantsBySlug.get(slug);
    if (!tenant) {
      return NOT_FOUND;
    }
    const rest = path.slice(slug.length + 1) || '/';
    const preview = host === config.previewHost;
    const canonicalHost = table.canonicalHosts.get(tenant.id);
    if (canonicalHost && !preview) {
      return { kind: 'redirect', location: `https://${canonicalHost}${rest}${search}` };
    }
    return serve(table, tenant, rest, search, config, { root: `/${slug}`, preview });
  }

  const entry = table.hosts.get(host);
  if (!entry?.verified) {
    return NOT_FOUND;
  }
  if (table.canonicalHosts.get(entry.tenant.id) === host) {
    return serve(table, entry.tenant, path, search, config, { root: '', preview: false });
  }
  const base = canonicalBase(table, entry.tenant, config);
  return base ? { kind: 'redirect', location: `${base}${path}${search}` } : NOT_FOUND;
};
