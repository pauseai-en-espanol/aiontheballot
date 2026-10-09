import { createRoutingProxy } from './routing-proxy';
import { createRoutingTableLoader } from './routing-table';

// The platform domain is optional (ADR-0002, hostnames): without it, tenants are reachable only on their own hostnames.
const routing = { platformHost: process.env.PLATFORM_HOST || undefined };

export const proxy = createRoutingProxy(
  createRoutingTableLoader({ apiUrl: process.env.API_URL, config: routing }),
  routing,
);

// Build assets skip the proxy; resolve() would serve them on any host anyway.
export const config = {
  matcher: ['/((?!_next/static/|_next/image).*)'],
};
