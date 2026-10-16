import { describe, expect, it, vi } from 'vitest';

import { createRoutingTableLoader, type RoutingData } from './routing-table';

const data = (slug: string): RoutingData => ({
  tenants: [
    {
      tenant: {
        id: `id-${slug}`,
        slug,
        defaultLocale: 'es',
        enabledLocales: ['es'],
        open: false,
        indexed: true,
        plausibleScript: null,
      },
      hostnames: [{ hostname: `${slug}.example.test`, isCanonical: true, verified: true }],
    },
  ],
});

const respond = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fetch whose answers are given by hand, in order, to see what overlaps. */
const byHand = () => {
  const pending: ((response: Response) => void)[] = [];
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        pending.push(resolve);
      }),
  );
  return { fetch, answer: (body: unknown) => pending.shift()?.(respond(body)) };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the routing table loader', () => {
  it('refetches when forced, after the fetch on its way, once for a burst, and never older over newer (R151)', async () => {
    const { fetch, answer } = byHand();
    const load = createRoutingTableLoader({
      apiUrl: 'http://api.example.test:3001',
      config: {},
      fetch,
    });
    const before = load();
    const forced = [load({ force: true }), load({ force: true })];
    expect(fetch).toHaveBeenCalledTimes(1);
    answer(data('antes'));
    expect((await before)?.tenantsBySlug.has('antes')).toBe(true);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    answer(data('despues'));
    for (const table of await Promise.all(forced)) {
      expect([...(table?.tenantsBySlug.keys() ?? [])]).toEqual(['despues']);
    }
    expect((await load())?.tenantsBySlug.has('despues')).toBe(true);
    const again = load({ force: true });
    expect(fetch).toHaveBeenCalledTimes(3);
    answer(data('otra'));
    expect((await again)?.tenantsBySlug.has('otra')).toBe(true);
  });

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

  it("reads an older API's data, without the public settings, as their defaults: never hidden by mistake", async () => {
    const old = {
      tenants: [
        {
          tenant: { id: 'id-a', slug: 'ejemplo-a', defaultLocale: 'es', enabledLocales: ['es'] },
          hostnames: [{ hostname: 'ejemplo-a.example.test', isCanonical: true, verified: true }],
        },
      ],
    };
    const load = createRoutingTableLoader({
      apiUrl: 'http://api.example.test:3001',
      config: {},
      fetch: async () => respond(old),
    });
    expect((await load())?.tenantsBySlug.get('ejemplo-a')).toMatchObject({
      open: false,
      indexed: true,
      plausibleScript: null,
    });
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
