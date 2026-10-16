import type { PublicHome } from '@aiontheballot/domain/public-home';

import { describe, expect, it, vi } from 'vitest';

import { createHomeLoader } from './home-data';

const API = 'http://api.example.test:3001';

const home = (name: string): PublicHome => ({
  tenant: {
    displayName: { es: name },
    defaultLocale: 'es',
    countryCode: 'XA',
    methodologyKind: 'demands',
    theme: {},
  },
  operator: {
    displayName: { es: 'Organización de ejemplo' },
    url: null,
    contactEmail: null,
    newsletterUrl: null,
    legalName: 'Organización de Ejemplo',
    taxId: null,
    address: null,
    registryEntry: null,
    privacyEmail: null,
  },
  documents: {},
  elections: [],
  signups: false,
  election: null,
  brand: {},
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

describe('the home data loader', () => {
  it('refetches when forced, after the fetch on its way, once for a burst, and never older over newer (R151)', async () => {
    const { fetch, answer } = byHand();
    const load = createHomeLoader({ apiUrl: API, fetch });
    const before = load('ejemplo-a');
    const forced = [load('ejemplo-a', { force: true }), load('ejemplo-a', { force: true })];
    // The fetch on its way may have started before the change: the forces wait for one of their own.
    expect(fetch).toHaveBeenCalledTimes(1);
    answer(home('Antes'));
    expect(await before).toEqual({ kind: 'found', home: home('Antes') });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    answer(home('Después'));
    for (const result of await Promise.all(forced)) {
      expect(result).toEqual({ kind: 'found', home: home('Después') });
    }
    expect(await load('ejemplo-a')).toEqual({ kind: 'found', home: home('Después') });
    // A fresh copy is refetched all the same when forced.
    const again = load('ejemplo-a', { force: true });
    expect(fetch).toHaveBeenCalledTimes(3);
    answer(home('Otra vez'));
    expect(await again).toEqual({ kind: 'found', home: home('Otra vez') });
  });

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

  it("reads the admin's preview's data with its secret, never the public's (PLAN R181)", async () => {
    const fetch = vi.fn(async () => respond(home('Ejemplo')));
    const token = 'un-secreto-de-vista-previa-de-mas-de-32-caracteres';
    const load = createHomeLoader({ apiUrl: API, fetch, preview: { token } });
    await load('ejemplo-a');
    expect(String(fetch.mock.calls[0]?.at(0))).toBe(`${API}/preview/tenants/ejemplo-a/home`);
    expect((fetch.mock.calls[0] as unknown[] | undefined)?.at(1)).toMatchObject({
      headers: { 'x-aiontheballot-preview-token': token },
    });
    // The public loader sends no secret.
    const publicFetch = vi.fn(async () => respond(home('Ejemplo')));
    await createHomeLoader({ apiUrl: API, fetch: publicFetch })('ejemplo-a');
    expect((publicFetch.mock.calls[0] as unknown[] | undefined)?.at(1)).toMatchObject({
      headers: {},
    });
  });

  it("shows the public's data while the API has no preview configured (503), never failing the preview", async () => {
    const href = (input: URL | RequestInfo): string =>
      input instanceof Request ? input.url : input.toString();
    const fetch = vi.fn(async (url: URL | RequestInfo) =>
      href(url).includes('/preview/')
        ? respond({ error: 'Not configured' }, 503)
        : respond(home('Ejemplo')),
    );
    const token = 'un-secreto-de-vista-previa-de-mas-de-32-caracteres';
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const load = createHomeLoader({ apiUrl: API, fetch, preview: { token } });
    expect(await load('ejemplo-a')).toEqual({ kind: 'found', home: home('Ejemplo') });
    errors.mockRestore();
    expect(fetch.mock.calls.map(([url]) => href(url))).toEqual([
      `${API}/preview/tenants/ejemplo-a/home`,
      `${API}/public/tenants/ejemplo-a/home`,
    ]);
    // The public route is never sent the secret.
    expect((fetch.mock.calls[1] as unknown[] | undefined)?.at(1)).toMatchObject({ headers: {} });
  });

  it('refetches on request, but at most once per interval', async () => {
    let now = 0;
    const fetch = vi.fn(async () => respond(home('Ejemplo')));
    const load = createHomeLoader({
      apiUrl: API,
      maxAgeMs: 60_000,
      freshAfterMs: 5_000,
      fetch,
      now: () => now,
    });
    await load('ejemplo-a');
    now = 1_000;
    await load('ejemplo-a', { fresh: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    now = 5_000;
    await load('ejemplo-a', { fresh: true });
    await load('ejemplo-a', { fresh: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fills in fields an older API doesn't send yet, so a rollout can't break pages", async () => {
    const {
      brand: _brand,
      documents: _documents,
      signups: _signups,
      elections: _elections,
      ...older
    } = home('Ejemplo');
    const { legalName: _legal, taxId: _tax, ...olderOperator } = older.operator;
    const load = createHomeLoader({
      apiUrl: API,
      fetch: async () => respond({ ...older, operator: olderOperator }),
    });
    expect(await load('ejemplo-a')).toEqual({
      kind: 'found',
      home: { ...home('Ejemplo'), operator: { ...home('Ejemplo').operator, legalName: '' } },
    });
  });

  it("keeps only colours a site can be drawn in, so a bad one leaves the platform's (R178)", async () => {
    const withTheme = (theme: unknown) => {
      const sent = home('Ejemplo');
      return createHomeLoader({
        apiUrl: API,
        fetch: async () => respond({ ...sent, tenant: { ...sent.tenant, theme } }),
      });
    };
    const themeOf = async (theme: unknown) => {
      const result = await withTheme(theme)('ejemplo-a');
      return result.kind === 'found' ? result.home.tenant.theme : undefined;
    };
    expect(await themeOf({ accent: '#1d3557' })).toEqual({ accent: '#1d3557' });
    // Unreadable, malformed, unknown or not an object at all: the page would throw drawing it.
    expect(await themeOf({ accent: '#777777' })).toEqual({});
    expect(await themeOf({ accent: 'red;}' })).toEqual({});
    expect(await themeOf({ accent: '#1D3557', later: '#123456' })).toEqual({});
    expect(await themeOf('#1d3557')).toEqual({});
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
