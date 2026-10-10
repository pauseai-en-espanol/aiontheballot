import { messages } from '@aiontheballot/i18n/messages';
import { expect, type Page, test } from '@playwright/test';

import { PLATFORM_HOST, PORTS, SEED_HOSTS, TENANT_URL } from '../servers.js';

/** The seeds' canonical bases: https, as every share URL is built from the routing table, never the request. */
const CANONICAL_A = `https://${SEED_HOSTS.canonical}`;
const CANONICAL_B = `https://${PLATFORM_HOST}/ejemplo-b`;
/** Where those addresses are served in the e2e stack: plain http on the web server's port. */
const local = (url: string) =>
  url
    .replace(CANONICAL_A, TENANT_URL)
    .replace(CANONICAL_B, `http://${PLATFORM_HOST}:${PORTS.web}/ejemplo-b`);

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

  test("put the tags in <head> for any crawler, even one Next doesn't know", async ({
    request,
  }) => {
    for (const userAgent of [
      'Mastodon/4.3.0 (http.rb/5.2.0; +https://mastodon.example/)',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'WhatsApp/2.24.1 A',
    ]) {
      const html = await (
        await request.get(TENANT_URL, { headers: { 'user-agent': userAgent } })
      ).text();
      const head = html.slice(0, html.indexOf('</head>'));
      expect(head, userAgent).toContain('property="og:image"');
      expect(head, userAgent).toContain('name="twitter:card"');
    }
  });

  test('serve the image once per content, cached as immutable', async ({ page, request }) => {
    await page.goto(TENANT_URL);
    const image = local((await meta(page, 'og:image')) ?? '');

    const first = await request.get(image);
    expect(first.status()).toBe(200);
    expect(first.headers()['content-type']).toBe('image/png');
    expect(first.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(first.headers()['set-cookie']).toBeUndefined();
    const png = await first.body();
    expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
    // WhatsApp drops previews over about 300 KB.
    expect(png.byteLength).toBeLessThan(300 * 1024);

    const etag = first.headers().etag ?? '';
    expect(etag).toMatch(/^"[0-9a-f]{12}"$/);
    for (const header of [etag, `W/${etag}`, `"000000000000", ${etag}`]) {
      const again = await request.get(image, { headers: { 'if-none-match': header } });
      expect(again.status(), header).toBe(304);
    }
  });

  test('redirect an outdated or made-up hash to the current image, without rendering it', async ({
    page,
    request,
  }) => {
    await page.goto(TENANT_URL);
    const current = (await meta(page, 'og:image')) ?? '';

    const stale = await request.get(`${TENANT_URL}/og/home.1200x630.000000000000.png`, {
      maxRedirects: 0,
    });
    expect(stale.status()).toBe(307);
    expect(stale.headers().location).toBe(current);
    expect(stale.headers()['cache-control']).toBe('public, max-age=60');

    for (const path of [
      '/og/home.1200x631.000000000000.png',
      '/og/other.1200x630.000000000000.png',
      '/og/home.1200x630.png',
    ]) {
      expect((await request.get(`${TENANT_URL}${path}`, { maxRedirects: 0 })).status(), path).toBe(
        404,
      );
    }
  });

  test('render every share size: square, portrait and story', async ({ request }) => {
    for (const [size, width, height] of [
      ['1080x1080', 1080, 1080],
      ['1080x1350', 1080, 1350],
      ['1080x1920', 1080, 1920],
    ] as const) {
      const stale = await request.get(`${TENANT_URL}/og/home.${size}.000000000000.png`, {
        maxRedirects: 0,
      });
      const location = stale.headers().location ?? '';
      expect(location).toMatch(new RegExp(`/og/home\\.${size}\\.[0-9a-f]{12}\\.png$`));
      const image = await request.get(local(location));
      expect(image.status(), size).toBe(200);
      expect(pngSize(await image.body())).toEqual({ width, height });
    }
  });

  test("describe a locale's page in that locale, with its alternates", async ({
    page,
    request,
  }) => {
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
    expect((await request.get(local(image))).status()).toBe(200);
  });
});
