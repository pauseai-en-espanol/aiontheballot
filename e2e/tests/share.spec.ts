import { messages } from '@aiontheballot/i18n/messages';
import { type Page } from '@playwright/test';

import { get, pngSize } from '../fetch-by-host.js';
import { PLATFORM_HOST, PORTS, PREVIEW_URL, SEED_HOSTS, TENANT_URL } from '../servers.js';
import { expect, test } from '../test.js';

/** The seeds' canonical bases: https, as every share URL is built from the routing table, never the request. */
const CANONICAL_A = `https://${SEED_HOSTS.canonical}`;
const CANONICAL_B = `https://${PLATFORM_HOST}/ejemplo-b`;

const meta = (page: Page, key: string) =>
  page.locator(`meta[property="${key}"], meta[name="${key}"]`).getAttribute('content');

test.describe('link previews (fictional seeds)', () => {
  test('give crawlers the canonical address, the texts and a share image', async ({ page }) => {
    await page.goto(TENANT_URL);

    const title = `Inquilino de ejemplo A · ${messages.es.home.comingSoon}`;
    expect(await meta(page, 'og:type')).toBe('website');
    // og:url is the shared address: the canonical one with the preview's content hash, checked below (R215).
    const shared = await meta(page, 'og:url');
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
    const hash = /\.([0-9a-f]{12})\.png$/.exec(image ?? '')?.[1];
    expect(shared).toBe(`${CANONICAL_A}?v=${hash}`);
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

    expect(await meta(page, 'og:url')).toMatch(
      new RegExp(`^${CANONICAL_B.replaceAll('.', '\\.')}/en\\?v=[0-9a-f]{12}$`),
    );
    expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toBe(
      `${CANONICAL_B}/en`,
    );
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
  test("show in the footer, served once from the tenant's address and cached as immutable", async ({
    page,
  }) => {
    await page.goto(TENANT_URL);

    // The operator line is the footer's alone (PLAN R82); the logo for the orange shows on the share cards.
    await expect(page.locator('header img')).toHaveCount(0);
    const footer = page.locator('footer img');
    await expect(footer).toHaveAttribute('alt', 'Organización de ejemplo A');
    const src = (await footer.getAttribute('src')) ?? '';
    expect(src).toMatch(/^\/brand\/[0-9a-f]{64}\.png$/);
    // The seeds' fictional logo is 240×64.
    await expect(footer).toHaveJSProperty('naturalWidth', 240);

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

/** Tenant ejemplo-a's election on the preview host, by path: its canonical host is still coming soon in the seeds. */
const PREVIEW_SITE = `${PREVIEW_URL}/ejemplo-a`;
const ELECTION = '/generales-de-ejemplo';

/** Opens the page's share dialog with its one button, as a person does, and returns it. */
const openSharing = async (page: Page) => {
  await page.getByRole('button', { name: messages.es.share.panel.button }).click();
  const dialog = page.getByRole('dialog', { name: messages.es.share.panel.button });
  await expect(dialog).toBeVisible();
  return dialog;
};

/** Each election page with a card of its own, and the image path its card lives at (R148). */
const VIEWS = [
  { page: '', image: 'overview' },
  // The detailed table shares the summary's image (PLAN R218).
  { page: '/tabla', image: 'overview' },
  { page: '/metodologia', image: 'methodology' },
  { page: '/correcciones', image: 'corrections' },
  { page: '/partidos/partido-ejemplo-a', image: 'party/partido-ejemplo-a' },
  { page: '/criterios/criterio-de-ejemplo-1', image: 'criterion/criterio-de-ejemplo-1' },
  {
    page: '/partidos/partido-ejemplo-a/criterio-de-ejemplo-1',
    image: 'cell/partido-ejemplo-a/criterio-de-ejemplo-1',
  },
];

test.describe("election pages' own share images (R148)", () => {
  test('each page names its own card, described in words, and offers its data image in three shapes (R185)', async ({
    page,
  }) => {
    for (const view of VIEWS) {
      await page.goto(`${PREVIEW_SITE}${ELECTION}${view.page}`);
      const image = (await meta(page, 'og:image')) ?? '';
      const path = new RegExp(
        `^${CANONICAL_A}${ELECTION}/og/${view.image}/1200x630\\.([0-9a-f]{12})\\.png$`,
      );
      expect(image, view.page).toMatch(path);
      expect(await meta(page, 'twitter:image'), view.page).toBe(image);
      expect(await meta(page, 'og:image:alt'), view.page).not.toBe('');
      // The canonical host is coming soon: it serves no election image yet. The preview host does.
      expect((await get(image)).status, view.page).toBe(404);
      const preview = await get(`${PREVIEW_SITE}${image.slice(CANONICAL_A.length)}`);
      expect(preview.status, view.page).toBe(200);
      expect(preview.headers['content-type']).toBe('image/png');
      expect(preview.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(pngSize(preview.body)).toEqual({ width: 1200, height: 630 });
      expect(preview.body.byteLength).toBeLessThan(300 * 1024);

      // The share panel (PLAN R185, R218): one button, opening a dialog that needs no script; its data image in the
      // three shapes people post, each a PNG of its size on this host; on the scorecard, the whole table.
      await expect(page.locator('[data-share-panel]')).toHaveCount(1);
      const panel = await openSharing(page);
      const posted = panel.getByRole('group', { name: messages.es.share.panel.image });
      const downloads = posted.getByRole('link');
      await expect(downloads).toHaveCount(3);
      const kind = view.image === 'overview' ? 'table' : view.image;
      for (const [index, [width, height]] of [
        [1080, 1080],
        [1080, 1350],
        [1080, 1920],
      ].entries()) {
        const link = downloads.nth(index);
        const href = (await link.getAttribute('href')) ?? '';
        expect(href).toMatch(
          new RegExp(`^/ejemplo-a${ELECTION}/og/${kind}/${width}x${height}\\.[0-9a-f]{12}\\.png$`),
        );
        expect(await link.getAttribute('download')).toMatch(
          new RegExp(`^ejemplo-a-generales-de-ejemplo.*-${width}x${height}\\.png$`),
        );
        const file = await get(`${PREVIEW_URL}${href}`);
        expect(file.status, href).toBe(200);
        expect(file.headers['content-type']).toBe('image/png');
        expect(pngSize(file.body)).toEqual({ width, height });
      }
      // Its link too, first (PLAN R218): what most people send.
      const groups = panel.getByRole('group');
      await expect(groups.first()).toHaveAccessibleName(messages.es.share.panel.link);
      await expect(groups.nth(1)).toHaveAccessibleName(messages.es.share.panel.image);
      if (view.image === 'overview') {
        // The whole table is never a link preview: too low for it.
        const low = await get(`${PREVIEW_SITE}${ELECTION}/og/table/1200x630.000000000000.png`);
        expect(low.status).toBe(404);
      }
    }
  });

  test("offer share links under each page's title: its canonical address and title, nothing loaded until followed (R177)", async ({
    page,
  }) => {
    const requested: string[] = [];
    page.on('request', (request) => requested.push(new URL(request.url()).host));
    for (const view of VIEWS) {
      await page.goto(`${PREVIEW_SITE}${ELECTION}${view.page}`);
      const url = (await meta(page, 'og:url')) ?? '';
      // The shared address: the canonical one, with its preview's content hash (R215).
      expect(url, view.page).toMatch(
        new RegExp(
          `^${`${CANONICAL_A}${ELECTION}${view.page}`.replaceAll('.', '\\.')}\\?v=[0-9a-f]{12}$`,
        ),
      );
      const title = await page.title();
      const text = encodeURIComponent(title);
      const address = encodeURIComponent(url);

      // In the one share dialog beside the title, before the page's content (PLAN R185, R218).
      const panel = await openSharing(page);
      const bar = panel.getByRole('group', { name: messages.es.share.panel.link });
      await expect(bar).toBeVisible();
      const href = async (network: string) =>
        (await bar.locator(`a[data-share="${network}"]`).getAttribute('href')) ?? '';
      expect(await href('whatsapp')).toBe(`https://wa.me/?text=${text}%20${address}`);
      expect(await href('telegram')).toBe(`https://t.me/share/url?url=${address}&text=${text}`);
      expect(await href('x')).toBe(`https://x.com/intent/post?text=${text}&url=${address}`);
      expect(await href('facebook')).toBe(
        `https://www.facebook.com/sharer/sharer.php?u=${address}`,
      );
      expect(await href('bluesky')).toBe(
        `https://bsky.app/intent/compose?text=${text}%20${address}`,
      );
      expect(await href('linkedin')).toBe(
        `https://www.linkedin.com/sharing/share-offsite/?url=${address}`,
      );
      expect(await href('email')).toBe(`mailto:?subject=${text}&body=${address}`);
      // Each named in words beside its icon; the networks' open in a new tab, which screen readers are told.
      for (const name of ['WhatsApp', 'Telegram', 'X', 'Facebook', 'Bluesky', 'LinkedIn']) {
        const link = bar.getByRole('link', { name: `${name} ${messages.es.share.links.newTab}` });
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      }
      await expect(bar.getByRole('link', { name: messages.es.share.links.email })).toBeVisible();
      // The device's share sheet and "copy the link" only where the browser has them.
      const can = (await page.evaluate(
        `({ share: typeof navigator.share === 'function', copy: typeof navigator.clipboard?.writeText === 'function' })`,
      )) as { share: boolean; copy: boolean };
      await expect(bar.getByRole('button', { name: messages.es.share.links.native })).toHaveCount(
        can.share ? 1 : 0,
      );
      await expect(bar.getByRole('button', { name: messages.es.share.links.copy })).toHaveCount(
        can.copy ? 1 : 0,
      );
    }
    // No widget, script, image or font from any network: every request went to the site's own host.
    expect([...new Set(requested)]).toEqual([new URL(PREVIEW_URL).host]);
  });

  test("copy the page's shared address, and say so (R215)", async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(`${PREVIEW_SITE}${ELECTION}/partidos/partido-ejemplo-a`);
    const panel = await openSharing(page);
    await panel.getByRole('button', { name: messages.es.share.links.copy }).click();
    await expect(panel.getByRole('status')).toHaveText(messages.es.share.links.copied);
    // The canonical address with its preview's hash: the same address its link preview names (og:url).
    const copied = await page.evaluate('navigator.clipboard.readText()');
    expect(copied).toMatch(
      new RegExp(
        `^${`${CANONICAL_A}${ELECTION}/partidos/partido-ejemplo-a`.replaceAll('.', '\\.')}\\?v=[0-9a-f]{12}$`,
      ),
    );
    expect(copied).toBe(await meta(page, 'og:url'));
  });

  test('need no script: the links are in the page as served', async () => {
    const html = (await get(`${PREVIEW_SITE}${ELECTION}`)).body.toString();
    expect(html).toContain('data-share-panel');
    expect(html).toContain(`href="https://wa.me/?text=`);
  });

  test('open and close as a dialog without scripts: its button, Escape or its own close button (PLAN R218)', async ({
    newContext,
  }) => {
    const context = await newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`${PREVIEW_SITE}${ELECTION}`);
    const dialog = await openSharing(page);
    await expect(dialog.getByRole('link', { name: /^WhatsApp/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await openSharing(page);
    await dialog.getByRole('button', { name: messages.es.share.panel.close }).click();
    await expect(dialog).toBeHidden();
    await context.close();
  });

  test("a cell's card says its rating in words for those who can't see it", async ({ page }) => {
    await page.goto(`${PREVIEW_SITE}${ELECTION}/partidos/partido-ejemplo-a/criterio-de-ejemplo-1`);
    const alt = (await meta(page, 'og:image:alt')) ?? '';
    expect(alt).toMatch(/^Partido Ejemplo A, .+: .+\.$/);
    const rating = Object.values(messages.es.rating).find((words) => alt.endsWith(`: ${words}.`));
    expect(rating, alt).toBeDefined();
  });

  test('redirect an outdated or made-up hash to the current image, and refuse what names no view', async () => {
    const stale = await get(
      `${PREVIEW_SITE}${ELECTION}/og/party/partido-ejemplo-a/1080x1080.000000000000.png`,
    );
    expect(stale.status).toBe(307);
    expect(stale.headers.location).toMatch(
      new RegExp(
        `^${CANONICAL_A}${ELECTION}/og/party/partido-ejemplo-a/1080x1080\\.[0-9a-f]{12}\\.png$`,
      ),
    );
    expect(stale.headers['cache-control']).toBe('public, max-age=60');
    for (const path of [
      '/og/party/partido-inventado/1200x630.000000000000.png',
      '/og/cell/partido-ejemplo-a/1200x630.000000000000.png',
      '/og/home/1200x630.000000000000.png',
      '/og/overview/1200x631.000000000000.png',
    ]) {
      expect((await get(`${PREVIEW_SITE}${ELECTION}${path}`)).status, path).toBe(404);
    }
    // An election the site doesn't list never reaches the API.
    expect(
      (await get(`${PREVIEW_SITE}/eleccion-inventada/og/overview/1200x630.000000000000.png`))
        .status,
    ).toBe(404);
  });
});
