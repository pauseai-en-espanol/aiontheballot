import { describe, expect, it, vi } from 'vitest';

import { createRoutingTableLoader, type RoutingData } from './routing-table';

const data = (slug: string): RoutingData => ({
  tenants: [
    {
      tenant: { id: `id-${slug}`, slug, defaultLocale: 'es', enabledLocales: ['es'] },
      hostnames: [{ hostname: `${slug}.example.test`, isCanonical: true, verified: true }],
    },
  ],
});

const respond = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the routing table loader', () => {
  it('fetches the table from the API and keeps it until it is too old', async () => {
    let now = 0;
    const fetch = vi.fn(async () => respond(data('ejemplo-a')));
    const load = createRoutingTableLoader({
      apiUrl: 'http://api.example.test:3001',
      config: {},
      maxAgeMs: 1_000,
      fetch,
      now: () => now,
    });
    expect((await load())?.tenantsBySlug.has('ejemplo-a')).toBe(true);
    await load();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.at(0))).toBe('http://api.example.test:3001/public/routing');
    now = 1_000;
    await load();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good table when a refresh fails', async () => {
    let now = 0;
    const responses = [respond(data('ejemplo-a')), respond({ error: 'down' }, 503)];
    const load = createRoutingTableLoader({
      apiUrl: 'http://api.example.test:3001',
      config: {},
      maxAgeMs: 1,
      fetch: async () => responses.shift() ?? respond({}, 500),
      now: () => now,
    });
    await load();
    now = 10;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await load())?.tenantsBySlug.has('ejemplo-a')).toBe(true);
  });

  it('has no table without an API, or before the first successful load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await createRoutingTableLoader({ apiUrl: undefined, config: {} })()).toBeUndefined();
    const failing = createRoutingTableLoader({
      apiUrl: 'http://api.example.test:3001',
      config: {},
      fetch: async () => respond({}, 500),
    });
    expect(await failing()).toBeUndefined();
  });

  it('refuses data that breaks a hostname invariant, rather than routing by it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = data('ejemplo-a');
    broken.tenants[0]!.hostnames.push({
      hostname: 'otro.example.test',
      isCanonical: true,
      verified: true,
    });
    const load = createRoutingTableLoader({
      apiUrl: 'http://api.example.test:3001',
      config: {},
      fetch: async () => respond(broken),
    });
    expect(await load()).toBeUndefined();
  });
});
