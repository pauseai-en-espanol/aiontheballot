import type { PublicHome } from '@aiontheballot/domain/public-home';

import { describe, expect, it, vi } from 'vitest';

import { createHomeLoader } from './home-data';

const API = 'http://api.example.test:3001';

const home = (name: string): PublicHome => ({
  tenant: { displayName: { es: name }, defaultLocale: 'es', methodologyKind: 'demands' },
  operator: { displayName: { es: 'Organización de ejemplo' }, url: null, contactEmail: null },
  election: null,
});

const respond = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the home data loader', () => {
  it("fetches a tenant's data from the API and keeps it until it is too old", async () => {
    let now = 0;
    const fetch = vi.fn(async () => respond(home('Ejemplo')));
    const load = createHomeLoader({ apiUrl: API, maxAgeMs: 1_000, fetch, now: () => now });
    expect(await load('ejemplo-a')).toEqual({ kind: 'found', home: home('Ejemplo') });
    await load('ejemplo-a');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.at(0))).toBe(`${API}/public/tenants/ejemplo-a/home`);
    now = 1_000;
    await load('ejemplo-a');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps each tenant apart', async () => {
    const load = createHomeLoader({
      apiUrl: API,
      fetch: async (url) =>
        respond(home((url as URL).pathname.includes('/ejemplo-b/') ? 'B' : 'A')),
    });
    expect(await load('ejemplo-a')).toEqual({ kind: 'found', home: home('A') });
    expect(await load('ejemplo-b')).toEqual({ kind: 'found', home: home('B') });
  });

  it('shares one request between concurrent loads', async () => {
    const fetch = vi.fn(async () => respond(home('Ejemplo')));
    const load = createHomeLoader({ apiUrl: API, fetch });
    await Promise.all([load('ejemplo-a'), load('ejemplo-a')]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports a slug the API does not know as missing', async () => {
    const load = createHomeLoader({ apiUrl: API, fetch: async () => respond({}, 404) });
    expect(await load('ejemplo-a')).toEqual({ kind: 'missing' });
  });

  it('keeps the last good copy when a refresh fails', async () => {
    let now = 0;
    const responses = [respond(home('Ejemplo')), respond({ error: 'down' }, 503)];
    const load = createHomeLoader({
      apiUrl: API,
      maxAgeMs: 1,
      fetch: async () => responses.shift() ?? respond({}, 500),
      now: () => now,
    });
    await load('ejemplo-a');
    now = 10;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await load('ejemplo-a')).toEqual({ kind: 'found', home: home('Ejemplo') });
  });

  it('is unavailable without an API, or before the first successful load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await createHomeLoader({ apiUrl: undefined })('ejemplo-a')).toEqual({
      kind: 'unavailable',
    });
    const failing = createHomeLoader({ apiUrl: API, fetch: async () => respond({}, 500) });
    expect(await failing('ejemplo-a')).toEqual({ kind: 'unavailable' });
  });
});
