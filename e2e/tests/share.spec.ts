import { messages } from '@aiontheballot/i18n/messages';
import { expect, type Page, test } from '@playwright/test';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';

import { PLATFORM_HOST, PORTS, SEED_HOSTS, TENANT_URL } from '../servers.js';

/** The seeds' canonical bases: https, as every share URL is built from the routing table, never the request. */
const CANONICAL_A = `https://${SEED_HOSTS.canonical}`;
const CANONICAL_B = `https://${PLATFORM_HOST}/ejemplo-b`;

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/**
 * GETs a URL from the e2e web server by its Host header, the way the gateway forwards it: canonical https addresses
 * included, and without resolving `*.localhost`, which browsers do but Node doesn't on every system.
 */
const get = (url: string, headers: Record<string, string> = {}): Promise<Answer> => {
  const { hostname, pathname, search } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: PORTS.web,
        path: `${pathname}${search}`,
        headers: { host: hostname, ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
};

const meta = (page: Page, key: string) =>
  page.locator(`meta[property="${key}"], meta[name="${key}"]`).getAttribute('content');

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

test.describe('link previews (fictional seeds)', () => {
  test('give crawlers the canonical address, the texts and a share image', async ({ page }) => {
    await page.goto(TENANT_URL);

    const title = `Inquilino de ejemplo A · ${messages.es.home.comingSoon}`;
    expect(await meta(page, 'og:type')).toBe('website');
    expect(await meta(page, 'og:url')).toBe(CANONICAL_A);
    expect(await meta(page, 'og:site_name')).toBe('Inquilino de ejemplo A');
    expect(await meta(page, 'og:title')).toBe(title);
    expect(await meta(page, 'og:description')).toContain('Organización de ejemplo A');
    expect(await meta(page, 'og:locale')).toBe('es_XA');
    expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toBe(CANONICAL_A);
    expect(await meta(page, 'twitter:card')).toBe('summary_large_image');
    expect(await meta(page, 'twitter:title')).toBe(title);

    const image = await meta(page, 'og:image');
    expect(image).toMatch(new RegExp(`^${CANONICAL_A}/og/home\\.1200x630\\.[0-9a-f]{12}\\.png$`));
    expect(await meta(page, 'og:image:width')).toBe('1200');
    expect(await meta(page, 'og:image:height')).toBe('630');
    expect(await meta(page, 'og:image:alt')).toContain('Inquilino de ejemplo A');
    expect(await meta(page, 'twitter:image')).toBe(image);
  });

  test("put the tags in <head> for any crawler, even one Next doesn't know", async () => {
    for (const userAgent of [
      'Mastodon/4.3.0 (http.rb/5.2.0; +https://mastodon.example/)',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'WhatsApp/2.24.1 A',
    ]) {
      const html = (await get(`${CANONICAL_A}/`, { 'user-agent': userAgent })).body.toString();
      const head = html.slice(0, html.indexOf('</head>'));
      expect(head, userAgent).toContain('property="og:image"');
      expect(head, userAgent).toContain('name="twitter:card"');
    }
  });

  test('serve the image once per content, cached as immutable', async ({ page }) => {
    await page.goto(TENANT_URL);
    const image = (await meta(page, 'og:image')) ?? '';

    const first = await get(image);
    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toBe('image/png');
    expect(first.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(first.headers['set-cookie']).toBeUndefined();
    const png = first.body;
    expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
    // WhatsApp drops previews over about 300 KB.
    expect(png.byteLength).toBeLessThan(300 * 1024);

    const etag = first.headers.etag ?? '';
    expect(etag).toMatch(/^"[0-9a-f]{12}"$/);
    for (const header of [etag, `W/${etag}`, `"000000000000", ${etag}`]) {
      expect((await get(image, { 'if-none-match': header })).status, header).toBe(304);
    }
  });

  test('redirect an outdated or made-up hash to the current image, without rendering it', async ({
    page,
  }) => {
    await page.goto(TENANT_URL);
    const current = (await meta(page, 'og:image')) ?? '';

    const stale = await get(`${CANONICAL_A}/og/home.1200x630.000000000000.png`);
    expect(stale.status).toBe(307);
    expect(stale.headers.location).toBe(current);
    expect(stale.headers['cache-control']).toBe('public, max-age=60');

    for (const path of [
      '/og/home.1200x631.000000000000.png',
      '/og/other.1200x630.000000000000.png',
      '/og/home.1200x630.png',
    ]) {
      expect((await get(`${CANONICAL_A}${path}`)).status, path).toBe(404);
    }
  });

  test('render every share size: square, portrait and story', async () => {
    for (const [size, width, height] of [
      ['1080x1080', 1080, 1080],
      ['1080x1350', 1080, 1350],
      ['1080x1920', 1080, 1920],
    ] as const) {
      const location =
        (await get(`${CANONICAL_A}/og/home.${size}.000000000000.png`)).headers.location ?? '';
      expect(location).toMatch(new RegExp(`/og/home\\.${size}\\.[0-9a-f]{12}\\.png$`));
      const image = await get(location);
      expect(image.status, size).toBe(200);
      expect(pngSize(image.body)).toEqual({ width, height });
    }
  });

  test("describe a locale's page in that locale, with its alternates", async ({ page }) => {
    await page.goto(`http://${PLATFORM_HOST}:${PORTS.web}/ejemplo-b/en`);

    expect(await meta(page, 'og:url')).toBe(`${CANONICAL_B}/en`);
    // og:locale only names the tenant's own language; there's no og:locale:alternate for separate pages.
    expect(await page.locator('meta[property="og:locale"]').count()).toBe(0);
    expect(await page.locator('meta[property="og:locale:alternate"]').count()).toBe(0);
    expect(await meta(page, 'og:title')).toBe(`Example tenant B · ${messages.en.home.comingSoon}`);
    const hreflang = (lang: string) =>
      page.locator(`link[rel="alternate"][hreflang="${lang}"]`).getAttribute('href');
    expect(await hreflang('es')).toBe(CANONICAL_B);
    expect(await hreflang('en')).toBe(`${CANONICAL_B}/en`);
    expect(await hreflang('x-default')).toBe(CANONICAL_B);

    const image = (await meta(page, 'og:image')) ?? '';
    expect(image).toMatch(
      new RegExp(`^${CANONICAL_B}/en/og/home\\.1200x630\\.[0-9a-f]{12}\\.png$`),
    );
    expect((await get(image)).status).toBe(200);
  });
});

test.describe("tenants' own logos (fictional seeds)", () => {
  test("show on each surface, served once from the tenant's address and cached as immutable", async ({
    page,
  }) => {
    await page.goto(TENANT_URL);

    const header = page.locator('header img');
    const footer = page.locator('footer img');
    await expect(header).toHaveAttribute('alt', 'Organización de ejemplo A');
    const src = (await header.getAttribute('src')) ?? '';
    expect(src).toMatch(/^\/brand\/[0-9a-f]{64}\.png$/);
    expect(await footer.getAttribute('src')).toBe(src);
    // The seeds' fictional logo is 240×64.
    await expect(header).toHaveJSProperty('naturalWidth', 240);

    const image = await get(`${CANONICAL_A}${src}`);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(pngSize(image.body)).toEqual({ width: 240, height: 64 });
    expect(
      (await get(`${CANONICAL_A}${src}`, { 'if-none-match': image.headers.etag ?? '' })).status,
    ).toBe(304);
  });

  test("serve nothing the tenant doesn't show, and leave the line in words without one", async ({
    page,
  }) => {
    for (const path of [
      `/brand/${'0'.repeat(64)}.png`,
      `/brand/${'0'.repeat(64)}.gif`,
      '/brand/logo.png',
    ]) {
      expect((await get(`${CANONICAL_A}${path}`)).status, path).toBe(404);
    }
    await page.goto(`http://${PLATFORM_HOST}:${PORTS.web}/ejemplo-b`);
    expect(await page.locator('img').count()).toBe(0);
    await expect(
      page.getByText('Una iniciativa de Organización de ejemplo B').first(),
    ).toBeVisible();
  });
});
