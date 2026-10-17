import {
  buildRoutingTable,
  normalizeHost,
  pathHostRobots,
  resolve,
  type RoutingConfig,
  type RoutingTable,
} from '@aiontheballot/domain/routing';
import { type NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

import { isInternalHost, REVALIDATE_PATH } from './revalidate';
import {
  servedWhileComingSoon,
  SITE_LOCALE_HEADER,
  SITE_MODE_HEADER,
  SITE_NOINDEX_HEADER,
  SITE_ROOT_HEADER,
  type SiteMode,
} from './site-mode';

/** With no routing data yet, nothing is a tenant: only system paths (the health probe, build assets) resolve. */
const EMPTY = buildRoutingTable([]);

const plain = (status: number, body: string): NextResponse =>
  new NextResponse(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

/** A system path's answer. The API's word that a site changed is for the cluster only: from the internet, a 404. */
const system = (request: NextRequest): NextResponse =>
  request.nextUrl.pathname === REVALIDATE_PATH && !isInternalHost(request.headers.get('host'))
    ? plain(404, 'Not found')
    : NextResponse.next();

/** The secret the admin's preview sends (ADR-0005), and the root it serves the preview under. */
export const PREVIEW_TOKEN_HEADER = 'x-aiontheballot-preview-token';
export const PREVIEW_ROOT_HEADER = 'x-aiontheballot-preview-root';

/** A root the preview's links may be built under: an absolute path of plain segments, such as `/t/ejemplo-a/preview`. */
const PREVIEW_ROOT = /^(?:\/[a-z0-9]+(?:-[a-z0-9]+)*){1,4}$/;

/**
 * The preview's token as configured (PREVIEW_TOKEN): at least 32 printable ASCII characters with no spaces, as the
 * worker's secret, or none, which leaves the preview host off. A short or mistyped one is refused rather than used.
 */
export const readPreviewToken = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  if (!/^[\x21-\x7e]{32,}$/u.test(value)) {
    console.error(
      'PREVIEW_TOKEN must be 32 or more printable ASCII characters: the preview host is off',
    );
    return undefined;
  }
  return value;
};

/** Whether a request carries the preview's token: compared in constant time; never without one configured. */
const carriesToken = (sent: string | null, token: string | undefined): boolean => {
  if (!token || !sent) {
    return false;
  }
  const a = Buffer.from(sent);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Routes a request by its Host header, never X-Forwarded-Host (ADR-0002, routing): a tenant's page is rewritten to the
 * internal /_tenant/{slug}/{locale}/… path, an alias or a platform path redirects to the canonical address, and anything
 * else is a generic 404. Without routing data it answers 503, but still lets system paths (the kubelet's health probe)
 * through; they are answered before the routing data is awaited, so a slow API never fails the probe (PLAN R211). The
 * Host header only selects public content.
 *
 * It also decides what a site shows (public-site spec §2): a site a platform admin hasn't opened is coming soon, and
 * serves only its home and always-on pages; the preview host shows every site as open, marked never to be indexed, as
 * is a site a platform admin keeps out of search engines, wherever it is served (a demo's fictional content; PLAN
 * R135). Pages learn the mode, their root and whether they may be indexed from request headers set here, over whatever
 * a client sent.
 *
 * The preview host answers only the admin's preview (ADR-0005): a request that carries the shared token, which only
 * the admin and this app hold; anything else there is a 404, and with no token configured the preview host is off. It
 * is an in-cluster name no gateway routes. With the token, a root the admin names (its own path for the site's
 * preview) replaces `/{slug}` in the page's links and in a redirect, so navigation stays in the admin.
 */
export const createRoutingProxy =
  (
    routingTable: () => Promise<RoutingTable | undefined>,
    config: RoutingConfig,
    previewToken?: string,
  ) =>
  async (request: NextRequest): Promise<NextResponse> => {
    // The host as resolve() reads it: lowercase, without a port.
    const onPreviewHost =
      config.previewHost !== undefined &&
      normalizeHost(request.headers.get('host') ?? '') === config.previewHost;
    const preview =
      onPreviewHost && carriesToken(request.headers.get(PREVIEW_TOKEN_HEADER), previewToken);
    const sentRoot = request.headers.get(PREVIEW_ROOT_HEADER);
    const previewRoot = preview && sentRoot && PREVIEW_ROOT.test(sentRoot) ? sentRoot : undefined;
    const target = {
      host: request.headers.get('host') ?? '',
      path: request.nextUrl.pathname,
      search: request.nextUrl.search,
    };
    // resolve() decides system paths before it reads the table, on every host: no need to wait for it.
    if (resolve(target, EMPTY, config).kind === 'system') {
      return system(request);
    }
    const table = await routingTable();
    // Crawlers read robots.txt only at a host's root, where the preview and platform hosts serve no site.
    const robots =
      request.nextUrl.pathname === '/robots.txt'
        ? pathHostRobots(request.headers.get('host') ?? '', table, config)
        : undefined;
    if (robots !== undefined) {
      if (onPreviewHost && !preview) {
        return plain(404, 'Not found');
      }
      return new NextResponse(robots, {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'public, max-age=300',
        },
      });
    }
    const resolution = resolve(target, table ?? EMPTY, config);
    if (!table && resolution.kind !== 'system') {
      return plain(503, 'Service unavailable');
    }
    switch (resolution.kind) {
      case 'system':
        return system(request);
      case 'redirect': {
        if (onPreviewHost && !preview) {
          return plain(404, 'Not found');
        }
        // On the preview host, `https://{previewHost}/{slug}/…`: under the admin's root, the same page there.
        const previewBase = `https://${config.previewHost}/`;
        if (previewRoot && resolution.location.startsWith(previewBase)) {
          const [, ...rest] = resolution.location.slice(previewBase.length).split('/');
          return new NextResponse(null, {
            status: 301,
            headers: { location: `${previewRoot}${rest.length > 0 ? `/${rest.join('/')}` : ''}` },
          });
        }
        return NextResponse.redirect(resolution.location, 301);
      }
      case 'serve': {
        const { tenant, locale, internalPath } = resolution;
        if (resolution.preview && !preview) {
          return plain(404, 'Not found');
        }
        const root = (resolution.preview && previewRoot) || resolution.root;
        const mode: SiteMode = resolution.preview
          ? 'preview'
          : tenant.open
            ? 'open'
            : 'coming-soon';
        if (mode === 'coming-soon' && !servedWhileComingSoon(internalPath, tenant.slug, locale)) {
          return plain(404, 'Not found');
        }
        const noindex = resolution.preview || !tenant.indexed;
        const headers = new Headers(request.headers);
        headers.set(SITE_MODE_HEADER, mode);
        headers.set(SITE_NOINDEX_HEADER, noindex ? '1' : '0');
        headers.set(SITE_ROOT_HEADER, root);
        headers.set(SITE_LOCALE_HEADER, locale);
        // Resolved against the request's own URL, so Next rewrites internally (another origin would make it fetch
        // that URL over the network).
        const response = NextResponse.rewrite(
          new URL(`${internalPath}${request.nextUrl.search}`, request.url),
          { request: { headers } },
        );
        if (noindex) {
          response.headers.set('x-robots-tag', 'noindex, nofollow');
        }
        return response;
      }
      default:
        return plain(404, 'Not found');
    }
  };
