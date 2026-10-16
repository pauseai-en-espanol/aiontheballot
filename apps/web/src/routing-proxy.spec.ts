import { buildRoutingTable } from '@aiontheballot/domain/routing';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import {
  createRoutingProxy,
  PREVIEW_ROOT_HEADER,
  PREVIEW_TOKEN_HEADER,
  readPreviewToken,
} from './routing-proxy';

/** The preview's shared secret in these tests (ADR-0005): fictional. */
const TOKEN = 'un-secreto-de-vista-previa-de-prueba';
const withToken = { [PREVIEW_TOKEN_HEADER]: TOKEN };

const tenant = {
  id: 't-a',
  slug: 'ejemplo-a',
  defaultLocale: 'es',
  enabledLocales: ['es'],
  open: false,
  indexed: true,
  plausibleScript: null,
};
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

  it("answers 404 to the API's revalidation path on a public host, whatever the method (R151)", async () => {
    for (const method of ['GET', 'POST', 'HEAD', 'DELETE']) {
      for (const host of [
        'ejemplo-a.example.test',
        'desconocido.example.test',
        'ejemplo-a.example.test:abc',
      ]) {
        const response = await proxy(
          new NextRequest('http://127.0.0.1:3000/_internal/revalidate', {
            method,
            headers: { host },
          }),
        );
        expect(response.status, `${method} ${host}`).toBe(404);
      }
    }
    const internal = await proxy(
      new NextRequest('http://127.0.0.1:3000/_internal/revalidate', {
        method: 'POST',
        headers: { host: '10.0.0.7:3000' },
      }),
    );
    expect(internal.headers.get('x-middleware-next')).toBe('1');
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
    /** The proxy over the same site with other settings, as a platform admin sets them (PLAN R135). */
    const withSite = (settings: { open?: boolean; indexed?: boolean }) =>
      createRoutingProxy(
        async () =>
          buildRoutingTable([
            {
              tenant: { ...tenant, ...settings },
              hostnames: [
                { hostname: 'ejemplo-a.example.test', isCanonical: true, verified: true },
              ],
            },
          ]),
        { previewHost: 'vista-previa.example.test' },
        TOKEN,
      );
    const modes = withSite({ open: true });
    /** What the proxy told the page, through Next's request-header override. */
    const told = (response: Response) => ({
      mode: response.headers.get('x-middleware-request-x-aiontheballot-site'),
      noindex: response.headers.get('x-middleware-request-x-aiontheballot-noindex'),
      root: response.headers.get('x-middleware-request-x-aiontheballot-root'),
      locale: response.headers.get('x-middleware-request-x-aiontheballot-locale'),
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

    it('is open for a site a platform admin opened: every page', async () => {
      const response = await modes(request('ejemplo-a.example.test', '/generales-2026/partidos/x'));
      expect(told(response)).toEqual({
        mode: 'open',
        noindex: '0',
        root: '',
        locale: 'es',
        rewrite: '/_tenant/ejemplo-a/es/generales-2026/parties/x',
      });
      expect(response.headers.get('x-robots-tag')).toBeNull();
    });

    it('is never indexed for a site kept out of search engines, open or coming soon, pages and images alike', async () => {
      for (const open of [true, false]) {
        const demo = withSite({ open, indexed: false });
        for (const path of ['/', '/og/x.png']) {
          const response = await demo(request('ejemplo-a.example.test', path));
          expect(told(response).noindex, path).toBe('1');
          expect(response.headers.get('x-robots-tag'), path).toBe('noindex, nofollow');
        }
      }
    });

    it('is preview on the preview host, by path, never indexed', async () => {
      const response = await modes(
        request('vista-previa.example.test', '/ejemplo-a/generales-2026', withToken),
      );
      expect(told(response)).toEqual({
        mode: 'preview',
        noindex: '1',
        root: '/ejemplo-a',
        locale: 'es',
        rewrite: '/_tenant/ejemplo-a/es/generales-2026',
      });
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    });

    it("is the proxy's to say, whatever a client sends", async () => {
      const response = await proxy(
        request('ejemplo-a.example.test', '/', {
          'x-aiontheballot-site': 'preview',
          'x-aiontheballot-root': '/otro',
          'x-aiontheballot-locale': 'en',
          'x-aiontheballot-noindex': '1',
        }),
      );
      expect(told(response)).toMatchObject({
        mode: 'coming-soon',
        noindex: '0',
        root: '',
        locale: 'es',
      });
    });
  });

  describe('the preview host (ADR-0005)', () => {
    const previewing = (token?: string) =>
      createRoutingProxy(async () => table, { previewHost: 'vista-previa.example.test' }, token);

    it('takes the token on the preview host whatever its port, as resolve() reads the host', async () => {
      const response = await previewing(TOKEN)(
        request('vista-previa.example.test:4100', '/ejemplo-a/generales-2026', withToken),
      );
      expect(response.headers.get('x-middleware-rewrite')).not.toBeNull();
    });

    it("serves nothing without the preview's token, nor a wrong one, nor with none configured", async () => {
      for (const [proxied, headers] of [
        [previewing(TOKEN), {}],
        [previewing(TOKEN), { [PREVIEW_TOKEN_HEADER]: 'otro-secreto-de-vista-previa-de-prueba' }],
        [previewing(TOKEN), { [PREVIEW_TOKEN_HEADER]: TOKEN.slice(1) }],
        [previewing(undefined), withToken],
        [previewing(''), { [PREVIEW_TOKEN_HEADER]: '' }],
      ] as const) {
        for (const path of ['/ejemplo-a', '/ejemplo-a/es/partidos', '/robots.txt']) {
          const response = await proxied(request('VISTA-PREVIA.example.test:443', path, headers));
          expect(response.status, path).toBe(404);
          expect(response.headers.get('x-middleware-rewrite'), path).toBeNull();
        }
      }
    });

    it('takes only a token of 32 printable characters or more, else stays off', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      expect(readPreviewToken(TOKEN)).toBe(TOKEN);
      expect(readPreviewToken(undefined)).toBeUndefined();
      expect(readPreviewToken('')).toBeUndefined();
      expect(error).not.toHaveBeenCalled();
      for (const weak of ['corto', `${TOKEN}\n`, `${TOKEN} con espacio`, `${TOKEN}ñ`]) {
        expect(readPreviewToken(weak), weak).toBeUndefined();
      }
      // Said once each, never echoing the token.
      expect(error).toHaveBeenCalledTimes(4);
      expect(error.mock.calls.flat().join(' ')).not.toContain(TOKEN);
      error.mockRestore();
    });

    it("builds the preview's links under the root the admin names, only with the token", async () => {
      const root = (headers: Record<string, string>) =>
        previewing(TOKEN)(request('vista-previa.example.test', '/ejemplo-a', headers)).then((r) =>
          r.headers.get('x-middleware-request-x-aiontheballot-root'),
        );
      expect(await root({ ...withToken, [PREVIEW_ROOT_HEADER]: '/t/ejemplo-a/preview' })).toBe(
        '/t/ejemplo-a/preview',
      );
      // Not a root: another host, a relative path, a path's tricks. The site's own root, then.
      for (const sent of [
        'https://otro.example.test/x',
        't/ejemplo-a',
        '/t/../x',
        '//otro',
        '/T/A',
      ]) {
        expect(await root({ ...withToken, [PREVIEW_ROOT_HEADER]: sent }), sent).toBe('/ejemplo-a');
      }
      // A public host never takes it.
      const response = await previewing(TOKEN)(
        request('ejemplo-a.example.test', '/', {
          ...withToken,
          [PREVIEW_ROOT_HEADER]: '/t/x/preview',
        }),
      );
      expect(response.headers.get('x-middleware-request-x-aiontheballot-root')).toBe('');
    });

    it("redirects under the admin's root", async () => {
      const response = await previewing(TOKEN)(
        request('vista-previa.example.test', '/ejemplo-a/es/partidos', {
          ...withToken,
          [PREVIEW_ROOT_HEADER]: '/t/ejemplo-a/preview',
        }),
      );
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/t/ejemplo-a/preview/partidos');
    });
  });

  it("answers robots.txt at the root of the hosts that serve sites by path, and leaves a site's own to it", async () => {
    const hosts = createRoutingProxy(
      async () => table,
      {
        previewHost: 'vista-previa.example.test',
        platformHost: 'plataforma.example.test',
      },
      TOKEN,
    );
    const preview = await hosts(request('vista-previa.example.test', '/robots.txt', withToken));
    expect(preview.status).toBe(200);
    expect(await preview.text()).toBe('User-agent: *\nDisallow: /\n');
    const platform = await hosts(request('plataforma.example.test', '/robots.txt'));
    expect(await platform.text()).toBe('User-agent: *\nAllow: /\n');
    const own = await hosts(request('ejemplo-a.example.test', '/robots.txt'));
    expect(new URL(own.headers.get('x-middleware-rewrite') ?? '').pathname).toBe(
      '/_tenant/ejemplo-a/es/robots.txt',
    );
    // Without routing data, the preview host still keeps crawlers off; the platform host can't name its sitemaps.
    const unrouted = createRoutingProxy(
      async () => undefined,
      {
        previewHost: 'vista-previa.example.test',
        platformHost: 'plataforma.example.test',
      },
      TOKEN,
    );
    expect(
      await (await unrouted(request('vista-previa.example.test', '/robots.txt', withToken))).text(),
    ).toBe('User-agent: *\nDisallow: /\n');
    expect((await unrouted(request('plataforma.example.test', '/robots.txt'))).status).toBe(503);
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
