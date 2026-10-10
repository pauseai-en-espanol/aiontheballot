import { messages } from '@aiontheballot/i18n/messages';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

import { PLATFORM_HOST, PORTS, TENANT_URL } from '../servers.js';

const es = messages.es.home;
const en = messages.en.home;

/** Tenant ejemplo-b has no hostname of its own: it is served by path on the platform host, in Spanish and English. */
const TENANT_B_EN = `http://${PLATFORM_HOST}:${PORTS.web}/ejemplo-b/en`;

/** WCAG 2.2 AA, as axe checks it (PLAN M3: zero violations). */
const violations = async (page: Page) =>
  (
    await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
  ).violations.map((v) => `${v.id}: ${v.nodes.map((n) => String(n.target)).join(', ')}`);

// Expressions, not functions: this package's types have no DOM.
const scrollsSideways = async (page: Page) =>
  (await page.evaluate(
    'document.documentElement.scrollWidth > document.documentElement.clientWidth',
  )) as boolean;

test.describe('the coming-soon home (fictional seeds)', () => {
  test("shows the tenant, its operator and its next election, all from the tenant's data", async ({
    page,
  }) => {
    await page.goto(TENANT_URL);

    await expect(page.getByText(messages.es.home.comingSoon, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inquilino de ejemplo A');
    await expect(page.getByText(es.question)).toBeVisible();
    await expect(
      page.getByText('con las demandas de Organización de ejemplo A', { exact: false }),
    ).toBeVisible();
    // The seed's live election has no date yet: its name alone.
    await expect(page.getByText('Elecciones generales de ejemplo', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Conoce Organización de ejemplo A' }),
    ).toHaveAttribute('href', 'https://organizacion-ejemplo-a.example/');
    await expect(
      page.getByRole('link', { name: 'contacto@organizacion-ejemplo-a.example' }),
    ).toHaveAttribute('href', 'mailto:contacto@organizacion-ejemplo-a.example');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(es.how.title);
    await expect(page.getByRole('heading', { level: 3 })).toHaveText([
      es.how.quotes.title,
      es.how.history.title,
      es.how.corrections.title,
    ]);
  });

  test('leaves out what the operator has not given: no website link, no contact, no election', async ({
    page,
  }) => {
    await page.goto(TENANT_B_EN);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Example tenant B');
    await expect(page.locator('[lang="en"]').first()).toBeVisible();
    await expect(page.getByText(en.question)).toBeVisible();
    await expect(
      page.getByText("Example organisation B's demands", { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole('link')).toHaveCount(0);
  });

  test('has no WCAG 2.2 AA violations that axe can find, on a desktop and on a phone', async ({
    page,
  }) => {
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      for (const url of [TENANT_URL, TENANT_B_EN]) {
        await page.goto(url);
        expect(await violations(page), `${url} at ${viewport.width}px`).toEqual([]);
        expect(await scrollsSideways(page), `${url} at ${viewport.width}px`).toBe(false);
      }
    }
  });

  test('serves its fonts itself, with no request leaving the site', async ({ page }) => {
    const hosts = new Set<string>();
    page.on('request', (request) => hosts.add(new URL(request.url()).host));

    await page.goto(TENANT_URL);
    await page.evaluate('document.fonts.ready.then(() => undefined)');

    expect([...hosts]).toEqual([new URL(TENANT_URL).host]);
    // The display face (700), the body face (400) and the numerals' face (900) are in use, rather than next/font's
    // metric-matched fallbacks.
    const weights = (await page.evaluate(
      "[...document.fonts].filter((f) => f.status === 'loaded' && !f.family.endsWith('Fallback')).map((f) => f.weight)",
    )) as string[];
    expect([...weights].sort((a, b) => a.localeCompare(b))).toEqual(['400', '700', '900']);
  });
});
