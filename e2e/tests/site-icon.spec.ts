import { expect, type Page, test } from '@playwright/test';

import { get, pngSize } from '../fetch-by-host.js';
import { decodePng } from '../png.js';
import { PLATFORM_HOST, PORTS, SEED_HOSTS, TENANT_URL } from '../servers.js';

/**
 * ejemplo-a has its own icon in the seeds (a white frame on teal, 512 px); ejemplo-b has none, so it gets the
 * platform's default (the ballot with the sparkle, on orange).
 */
const CANONICAL_A = `https://${SEED_HOSTS.canonical}`;
const CANONICAL_B = `https://${PLATFORM_HOST}/ejemplo-b`;
const PAGE_B = `http://${PLATFORM_HOST}:${PORTS.web}/ejemplo-b`;

const IMMUTABLE = 'public, max-age=31536000, immutable';

/** The icons a page names in its head, by rel and size. */
const icons = async (page: Page) => {
  const href = (selector: string) => page.locator(selector).getAttribute('href');
  return {
    icon32: (await href('link[rel="icon"][sizes="32x32"]')) ?? '',
    icon16: (await href('link[rel="icon"][sizes="16x16"]')) ?? '',
    apple: (await href('link[rel="apple-touch-icon"][sizes="180x180"]')) ?? '',
    shortcut: (await href('link[rel="shortcut icon"]')) ?? '',
    manifest: (await href('link[rel="manifest"]')) ?? '',
  };
};

/** The sizes inside an .ico: its directory's entries (0 would mean 256). */
const icoSizes = (ico: Buffer): number[] => {
  expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]);
  return Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico.readUInt8(6 + 16 * i));
};

test.describe('site icons (fictional seeds)', () => {
  test("name the tenant's own icon by content hash, at every size a browser asks for", async ({
    page,
  }) => {
    await page.goto(TENANT_URL);
    const named = await icons(page);
    expect(named.icon32).toMatch(/^\/brand\/icon\/32\.[0-9a-f]{12}\.png$/);
    expect(named.icon16).toMatch(/^\/brand\/icon\/16\.[0-9a-f]{12}\.png$/);
    expect(named.apple).toMatch(/^\/brand\/icon\/180\.[0-9a-f]{12}\.png$/);
    expect(named.shortcut).toBe('/favicon.ico');
    expect(named.manifest).toBe('/manifest.webmanifest');

    for (const [path, side] of [
      [named.icon16, 16],
      [named.icon32, 32],
      [named.apple, 180],
    ] as const) {
      const icon = await get(`${CANONICAL_A}${path}`);
      expect(icon.status, path).toBe(200);
      expect(icon.headers['content-type']).toBe('image/png');
      expect(icon.headers['cache-control']).toBe(IMMUTABLE);
      expect(pngSize(icon.body)).toEqual({ width: side, height: side });
      expect(
        (await get(`${CANONICAL_A}${path}`, { 'if-none-match': icon.headers.etag ?? '' })).status,
      ).toBe(304);
    }
  });

  test('redirect an outdated or made-up hash to the current icon, and know no other size', async ({
    page,
  }) => {
    await page.goto(TENANT_URL);
    const { icon32 } = await icons(page);
    const stale = await get(`${CANONICAL_A}/brand/icon/32.000000000000.png`);
    expect(stale.status).toBe(307);
    expect(stale.headers.location).toBe(`${CANONICAL_A}${icon32}`);
    for (const path of [
      icon32.replace('/32.', '/64.'),
      '/brand/icon/32.png',
      '/brand/icon/32.0123456789AB.png',
    ]) {
      expect((await get(`${CANONICAL_A}${path}`)).status, path).toBe(404);
    }
  });

  test('serve /favicon.ico with the 16, 32 and 48 px icons', async () => {
    const ico = await get(`${CANONICAL_A}/favicon.ico`);
    expect(ico.status).toBe(200);
    expect(ico.headers['content-type']).toBe('image/x-icon');
    expect(ico.headers['cache-control']).toBe('public, max-age=86400');
    expect(icoSizes(ico.body)).toEqual([16, 32, 48]);
    expect(
      (await get(`${CANONICAL_A}/favicon.ico`, { 'if-none-match': ico.headers.etag ?? '' })).status,
    ).toBe(304);
  });

  test("give each tenant its own icon, and the platform's default to one without", async ({
    page,
  }) => {
    await page.goto(TENANT_URL);
    const a = await icons(page);
    await page.goto(PAGE_B);
    const b = await icons(page);
    // On the platform host, the tenant's addresses sit under its path.
    expect(b.icon32).toMatch(/^\/ejemplo-b\/brand\/icon\/32\.[0-9a-f]{12}\.png$/);
    expect(b.shortcut).toBe('/ejemplo-b/favicon.ico');
    expect(b.manifest).toBe('/ejemplo-b/manifest.webmanifest');
    expect(b.icon32.replace('/ejemplo-b', '')).not.toBe(a.icon32);

    const [iconA, iconB] = await Promise.all([
      get(`${CANONICAL_A}${a.icon32}`),
      get(`https://${PLATFORM_HOST}${b.icon32}`),
    ]);
    expect(iconB.status).toBe(200);
    // What each shows: A's frame (teal, white, teal from the edge in), B's ballot (an ink sparkle on white, on orange).
    const pictureA = decodePng(iconA.body);
    expect([pictureA.at(1, 1), pictureA.at(10, 16), pictureA.at(16, 16)]).toEqual([
      '#0b7a75',
      '#ffffff',
      '#0b7a75',
    ]);
    const pictureB = decodePng(iconB.body);
    expect([pictureB.at(3, 12), pictureB.at(15, 12), pictureB.at(9, 4)]).toEqual([
      '#ff9416',
      '#111111',
      '#ffffff',
    ]);
    const [icoA, icoB] = await Promise.all([
      get(`${CANONICAL_A}/favicon.ico`),
      get(`${CANONICAL_B}/favicon.ico`),
    ]);
    expect(icoB.status).toBe(200);
    expect(icoB.body.equals(icoA.body)).toBe(false);
  });

  test('describe the tenant in a web manifest whose icons resolve', async () => {
    const answer = await get(`${CANONICAL_A}/manifest.webmanifest`);
    expect(answer.status).toBe(200);
    expect(answer.headers['content-type']).toMatch(/^application\/manifest\+json/);
    const manifest = JSON.parse(answer.body.toString()) as {
      name: string;
      start_url: string;
      icons: { src: string; sizes: string }[];
    };
    expect(manifest.name).toBe('Inquilino de ejemplo A');
    expect(manifest.start_url).toBe('./');
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(['192x192', '512x512']);
    for (const icon of manifest.icons) {
      const url = new URL(icon.src, `${CANONICAL_A}/manifest.webmanifest`).toString();
      const png = await get(url);
      expect(png.status, url).toBe(200);
      const side = Number(icon.sizes.split('x')[0]);
      expect(pngSize(png.body)).toEqual({ width: side, height: side });
    }
  });
});
