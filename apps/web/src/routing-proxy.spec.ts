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

  describe("a site's mode", () => {
    const modes = createRoutingProxy(
      async () => table,
      { previewHost: 'vista-previa.example.test' },
      { openSites: new Set(['ejemplo-a']) },
    );
    /** What the proxy told the page, through Next's request-header override. */
    const told = (response: Response) => ({
      mode: response.headers.get('x-middleware-request-x-aiontheballot-site'),
      root: response.headers.get('x-middleware-request-x-aiontheballot-root'),
      rewrite: new URL(response.headers.get('x-middleware-rewrite') ?? 'http://x/').pathname,
    });

    it('is coming soon unless the site is open: the home and the always-on pages only', async () => {
      for (const path of [
        '/',
        '/aviso-legal',
        '/privacidad',
        '/avisos/confirmar',
        '/og/x.png',
        '/favicon.ico',
      ]) {
        const response = await proxy(request('ejemplo-a.example.test', path));
        expect(told(response), path).toMatchObject({ mode: 'coming-soon', root: '' });
      }
      for (const path of [
        '/generales-2026',
        '/generales-2026/partidos/x',
        '/robots',
        '//generales-2026',
      ]) {
        expect((await proxy(request('ejemplo-a.example.test', path))).status, path).toBe(404);
      }
    });

    it('is open for a site OPEN_SITES lists: every page', async () => {
      const response = await modes(request('ejemplo-a.example.test', '/generales-2026/partidos/x'));
      expect(told(response)).toEqual({
        mode: 'open',
        root: '',
        rewrite: '/_tenant/ejemplo-a/es/generales-2026/parties/x',
      });
      expect(response.headers.get('x-robots-tag')).toBeNull();
    });

    it('is preview on the preview host, by path, never indexed', async () => {
      const response = await modes(
        request('vista-previa.example.test', '/ejemplo-a/generales-2026'),
      );
      expect(told(response)).toEqual({
        mode: 'preview',
        root: '/ejemplo-a',
        rewrite: '/_tenant/ejemplo-a/es/generales-2026',
      });
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    });

    it("is the proxy's to say, whatever a client sends", async () => {
      const response = await proxy(
        request('ejemplo-a.example.test', '/', {
          'x-aiontheballot-site': 'preview',
          'x-aiontheballot-root': '/otro',
        }),
      );
      expect(told(response)).toMatchObject({ mode: 'coming-soon', root: '' });
    });
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
