import { createRoutingProxy, readPreviewToken } from './routing-proxy';
import { loadRoutingTable, routingConfig } from './tenant-data';

// The preview's shared secret (ADR-0005): without it, the preview host serves nothing.
export const proxy = createRoutingProxy(
  loadRoutingTable,
  routingConfig,
  readPreviewToken(process.env.PREVIEW_TOKEN),
);

// Build assets skip the proxy; resolve() would serve them on any host anyway. `/_next/image` is no longer one: the
// image optimizer is off (next.config.js), so it is an unknown path like any other.
export const config = {
  matcher: ['/((?!_next/static/).*)'],
};
