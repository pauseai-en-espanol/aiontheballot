import { messages } from '@aiontheballot/i18n/messages';
import { expect, type Response, test } from '@playwright/test';

import { ADMIN_URL, API_URL, PLATFORM_NAME, TENANT_URL, WEB_URL } from '../servers.js';

const comingSoon = messages.es.home.comingSoon;

test.describe('public site', () => {
  test("renders a tenant's home page and sets no cookies", async ({ page }) => {
    const responses: Response[] = [];
    page.on('response', (response) => responses.push(response));

    const response = await page.goto(TENANT_URL);

    expect(response?.status()).toBe(200);
    // Named from the tenant's data (packages/db/seeds/seed.ts), not the platform's configuration.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inquilino de ejemplo A');
    await expect(page).toHaveTitle(`Inquilino de ejemplo A · ${comingSoon}`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');

    // ADR-0002 T8: the public app has no session code, so no response the page loads may set a cookie.
    expect(responses.length).toBeGreaterThan(1);
    for (const loaded of responses) {
      expect(await loaded.headerValue('set-cookie'), loaded.url()).toBeNull();
      expect(await loaded.headerValue('x-powered-by'), loaded.url()).toBeNull();
    }
    expect(await page.context().cookies()).toEqual([]);

    // WCAG 2.2 AA: text must stay resizable, so the viewport never disables zoom.
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).not.toMatch(/user-scalable|maximum-scale/);
  });

  test('answers the health probe', async ({ request }) => {
    const response = await request.get(`${WEB_URL}/healthz`);

    expect(response.ok()).toBe(true);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(response.headers()['set-cookie']).toBeUndefined();
  });
});

test.describe('admin', () => {
  test('renders the home page with the configured name', async ({ page }) => {
    const response = await page.goto(ADMIN_URL);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(comingSoon);
    await expect(page).toHaveTitle(PLATFORM_NAME);
  });

  test('answers the health probe', async ({ request }) => {
    const response = await request.get(`${ADMIN_URL}/healthz`);

    expect(response.ok()).toBe(true);
  });
});

test.describe('api', () => {
  test('answers the health probe', async ({ request }) => {
    const response = await request.get(`${API_URL}/healthz`);

    expect(response.ok()).toBe(true);
  });
});
