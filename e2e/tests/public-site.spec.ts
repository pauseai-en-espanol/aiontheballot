import { messages } from '@aiontheballot/i18n/messages';

import { expectAccessible } from '../axe.js';
import { get } from '../fetch-by-host.js';
import { PLATFORM_HOST, PORTS, PREVIEW_URL, TENANT_URL } from '../servers.js';
import { expect, test } from '../test.js';

const es = messages.es;
/** Tenant ejemplo-a on the preview host, by path (packages/db/seeds/seed.ts: all fictional). */
const SITE = `${PREVIEW_URL}/ejemplo-a`;
const ELECTION = `${SITE}/generales-de-ejemplo`;
const CANONICAL = 'https://ejemplo-a.localhost';

/** Every page of the seeded election, by its path under the tenant's root. */
const ELECTION_PAGES = [
  '/generales-de-ejemplo',
  '/generales-de-ejemplo/metodologia',
  '/generales-de-ejemplo/partidos/partido-ejemplo-a',
  '/generales-de-ejemplo/partidos/partido-ejemplo-b',
  '/generales-de-ejemplo/criterios/criterio-de-ejemplo-1',
  '/generales-de-ejemplo/criterios/criterio-de-ejemplo-2',
  '/generales-de-ejemplo/partidos/partido-ejemplo-a/criterio-de-ejemplo-1',
  '/generales-de-ejemplo/partidos/partido-ejemplo-a/criterio-de-ejemplo-2',
  '/generales-de-ejemplo/partidos/partido-ejemplo-b/criterio-de-ejemplo-1',
  '/generales-de-ejemplo/partidos/partido-ejemplo-b/criterio-de-ejemplo-2',
];

test.describe('the public site, on the preview host (public-site spec)', () => {
  test("leads from the home to the current election's scorecard, never to be indexed", async ({
    page,
  }) => {
    const home = await get(SITE);
    expect(home.status).toBe(307);
    expect(home.headers.location).toBe('/ejemplo-a/generales-de-ejemplo');
    const scorecard = await get(ELECTION);
    expect(scorecard.headers['x-robots-tag']).toBe('noindex, nofollow');
    await page.goto(ELECTION);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
    // Canonical and share addresses are the tenant's own, whatever host serves the page.
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${CANONICAL}/generales-de-ejemplo`,
    );
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  });

  test('shows the scorecard on a desktop: parties down the side, criteria across, every rating in words', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(ELECTION);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Elecciones generales de ejemplo',
    );
    await expect(
      page.getByText('¿Cumple cada partido las demandas de Organización de ejemplo A?'),
    ).toBeVisible();
    const table = page.getByRole('table');
    await expect(table.getByRole('columnheader')).toHaveText([
      es.election.party,
      'Ejemplo 1',
      'Ejemplo 2',
    ]);
    await expect(table.getByRole('rowheader')).toHaveText([/PEA/, /PEB/]);
    // The full name too, for screen readers, which seldom read an abbreviation's title.
    await expect(table.getByRole('link', { name: 'PEA (Partido Ejemplo A)' })).toBeVisible();
    // A's logo beside its name, decorative, served by the site itself and drawn; B has none (PLAN R142).
    const logos = table.getByRole('rowheader').locator('img');
    await expect(logos).toHaveCount(1);
    await expect(logos).toHaveAttribute('alt', '');
    await expect(logos).toHaveAttribute('src', /^\/ejemplo-a\/brand\/[0-9a-f]{64}\.png$/);
    await expect(logos).toHaveJSProperty('naturalWidth', 96);
    // By its Host header: Node doesn't resolve `*.localhost` on every system (fetch-by-host.ts).
    const logo = await get(`${PREVIEW_URL}${await logos.getAttribute('src')}`);
    expect(logo.status).toBe(200);
    expect(logo.headers['content-type']).toBe('image/png');
    // A made-up hash is no logo.
    expect((await get(`${SITE}/brand/${'0'.repeat(64)}.png`)).status).toBe(404);
    // The one published cell, and the pending others: icon, words and colour, never colour alone.
    const cells = table.getByRole('cell');
    await expect(cells).toHaveText([
      es.rating.meets,
      es.cell.pending,
      es.cell.pending,
      es.cell.pending,
    ]);
    await expect(cells.first().locator('svg')).toHaveCount(1);
    await expect(page.locator('[data-invariant="methodology-link"]')).toHaveAttribute(
      'href',
      '/ejemplo-a/generales-de-ejemplo/metodologia',
    );
    await expectAccessible(page);
  });

  test('shows a card per party on a phone, and a card per criterion on request, without scripts', async ({
    newContext,
  }) => {
    const context = await newContext({
      viewport: { width: 390, height: 844 },
      javaScriptEnabled: false,
    });
    const page = await context.newPage();
    await page.goto(ELECTION);
    await expect(page.getByRole('table')).toBeHidden();
    await expect(page.getByRole('heading', { level: 2, name: 'Partido Ejemplo A' })).toBeVisible();
    await page.getByRole('link', { name: es.election.byCriterion }).click();
    await expect(page).toHaveURL(`${ELECTION}?vista=criterios`);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Criterio de ejemplo 1' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: es.election.byCriterion })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await context.close();
  });

  test('passes axe on a phone too', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(ELECTION);
    await expectAccessible(page);
  });

  test("shows a rated cell's summary, quote and source, and its history", async ({ page }) => {
    await page.goto(`${ELECTION}/partidos/partido-ejemplo-a/criterio-de-ejemplo-1`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('PEA · Criterio de ejemplo 1');
    // Quotes and sources in their document's language (WCAG 3.1.2): the seed's is Spanish.
    await expect(page.locator('blockquote')).toHaveAttribute('lang', 'es');
    await expect(
      page.getByText('Resumen inventado: propone una moratoria de ejemplo.'),
    ).toBeVisible();
    await expect(page.locator('blockquote')).toHaveText(
      'propone una moratoria ficticia sobre los sistemas de prueba',
    );
    await expect(page.getByRole('link', { name: 'Programa de ejemplo' })).toHaveAttribute(
      'href',
      'https://example.org/programa-de-ejemplo.pdf',
    );
    await expect(page.getByText(es.cellPage.change.initial, { exact: false })).toBeVisible();
    await expectAccessible(page);
  });

  test('says a pending cell is pending, and that pending is no rating', async ({ page }) => {
    await page.goto(`${ELECTION}/partidos/partido-ejemplo-b/criterio-de-ejemplo-2`);
    await expect(page.getByText(es.cellPage.pendingLead)).toBeVisible();
    await expect(page.locator('blockquote')).toHaveCount(0);
  });

  test('shows the party, the criterion and the methodology pages', async ({ page }) => {
    await page.goto(`${ELECTION}/partidos/partido-ejemplo-a`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Partido Ejemplo A');
    await expect(page.getByRole('heading', { level: 3 })).toHaveText([
      'Criterio de ejemplo 1',
      'Criterio de ejemplo 2',
    ]);
    await page.goto(`${ELECTION}/criterios/criterio-de-ejemplo-1`);
    await expect(page.getByText('Descripción inventada de un criterio de ejemplo.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 3 })).toHaveText([
      'Partido Ejemplo A',
      'Partido Ejemplo B',
    ]);
    await page.goto(`${ELECTION}/metodologia`);
    await expect(page.getByText('Metodología de ejemplo, con demandas inventadas.')).toBeVisible();
    await expect(
      page.getByText('Persona Revisora de Ejemplo, Universidad de Ejemplo'),
    ).toBeVisible();
    await expectAccessible(page);
  });

  test('puts the operator line on every page, and the methodology link on every election page (BRIEF §3), with no CSP violation', async ({
    page,
  }) => {
    // The corrections log and the report form are the election's pages too, though no scorecard: the operator line,
    // and the methodology in the footer, but no legend of their own.
    const paths = [
      '/aviso-legal',
      '/privacidad',
      ...ELECTION_PAGES,
      '/generales-de-ejemplo/correcciones',
      '/generales-de-ejemplo/informar',
    ];
    for (const path of paths) {
      await page.goto(`${SITE}${path}`);
      await expect(page.locator('[data-invariant="operator-line"]'), path).toBeVisible();
      if (ELECTION_PAGES.includes(path) && !path.endsWith('/metodologia')) {
        await expect(page.locator('[data-invariant="methodology-link"]'), path).toHaveCount(1);
      }
    }
  });

  test('keeps a public corrections log, linked from every election page, empty while nothing was corrected', async ({
    page,
  }) => {
    await page.goto(ELECTION);
    await page.getByRole('contentinfo').getByRole('link', { name: es.layout.corrections }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(es.correctionsPage.title);
    // The seeds' cells have their first rating only: no correction yet.
    await expect(page.getByText(es.correctionsPage.empty)).toBeVisible();
    await expectAccessible(page);
  });

  test('answers 404 for an unknown party, criterion or election, and for English words on a Spanish site', async () => {
    for (const path of [
      '/generales-de-ejemplo/partidos/no-existe',
      '/generales-de-ejemplo/criterios/no-existe',
      '/no-existe',
      '/generales-de-ejemplo/parties/partido-ejemplo-a',
      '/generales-de-ejemplo/methodology',
    ]) {
      expect((await get(`${SITE}${path}`)).status, path).toBe(404);
    }
  });
});

test.describe('security headers and search engines (public-site spec §7, §8)', () => {
  test('keep a site out of search engines when a platform admin says so: every response, page and file alike', async ({
    page,
  }) => {
    const platform = `http://${PLATFORM_HOST}:${PORTS.web}`;
    const site = `${platform}/ejemplo-b`;
    expect((await get(site)).headers['x-robots-tag']).toBe('noindex, nofollow');
    // Crawlers may fetch its pages, so they read the noindex; there is no sitemap to send them there.
    expect((await get(`${site}/robots.txt`)).body.toString('utf8')).toBe(
      'User-agent: *\nAllow: /\n',
    );
    expect((await get(`${site}/sitemap.xml`)).status).toBe(404);
    // The platform host's own robots.txt doesn't point crawlers at its sitemap either.
    expect((await get(`${platform}/robots.txt`)).body.toString('utf8')).not.toContain('ejemplo-b');
    await page.goto(site);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
    // Any other site is indexed as before.
    expect((await get(TENANT_URL)).headers['x-robots-tag']).toBeUndefined();
  });

  test('send the CSP and its companions on pages, images and routes alike', async () => {
    for (const path of ['/', '/aviso-legal', '/favicon.ico', '/sitemap.xml']) {
      const { headers } = await get(`${TENANT_URL}${path}`);
      expect(headers['content-security-policy'], path).toContain("frame-ancestors 'none'");
      expect(headers['content-security-policy'], path).toContain("default-src 'self'");
      // Only `pnpm dev` allows eval: never the production build these tests run against.
      expect(headers['content-security-policy'], path).not.toContain("'unsafe-eval'");
      expect(headers['x-content-type-options'], path).toBe('nosniff');
      expect(headers['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
      expect(headers['strict-transport-security'], path).toBe('max-age=31536000');
    }
  });

  test("resize no image: Next's image optimizer is off, so share images are drawn only at their own paths", async () => {
    // A share image's path through `/_next/image`, as a site's host and the preview host name it. With the optimizer
    // on, Next answers in its own words (`"url" parameter is …`, no content type) after fetching the path inside the
    // server; off, it is any unknown path: the not-found page, with the security headers (PLAN R163).
    for (const [base, path] of [
      [TENANT_URL, '/generales-de-ejemplo/og/overview/1200x630.png'],
      [PREVIEW_URL, '/ejemplo-a/generales-de-ejemplo/og/overview/1200x630.png'],
    ] as const) {
      const { status, headers, body } = await get(
        `${base}/_next/image?url=${encodeURIComponent(path)}&w=640&q=75`,
      );
      expect(status, base).toBe(404);
      expect(body.toString('utf8'), base).not.toContain('"url" parameter');
      expect(headers['content-type'], base).toMatch(/^text\/html/u);
      expect(headers['content-security-policy'], base).toContain("frame-ancestors 'none'");
    }
  });

  test('list only what a coming-soon site serves, and every election page once it shows them', async () => {
    const text = async (url: string) => (await get(url)).body.toString('utf8');
    const comingSoon = await text(`${TENANT_URL}/sitemap.xml`);
    expect(comingSoon).toContain(`<loc>${CANONICAL}</loc>`);
    expect(comingSoon).toContain(`<loc>${CANONICAL}/aviso-legal</loc>`);
    expect(comingSoon).toContain(`<loc>${CANONICAL}/privacidad</loc>`);
    expect(comingSoon).not.toContain('generales-de-ejemplo');
    const preview = await text(`${SITE}/sitemap.xml`);
    for (const path of ELECTION_PAGES) {
      expect(preview).toContain(`<loc>${CANONICAL}${path}</loc>`);
    }
    // There, the home is a redirect to the election: no page of its own.
    expect(preview).not.toContain(`<loc>${CANONICAL}</loc>`);
    expect(await text(`${TENANT_URL}/robots.txt`)).toBe(
      `User-agent: *\nAllow: /\nSitemap: ${CANONICAL}/sitemap.xml\n`,
    );
    // Crawlers read the preview host's at its root.
    expect(await text(`${PREVIEW_URL}/robots.txt`)).toBe('User-agent: *\nDisallow: /\n');
    expect(await text(`${SITE}/robots.txt`)).toBe('User-agent: *\nDisallow: /\n');
  });
});
