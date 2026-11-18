import { createRoutingProxy, readPreviewToken } from './routing-proxy';
import { sendShareCount } from './share-counts';
import { loadRoutingTable, routingConfig } from './tenant-data';

// The preview's shared secret (ADR-0005): without it, the preview host serves nothing.
export const proxy = createRoutingProxy(
  loadRoutingTable,
  routingConfig,
  readPreviewToken(process.env.PREVIEW_TOKEN),
  // Link previews drawn of a site's pages, counted by the API (PLAN R239).
  (slug, path, channel, visitor) =>
    sendShareCount(slug, { path, event: 'preview', channel }, visitor, {
      apiUrl: process.env.API_URL,
    }),
);

// Build assets skip the proxy; resolve() would serve them on any host anyway. `/_next/image` is no longer one: the
// image optimizer is off (next.config.js), so it is an unknown path like any other.
export const config = {
  matcher: ['/((?!_next/static/).*)'],
};
