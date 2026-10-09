import {
  buildRoutingTable,
  resolve,
  type RoutingConfig,
  type RoutingTable,
} from '@aiontheballot/domain/routing';
import { type NextRequest, NextResponse } from 'next/server';

/** With no routing data yet, nothing is a tenant: only system paths (the health probe, build assets) resolve. */
const EMPTY = buildRoutingTable([]);

const plain = (status: number, body: string): NextResponse =>
  new NextResponse(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

/**
 * Routes a request by its Host header, never X-Forwarded-Host (ADR-0002, routing): a tenant's page is rewritten to the
 * internal /_tenant/{slug}/{locale}/… path, an alias or a platform path redirects to the canonical address, and anything
 * else is a generic 404. Without routing data it answers 503, but still lets system paths (the kubelet's health probe)
 * through. The Host header only selects public content.
 */
export const createRoutingProxy =
  (routingTable: () => Promise<RoutingTable | undefined>, config: RoutingConfig) =>
  async (request: NextRequest): Promise<NextResponse> => {
    const table = await routingTable();
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
      case 'serve':
        // Resolved against the request's own URL, so Next rewrites internally (another origin would make it fetch
        // that URL over the network).
        return NextResponse.rewrite(
          new URL(`${resolution.internalPath}${request.nextUrl.search}`, request.url),
        );
      default:
        return plain(404, 'Not found');
    }
  };
