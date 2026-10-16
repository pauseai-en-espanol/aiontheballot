import { messages } from '@aiontheballot/i18n/messages';

import { addMembership, deleteAccounts } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { get } from '../fetch-by-host.js';
import { ADMIN_URL, PREVIEW_TOKEN_HEADER, PREVIEW_URL } from '../servers.js';
import { expect, test } from '../test.js';

const en = messages.en;

const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

const ROOT = `${ADMIN_URL}/t/ejemplo-a/preview`;

test.describe("a site's preview through the admin (ADR-0005, PLAN R174)", () => {
  test('shows a member every page of their site, sandboxed, script-free and kept in the admin', async ({
    page,
  }) => {
    const { id } = await signedInAccount(page, created, 'Persona de vista previa');
    await addMembership(id, 'ejemplo-a', 'reviewer');
    await page.goto(`${ADMIN_URL}/t/ejemplo-a`);
    const assets: string[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/preview-static/')) {
        assets.push(`${response.status()} ${response.url()}`);
      }
    });
    // The site's home goes to its live election, as on the public site, within the preview.
    const [election] = await Promise.all([
      page.waitForResponse((response) => response.url() === `${ROOT}/generales-de-ejemplo`),
      page.getByRole('link', { name: en.admin.dashboard.preview }).click(),
    ]);
    expect(election.status()).toBe(200);
    await expect(page).toHaveURL(`${ROOT}/generales-de-ejemplo`);
    const headers = election.headers();
    expect(headers['content-security-policy']).toMatch(
      /^sandbox allow-same-origin; default-src 'none'/u,
    );
    expect(headers).toMatchObject({
      'cache-control': 'private, no-store',
      // The admin's own: no other site learns a preview's address.
      'referrer-policy': 'same-origin',
      'x-robots-tag': 'noindex, nofollow',
    });
    expect(headers['set-cookie']).toBeUndefined();
    // The site's own styles and fonts, from the admin's copy of the web app's assets.
    await expect.poll(() => assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      expect(asset).toMatch(/^200 /u);
    }
    // No script reaches the page, and every link to the site stays in its preview. (The page runs none, so the
    // browser's own scripts can't read it either: what it was sent is read instead.)
    const html = await election.text();
    expect(html).not.toMatch(/<script/iu);
    const links = [...html.matchAll(/<a\s(?:[^>]*\s)?href="(\/[^"]*)"/giu)].map(([, href]) => href);
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) {
      expect(href).toMatch(/^\/t\/ejemplo-a\/preview(?:\/|$)/u);
    }
    // The election's parties, as the public will see them once the site is open, and a party's own page.
    expect(html).toContain('PEA');
    const party = await page.goto(`${ROOT}/generales-de-ejemplo/partidos/partido-ejemplo-a`);
    expect(party?.status()).toBe(200);
    expect(await party?.text()).toContain('Partido Ejemplo A');
  });

  test('is a 404 for anyone outside the site, and asks someone signed out to sign in', async ({
    page,
    newContext,
  }) => {
    await signedInAccount(page, created, 'Persona sin sitio');
    expect((await page.goto(`${ROOT}/`))?.status()).toBe(404);
    expect((await page.goto(`${ADMIN_URL}/t/no-existe/preview/`))?.status()).toBe(404);
    const theirs = await newContext();
    const signedOut = await theirs.newPage();
    await signedOut.goto(`${ROOT}/generales-de-ejemplo`);
    await expect(signedOut).toHaveURL(`${ADMIN_URL}/sign-in`);
  });

  test('is served by the web app only with the shared secret', async () => {
    for (const token of ['', 'otro-secreto-de-vista-previa-de-prueba']) {
      const answer = await get(`${PREVIEW_URL}/ejemplo-a`, { [PREVIEW_TOKEN_HEADER]: token });
      expect(answer.status, token).toBe(404);
      expect(answer.headers['set-cookie']).toBeUndefined();
    }
    expect((await get(`${PREVIEW_URL}/ejemplo-a/generales-de-ejemplo`)).status).toBe(200);
  });
});
