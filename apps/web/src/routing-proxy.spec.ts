import { buildRoutingTable } from '@aiontheballot/domain/routing';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { createRoutingProxy } from './routing-proxy';

const tenant = { id: 't-a', slug: 'ejemplo-a', defaultLocale: 'es', enabledLocales: ['es'] };
const table = buildRoutingTable([
  {
    tenant,
    hostnames: [
      { hostname: 'ejemplo-a.example.test', isCanonical: true, verified: true },
      { hostname: 'alias-a.example.test', isCanonical: false, verified: true },
    ],
  },
]);
const proxy = createRoutingProxy(async () => table, {});

const request = (host: string, path = '/', headers: Record<string, string> = {}): NextRequest =>
  new NextRequest(`http://127.0.0.1:3000${path}`, { headers: { host, ...headers } });

describe('the routing proxy', () => {
  it("rewrites a tenant's canonical host to its internal path", async () => {
    const response = await proxy(request('ejemplo-a.example.test', '/'));
    expect(new URL(response.headers.get('x-middleware-rewrite') ?? '').pathname).toBe(
      '/_tenant/ejemplo-a/es',
    );
  });

  it('redirects an alias to the canonical host, keeping the path and query', async () => {
    const response = await proxy(request('alias-a.example.test', '/partidos?orden=1'));
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe(
      'https://ejemplo-a.example.test/partidos?orden=1',
    );
  });

  it('answers 404 to an unknown host, whatever X-Forwarded-Host says', async () => {
    const response = await proxy(
      request('desconocido.example.test', '/', { 'x-forwarded-host': 'ejemplo-a.example.test' }),
    );
    expect(response.status).toBe(404);
  });

  it('answers 404 to the internal prefix, encoded or not', async () => {
    for (const path of ['/_tenant/ejemplo-a/es', '/%5Ftenant/ejemplo-a/es']) {
      expect((await proxy(request('ejemplo-a.example.test', path))).status).toBe(404);
    }
  });

  it('lets the health probe through on any host', async () => {
    const response = await proxy(request('10.0.0.7:3000', '/healthz'));
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('answers 503 without routing data, never serving a default tenant, but keeps the health probe up', async () => {
    const unavailable = createRoutingProxy(async () => undefined, {});
    expect((await unavailable(request('ejemplo-a.example.test'))).status).toBe(503);
    expect(
      (await unavailable(request('10.0.0.7:3000', '/healthz'))).headers.get('x-middleware-next'),
    ).toBe('1');
  });

  it('sets no cookie', async () => {
    for (const host of [
      'ejemplo-a.example.test',
      'alias-a.example.test',
      'desconocido.example.test',
    ]) {
      expect((await proxy(request(host))).headers.get('set-cookie')).toBeNull();
    }
  });
});
