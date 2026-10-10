import { createRoutingProxy } from './routing-proxy';
import { loadRoutingTable, routingConfig } from './tenant-data';

export const proxy = createRoutingProxy(loadRoutingTable, routingConfig);

// Build assets skip the proxy; resolve() would serve them on any host anyway.
export const config = {
  matcher: ['/((?!_next/static/|_next/image).*)'],
};
