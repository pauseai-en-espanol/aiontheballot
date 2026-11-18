import { buildRoutingTable } from '@aiontheballot/domain/routing';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { createRoutingProxy } from './routing-proxy';
import { previewChannel, relayShare, sendShareCount, sitePathOf } from './share-counts';

const tenant = {
  id: 't-a',
  slug: 'ejemplo-a',
  defaultLocale: 'es',
  enabledLocales: ['es', 'en'],
  open: true,
  indexed: true,
  plausibleScript: null,
};
const table = buildRoutingTable([
  {
    tenant,
    hostnames: [{ hostname: 'ejemplo-a.example.test', isCanonical: true, verified: true }],
  },
]);
const config = { platformHost: 'plataforma.example.test', previewHost: 'vista.example.test' };
const API = 'http://api.example.test';

/** A fetch that records what it is sent, as the API would receive it. */
const recorder = () => {
  const sent: { url: string; body: unknown; visitor: string | null }[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    sent.push({
      url: url instanceof Request ? url.url : url instanceof URL ? url.href : url,
      body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}'),
      visitor: new Headers(init?.headers).get('x-visitor-address'),
    });
    return new Response(null, { status: 204 });
  };
  return { sent, fetch };
};

describe('link previews, by the crawler that draws them (PLAN R239)', () => {
  it.each([
    ['WhatsApp/2.23.20.0 A', 'whatsapp'],
    ['TelegramBot (like TwitterBot)', 'telegram'],
    ['Twitterbot/1.0', 'x'],
    ['facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'facebook'],
    [
      'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
      'linkedin',
    ],
    ['Mozilla/5.0 (compatible; Bluesky Cardyb/1.1; +mailto:support@bsky.app)', 'bluesky'],
    ['Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)', 'slack'],
    ['Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)', 'discord'],
    ['Mastodon/4.2.0 (http.rb/5.1.1; +https://mastodon.example.test/)', 'other'],
  ])('knows %s as %s', (userAgent, channel) => {
    expect(previewChannel(userAgent)).toBe(channel);
  });

  it.each([
    [
      'a browser',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
    ],
    ['a search engine', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
    ['an AI crawler', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2)'],
    ['nothing at all', null],
  ])('counts no preview for %s', (_name, userAgent) => {
    expect(previewChannel(userAgent)).toBeUndefined();
  });
});

describe("a page's path inside its site, the same in every language", () => {
  it.each([
    ['/_tenant/ejemplo-a/es', '/'],
    [
      '/_tenant/ejemplo-a/es/generales/parties/partido-ejemplo-a',
      '/generales/parties/partido-ejemplo-a',
    ],
    ['/_tenant/ejemplo-a/en/generales/table', '/generales/table'],
  ])('reads %s as %s', (internal, path) => {
    const [, , , locale = ''] = internal.split('/');
    expect(sitePathOf(internal, 'ejemplo-a', locale)).toBe(path);
  });

  it.each([
    ['a share image', '/_tenant/ejemplo-a/es/generales/og/overview.1200x630.0123456789ab.png'],
    ['a logo', '/_tenant/ejemplo-a/es/brand/logo/96-aaaa.png'],
    ['the favicon', '/_tenant/ejemplo-a/es/favicon.ico'],
    ['another site', '/_tenant/ejemplo-b/es/generales'],
  ])('is no page for %s', (_name, internal) => {
    expect(sitePathOf(internal, 'ejemplo-a', 'es')).toBeUndefined();
  });
});

describe('the share relay (PLAN R239)', () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    new Request('https://ejemplo-a.example.test/_relay/shares', {
      method: 'POST',
      headers: {
        host: 'ejemplo-a.example.test',
        'x-forwarded-for': '198.51.100.4, 203.0.113.7',
        ...headers,
      },
      body: JSON.stringify(body),
    });

  it("counts a share from a page's dialog for its site and page, whatever the page's language", async () => {
    const { sent, fetch } = recorder();
    const response = await relayShare(
      post({
        u: 'https://ejemplo-a.example.test/en/generales/tabla?utm_source=x',
        event: 'share',
        channel: 'copy',
      }),
      { table, config, apiUrl: API, fetch },
    );
    expect(response.status).toBe(204);
    expect(sent).toEqual([
      {
        url: `${API}/public/tenants/ejemplo-a/shares`,
        body: { path: '/generales/table', event: 'share', channel: 'copy' },
        // The gateway's own entry, only for the API's rate limit.
        visitor: '203.0.113.7',
      },
    ]);
  });

  it('counts an arrival through a network’s link', async () => {
    const { sent, fetch } = recorder();
    await relayShare(
      post({
        u: 'https://ejemplo-a.example.test/generales',
        event: 'arrival',
        channel: 'whatsapp',
      }),
      { table, config, apiUrl: API, fetch },
    );
    expect(sent.map(({ body }) => body)).toEqual([
      { path: '/generales', event: 'arrival', channel: 'whatsapp' },
    ]);
  });

  it.each([
    [
      'a preview’s event, which only the proxy counts',
      { event: 'preview', channel: 'whatsapp' },
      400,
    ],
    ['an arrival through the copy button', { event: 'arrival', channel: 'copy' }, 400],
    ['a channel it doesn’t know', { event: 'share', channel: 'myspace' }, 400],
    ['another host’s page', { u: 'https://otro.example.test/generales' }, 403],
    ['an address that is no page', { u: 'https://ejemplo-a.example.test/generales/og/x.png' }, 404],
  ])('counts nothing for %s', async (_name, change, status) => {
    const { sent, fetch } = recorder();
    const response = await relayShare(
      post({
        u: 'https://ejemplo-a.example.test/generales',
        event: 'share',
        channel: 'whatsapp',
        ...change,
      }),
      { table, config, apiUrl: API, fetch },
    );
    expect(response.status).toBe(status);
    expect(sent).toEqual([]);
  });

  it('counts nothing sent from another site’s page', async () => {
    const { sent, fetch } = recorder();
    const response = await relayShare(
      post(
        { u: 'https://ejemplo-a.example.test/generales', event: 'share', channel: 'x' },
        { origin: 'https://otro.example.test' },
      ),
      { table, config, apiUrl: API, fetch },
    );
    expect(response.status).toBe(403);
    expect(sent).toEqual([]);
  });

  it('never fails the page when the API is away', async () => {
    await expect(
      sendShareCount('ejemplo-a', { path: '/', event: 'share', channel: 'copy' }, '', {
        apiUrl: API,
        fetch: async () => {
          throw new Error('API down');
        },
      }),
    ).resolves.toBeUndefined();
  });
});

describe('the proxy counting link previews (PLAN R239)', () => {
  const counted: unknown[] = [];
  const waited: Promise<unknown>[] = [];
  const proxy = createRoutingProxy(
    async () => table,
    config,
    undefined,
    async (...args) => {
      counted.push(args);
    },
  );
  const request = (path: string, userAgent: string, host = 'ejemplo-a.example.test') =>
    new NextRequest(`http://127.0.0.1:3000${path}`, {
      headers: { host, 'user-agent': userAgent, 'x-forwarded-for': '203.0.113.7' },
    });
  const event = { waitUntil: (promise: Promise<unknown>) => waited.push(promise) } as never;

  it("counts a network's crawler fetching a page, for its path, without the page waiting on it", async () => {
    counted.length = 0;
    waited.length = 0;
    const response = await proxy(
      request('/generales/partidos/partido-ejemplo-a', 'WhatsApp/2.23.20.0 A'),
      event,
    );
    expect(new URL(response.headers.get('x-middleware-rewrite') ?? '').pathname).toBe(
      '/_tenant/ejemplo-a/es/generales/parties/partido-ejemplo-a',
    );
    expect(counted).toEqual([
      ['ejemplo-a', '/generales/parties/partido-ejemplo-a', 'whatsapp', '203.0.113.7'],
    ]);
    expect(waited).toHaveLength(1);
  });

  it('counts nothing for a visitor, a share image, or the preview host', async () => {
    counted.length = 0;
    await proxy(request('/generales', 'Mozilla/5.0 (Macintosh) Safari/605.1.15'), event);
    await proxy(
      request('/generales/og/overview.1200x630.0123456789ab.png', 'Twitterbot/1.0'),
      event,
    );
    await proxy(request('/ejemplo-a/generales', 'Twitterbot/1.0', 'vista.example.test'), event);
    expect(counted).toEqual([]);
  });
});
