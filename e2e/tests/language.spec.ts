import { messages } from '@aiontheballot/i18n/messages';
import { type Page } from '@playwright/test';

import { addMembership, deleteAccounts } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { ADMIN_URL, PLATFORM_NAME } from '../servers.js';
import { expect, test } from '../test.js';

const en = messages.en;
const es = messages.es;

const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

const switchIn = (page: Page, language: typeof en) =>
  page.getByRole('form', { name: language.admin.language });

const localeCookie = async (page: Page) =>
  (await page.context().cookies()).find(({ name }) => name === '__Host-locale');

test.describe("the admin's language (editorial workflow §2.7)", () => {
  test("follows the browser's, until someone chooses another with the switch, on every page", async ({
    page,
  }) => {
    await page.goto(`${ADMIN_URL}/sign-in`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    // The language in use is said in words, in the page's language, as well as shown in bold.
    await expect(switchIn(page, en).locator('[aria-current="true"]')).toHaveText(
      `English (${en.admin.shell.current})`,
    );
    await expectAccessible(page);

    await switchIn(page, en).getByRole('button', { name: 'Español' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(es.auth.signIn.title);
    await expect(page).toHaveTitle(`${es.auth.signIn.title} · ${PLATFORM_NAME}`);
    await expect(page).toHaveURL(`${ADMIN_URL}/sign-in`);
    // Focus goes where the button pressed was: to the language now in use.
    await expect(switchIn(page, es).locator('[aria-current="true"]')).toBeFocused();
    // A preference on the admin host only, out of scripts' reach.
    expect(await localeCookie(page)).toMatchObject({
      value: 'es',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    });

    // Signed in, it holds on the site's pages, and switching keeps the page.
    const { id } = await signedInAccount(page, created);
    await addMembership(id, 'ejemplo-a');
    await page.goto(`${ADMIN_URL}/t/ejemplo-a/members`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(es.admin.members.title);
    await switchIn(page, es).getByRole('button', { name: 'English' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.admin.members.title);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveURL(`${ADMIN_URL}/t/ejemplo-a/members`);
    await expectAccessible(page);
  });

  test('posts the plain form after all when the background post fails', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/sign-in`);
    let failed = false;
    await page.route(`${ADMIN_URL}/locale`, async (route) => {
      if (failed) {
        await route.continue();
      } else {
        failed = true;
        await route.abort('failed');
      }
    });
    await switchIn(page, en).getByRole('button', { name: 'Español' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(es.auth.signIn.title);
    expect(failed).toBe(true);
    expect(await localeCookie(page)).toMatchObject({ value: 'es' });
  });

  test.describe('without scripts', () => {
    test.use({ javaScriptEnabled: false });

    test('the switch is a plain form, which comes back to the page in the language chosen', async ({
      page,
    }) => {
      await page.goto(`${ADMIN_URL}/sign-in`);
      const answer = page.waitForResponse(
        (response) => response.url() === `${ADMIN_URL}/locale` && response.status() === 303,
      );
      await switchIn(page, en).getByRole('button', { name: 'Español' }).click();
      expect((await answer).headers().location).toBe('/sign-in');
      await expect(page).toHaveURL(`${ADMIN_URL}/sign-in`);
      await expect(page.locator('html')).toHaveAttribute('lang', 'es');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(es.auth.signIn.title);
      expect(await localeCookie(page)).toMatchObject({ value: 'es' });
    });
  });

  test("takes only the admin's own pages' posts, refuses a language it lacks, and goes back to this host only", async ({
    request,
  }) => {
    const ours = { origin: ADMIN_URL };
    const unknown = await request.post(`${ADMIN_URL}/locale`, {
      form: { locale: 'fr', back: '/' },
      headers: ours,
    });
    expect(unknown.status()).toBe(400);
    const elsewhere = await request.post(`${ADMIN_URL}/locale`, {
      form: { locale: 'es', back: '//otro.example/' },
      headers: ours,
      maxRedirects: 0,
    });
    expect(elsewhere.status()).toBe(303);
    expect(elsewhere.headers().location).toBe('/');
    expect(elsewhere.headers()['set-cookie']).toBe(
      '__Host-locale=es; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax',
    );
    const strangers: Record<string, string>[] = [
      { 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'same-site' },
      { origin: 'https://otro.example' },
      {},
    ];
    for (const headers of strangers) {
      const refused = await request.post(`${ADMIN_URL}/locale`, {
        form: { locale: 'es', back: '/' },
        headers,
        maxRedirects: 0,
      });
      expect(refused.status()).toBe(403);
    }
    expect((await request.get(`${ADMIN_URL}/locale`, { maxRedirects: 0 })).status()).toBe(405);
  });
});
