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
  '/generales-de-ejemplo/tabla',
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

  test("opens on the election's summary: every rating as an icon, its words for screen readers and in the legend below (PLAN R218)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(ELECTION);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Elecciones generales de ejemplo',
    );
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: '¿Cumple cada partido las demandas de Organización de ejemplo A?',
      }),
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
    // The one published cell, and the pending others: each an icon, its words its link's name and its tooltip, and
    // the legend right under the table giving every icon's words (BRIEF §6).
    const cells = table.getByRole('cell').getByRole('link');
    await expect(cells).toHaveCount(4);
    for (const [index, name] of [
      es.rating.meets,
      es.cell.pending,
      es.cell.pending,
      es.cell.pending,
    ].entries()) {
      await expect(cells.nth(index)).toHaveAccessibleName(name);
    }
    await expect(cells.first()).toHaveAttribute('title', `PEA · Ejemplo 1: ${es.rating.meets}`);
    await expect(cells.first().locator('svg')).toHaveCount(1);
    const legend = page.getByRole('region', { name: es.election.legend });
    await expect(legend.getByRole('listitem')).toContainText([es.rating.meets, es.cell.pending]);
    await expect(page.locator('[data-invariant="methodology-link"]')).toHaveAttribute(
      'href',
      '/ejemplo-a/generales-de-ejemplo/metodologia',
    );
    await expectAccessible(page);
    // On to the detailed table.
    await page.getByRole('link', { name: es.election.summary.tableLink }).click();
    await expect(page).toHaveURL(`${ELECTION}/tabla`);
  });

  test('shows the detailed table on a desktop: a section per criterion, every rating in words with why, under an index (PLAN R225)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${ELECTION}/tabla`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(es.election.table.title);
    await expect(
      page.getByText('¿Cumple cada partido las demandas de Organización de ejemplo A?'),
    ).toBeVisible();
    // Back to the election's summary.
    await expect(
      page.getByRole('navigation', { name: es.election.breadcrumb }).getByRole('link'),
    ).toHaveText(['Elecciones generales de ejemplo']);
    // The index, in the criteria's order, straight to each one's section.
    const index = page.getByRole('navigation', { name: es.election.table.index });
    await expect(index.getByRole('link')).toHaveText(['Ejemplo 1', 'Ejemplo 2']);
    await index.getByRole('link', { name: 'Ejemplo 2' }).click();
    await expect(page).toHaveURL(`${ELECTION}/tabla#criterio-criterio-de-ejemplo-2`);
    // A section per criterion, its short title linking to its page, its full title under it, and a small table.
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      es.election.table.index,
      'Ejemplo 1',
      'Ejemplo 2',
    ]);
    const first = page.getByRole('region', { name: 'Ejemplo 1' });
    await expect(first.getByRole('heading', { level: 2 }).getByRole('link')).toHaveAttribute(
      'href',
      '/ejemplo-a/generales-de-ejemplo/criterios/criterio-de-ejemplo-1',
    );
    await expect(first.getByText('Criterio de ejemplo 1', { exact: true })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(2);
    const table = first.getByRole('table', { name: 'Ejemplo 1: la valoración de cada partido' });
    await expect(table.getByRole('columnheader')).toHaveText([
      es.election.party,
      es.election.table.rating,
      es.election.table.why,
    ]);
    await expect(table.getByRole('rowheader')).toHaveText([/PEA/, /PEB/]);
    // Icon, words and colour, never colour alone; then why, where there is one.
    await expect(table.getByRole('cell')).toHaveText([
      es.rating.meets,
      'Resumen inventado: propone una moratoria de ejemplo.',
      es.cell.pending,
      '',
    ]);
    await expect(table.getByRole('cell').first().locator('svg')).toHaveCount(1);
    await expect(table.getByRole('link', { name: es.rating.meets })).toHaveAttribute(
      'href',
      '/ejemplo-a/generales-de-ejemplo/partidos/partido-ejemplo-a/criterio-de-ejemplo-1',
    );
    // Each section a way back to the index.
    await expect(page.getByRole('link', { name: es.election.table.backToIndex })).toHaveCount(2);
    await expect(first.getByRole('link', { name: es.election.table.backToIndex })).toHaveAttribute(
      'href',
      '#indice',
    );
    await expect(page.getByRole('region', { name: es.election.legend })).toHaveCount(0);
    await expect(page.locator('[data-invariant="methodology-link"]')).toHaveAttribute(
      'href',
      '/ejemplo-a/generales-de-ejemplo/metodologia',
    );
    await expectAccessible(page);
  });

  test('shows the same sections on a phone, a party a row in place of each table, without scripts', async ({
    newContext,
  }) => {
    const context = await newContext({
      viewport: { width: 390, height: 844 },
      javaScriptEnabled: false,
    });
    const page = await context.newPage();
    await page.goto(`${ELECTION}/tabla`);
    await expect(page.getByRole('table')).toHaveCount(0);
    const first = page.getByRole('region', { name: 'Ejemplo 1' });
    await expect(first.getByRole('heading', { level: 2 })).toBeVisible();
    const rows = first.getByRole('listitem');
    await expect(rows).toHaveCount(2);
    // The party and its rating in words, one link to the cell, and why under them.
    const cell = rows.first().getByRole('link');
    await expect(cell).toHaveAccessibleName(new RegExp(`PEA.*${es.rating.meets}`));
    await expect(cell).toHaveAttribute(
      'href',
      '/ejemplo-a/generales-de-ejemplo/partidos/partido-ejemplo-a/criterio-de-ejemplo-1',
    );
    await expect(rows.first()).toContainText(
      'Resumen inventado: propone una moratoria de ejemplo.',
    );
    await expect(rows.nth(1).getByRole('link')).toHaveAccessibleName(
      new RegExp(`PEB.*${es.cell.pending}`),
    );
    // No axe here: it runs as a script, and this page has none (the next test checks it on a phone).
    // The summary, on a phone too: its table scrolls inside its own region.
    await page.goto(ELECTION);
    await expect(page.getByRole('region', { name: es.election.summary.region })).toBeVisible();
    await context.close();
  });

  test('passes axe on a phone too', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(ELECTION);
    await expectAccessible(page);
    await page.goto(`${ELECTION}/tabla`);
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
    // and the methodology in the footer, but no link of their own beside their content.
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
