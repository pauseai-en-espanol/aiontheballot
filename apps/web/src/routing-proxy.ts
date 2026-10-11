import {
  buildRoutingTable,
  pathHostRobots,
  resolve,
  type RoutingConfig,
  type RoutingTable,
} from '@aiontheballot/domain/routing';
import { type NextRequest, NextResponse } from 'next/server';

import {
  servedWhileComingSoon,
  SITE_LOCALE_HEADER,
  SITE_MODE_HEADER,
  SITE_ROOT_HEADER,
  type SiteMode,
} from './site-mode';

/** With no routing data yet, nothing is a tenant: only system paths (the health probe, build assets) resolve. */
const EMPTY = buildRoutingTable([]);

const plain = (status: number, body: string): NextResponse =>
  new NextResponse(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

/**
 * Routes a request by its Host header, never X-Forwarded-Host (ADR-0002, routing): a tenant's page is rewritten to the
 * internal /_tenant/{slug}/{locale}/… path, an alias or a platform path redirects to the canonical address, and anything
 * else is a generic 404. Without routing data it answers 503, but still lets system paths (the kubelet's health probe)
 * through. The Host header only selects public content.
 *
 * It also decides what a site shows (public-site spec §2): a site not in `openSites` is coming soon, and serves only
 * its home and always-on pages; the preview host shows every site as open, marked never to be indexed. Pages learn the
 * mode and their root from request headers set here, over whatever a client sent.
 */
export const createRoutingProxy =
  (
    routingTable: () => Promise<RoutingTable | undefined>,
    config: RoutingConfig,
    { openSites = new Set<string>() }: { openSites?: ReadonlySet<string> } = {},
  ) =>
  async (request: NextRequest): Promise<NextResponse> => {
    const table = await routingTable();
    // Crawlers read robots.txt only at a host's root, where the preview and platform hosts serve no site.
    const robots =
      request.nextUrl.pathname === '/robots.txt'
        ? pathHostRobots(request.headers.get('host') ?? '', table, config)
        : undefined;
    if (robots !== undefined) {
      return new NextResponse(robots, {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'public, max-age=300',
        },
      });
    }
    const resolution = resolve(
      {
        host: request.headers.get('host') ?? '',
        path: request.nextUrl.pathname,
        search: request.nextUrl.search,
      },
      table ?? EMPTY,
      config,
    );
    if (!table && resolution.kind !== 'system') {
      return plain(503, 'Service unavailable');
    }
    switch (resolution.kind) {
      case 'system':
        return NextResponse.next();
      case 'redirect':
        return NextResponse.redirect(resolution.location, 301);
      case 'serve': {
        const { tenant, locale, internalPath, root, preview } = resolution;
        const mode: SiteMode = preview
          ? 'preview'
          : openSites.has(tenant.slug)
            ? 'open'
            : 'coming-soon';
        if (mode === 'coming-soon' && !servedWhileComingSoon(internalPath, tenant.slug, locale)) {
          return plain(404, 'Not found');
        }
        const headers = new Headers(request.headers);
        headers.set(SITE_MODE_HEADER, mode);
        headers.set(SITE_ROOT_HEADER, root);
        headers.set(SITE_LOCALE_HEADER, locale);
        // Resolved against the request's own URL, so Next rewrites internally (another origin would make it fetch
        // that URL over the network).
        const response = NextResponse.rewrite(
          new URL(`${internalPath}${request.nextUrl.search}`, request.url),
          { request: { headers } },
        );
        if (preview) {
          response.headers.set('x-robots-tag', 'noindex, nofollow');
        }
        return response;
      }
      default:
        return plain(404, 'Not found');
    }
  };
