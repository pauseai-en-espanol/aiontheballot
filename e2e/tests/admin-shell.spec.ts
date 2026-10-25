import { messages } from '@aiontheballot/i18n/messages';

import { addMembership, asOwner, createTenant, deleteAccounts, purgeTenant } from '../accounts.js';
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

test.describe('choosing a site (editorial workflow A6)', () => {
  test('takes a member of one site straight to its dashboard, inside its shell', async ({
    page,
  }) => {
    const { id } = await signedInAccount(page, created, 'Persona de un sitio');
    await addMembership(id, 'ejemplo-a', 'reviewer');
    await page.goto(ADMIN_URL);
    await expect(page).toHaveURL(`${ADMIN_URL}/t/ejemplo-a`);
    await expect(page).toHaveTitle(
      `${en.admin.shell.dashboard} · Example tenant A · ${PLATFORM_NAME}`,
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Example tenant A');
    await expect(page.getByText('Your roles here: reviewer.')).toBeVisible();
    const nav = page.getByRole('navigation', { name: en.admin.shell.nav });
    await expect(nav.getByRole('link', { name: en.admin.shell.dashboard })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // What waits for them (C1.2): the queues a reviewer acts on, and the site's new reports, which members triage.
    const queues = page.getByRole('region', { name: en.admin.dashboard.queues.title });
    await expect(queues).toBeVisible();
    await expect(queues.getByRole('link', { name: /new report/ })).toHaveAttribute(
      'href',
      '/t/ejemplo-a/reports?status=new',
    );
    // One site and no platform role: nowhere to switch to.
    await expect(page.getByRole('button', { name: en.admin.shell.switchSite })).toHaveCount(0);
    // The signup list's counts are for country admins and platform admins only (PLAN R119).
    await expect(page.getByRole('heading', { name: en.admin.dashboard.signups.title })).toHaveCount(
      0,
    );
    await expectAccessible(page);

    // The skip link is the first stop and leads past the header.
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: en.admin.skipToContent });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();

    await nav.getByRole('link', { name: en.admin.shell.members }).click();
    await expect(page).toHaveURL(`${ADMIN_URL}/t/ejemplo-a/members`);
    await expect(nav.getByRole('link', { name: en.admin.shell.members })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.getByRole('link', { name: en.admin.shell.dashboard })).not.toHaveAttribute(
      'aria-current',
    );
  });

  test('lets a member of several sites choose one, and switch to another', async ({ page }) => {
    const { id } = await signedInAccount(page, created);
    await addMembership(id, 'ejemplo-a');
    await addMembership(id, 'ejemplo-b');
    await page.goto(ADMIN_URL);
    await expect(page).toHaveURL(`${ADMIN_URL}/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.auth.home.title);
    // The sites, as a list (the page also links to the member's tokens).
    await expect(page.getByRole('main').getByRole('listitem').getByRole('link')).toHaveText([
      'Example tenant A',
      'Example tenant B',
    ]);
    await expectAccessible(page);

    await page.getByRole('link', { name: 'Example tenant A' }).click();
    await expect(page).toHaveURL(`${ADMIN_URL}/t/ejemplo-a`);
    await expectAccessible(page);
    const switcher = page.getByRole('button', { name: en.admin.shell.switchSite });
    // By keyboard: the arrow opens it on its first item, the next one is the other site, Enter follows it.
    await switcher.focus();
    await page.keyboard.press('ArrowDown');
    const items = page.getByRole('menu').getByRole('menuitem');
    await expect(items).toHaveText([
      `Example tenant A (${en.admin.shell.current})`,
      'Example tenant B',
      en.admin.shell.allSites,
    ]);
    await expect(items.first()).toHaveAttribute('data-highlighted', '');
    // The page under it was checked above, with the menu shut.
    await expectAccessible(page, '[role="menu"]');
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toHaveAttribute('data-highlighted', '');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${ADMIN_URL}/t/ejemplo-b`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Example tenant B');

    await switcher.click();
    await page.getByRole('menuitem', { name: en.admin.shell.allSites }).click();
    await expect(page).toHaveURL(`${ADMIN_URL}/`);
  });

  test('shows a platform admin every site, the one not yet public included', async ({ page }) => {
    const { id } = await signedInAccount(page, created);
    await asOwner('INSERT INTO app.platform_admins (user_id) VALUES ($1)', [id]);
    await page.goto(ADMIN_URL);
    await expect(page).toHaveURL(`${ADMIN_URL}/`);
    await expect(page.getByText(en.admin.sites.platformAdmin)).toBeVisible();
    for (const name of ['Example tenant A', 'Example tenant B', 'Example tenant inactive']) {
      await expect(page.getByRole('link', { name })).toBeVisible();
    }
    await page.getByRole('link', { name: 'Example tenant inactive' }).click();
    await expect(page.getByText(en.admin.dashboard.notPublic)).toBeVisible();
    await expect(page.getByText(en.admin.dashboard.platformAdmin, { exact: false })).toBeVisible();
    await expectAccessible(page);
  });

  test("answers 404 for a site the user can't open, as for one that doesn't exist", async ({
    page,
  }) => {
    const { id } = await signedInAccount(page, created);
    await addMembership(id, 'ejemplo-a');
    for (const path of ['/t/ejemplo-b', '/t/ejemplo-b/members', '/t/no-existe', '/t/NoEsUnSlug']) {
      const response = await page.goto(`${ADMIN_URL}${path}`);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.admin.notFound.title);
    }
    await expectAccessible(page);
    await page.getByRole('link', { name: en.admin.notFound.home }).click();
    await expect(page).toHaveURL(`${ADMIN_URL}/t/ejemplo-a`);
  });

  test.describe('in Spanish', () => {
    test.use({ locale: 'es-ES' });

    test("speaks Spanish, and marks a site's name in another language as such", async ({
      page,
    }) => {
      const { id } = await signedInAccount(page, created);
      await addMembership(id, 'ejemplo-a', 'country_admin');
      await page.goto(`${ADMIN_URL}/t/ejemplo-a`);
      await expect(page.locator('html')).toHaveAttribute('lang', 'es');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inquilino de ejemplo A');
      await expect(page.getByText('Tus roles aquí: coordinación.')).toBeVisible();
      // The signup list in numbers, never an address (PLAN R119); how many depends on the other tests' signups.
      const signups = page.getByRole('region', { name: es.admin.dashboard.signups.title });
      await expect(signups.getByText(es.admin.dashboard.signups.intro)).toBeVisible();
      await expect(signups.getByRole('listitem')).toHaveCount(3);
      await expect(signups.getByText(/@/)).toHaveCount(0);
      await expect(
        page.getByRole('navigation', { name: es.admin.shell.nav }).getByRole('link'),
      ).toHaveText([
        es.admin.shell.dashboard,
        es.admin.shell.elections,
        es.admin.shell.reports,
        es.admin.shell.members,
        es.admin.shell.settings,
        // A country admin's: the audit log (H3.1).
        es.admin.shell.audit,
      ]);
      await expectAccessible(page);
    });
  });

  test("marks a site's name in another language than the page's", async ({ page }) => {
    const { id } = await signedInAccount(page, created);
    // A site of the test's own, named in Spanish only.
    const site = await createTenant({ english: false });
    try {
      await addMembership(id, site.slug);
      await page.goto(`${ADMIN_URL}/t/${site.slug}`);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('heading', { level: 1 }).locator('span[lang="es"]')).toHaveText(
        site.name.es,
      );
    } finally {
      await purgeTenant(site.id);
    }
  });
});

test.describe('on a phone (admin forms §1.11, PLAN R197)', () => {
  test('keeps each row of sections to one line, scrolled to the current one, and every target at 44 px', async ({
    page,
  }) => {
    const { id } = await signedInAccount(page, created, 'Persona con teléfono');
    await addMembership(id, 'ejemplo-a', 'country_admin');
    await page.setViewportSize({ width: 390, height: 844 });
    // A section late in the election's row.
    await page.goto(`${ADMIN_URL}/t/ejemplo-a/e/generales-de-ejemplo/corrections`);
    for (const name of [en.admin.shell.nav, en.admin.election.nav]) {
      const row = page.getByRole('navigation', { name });
      const box = await row.boundingBox();
      expect(box?.height ?? 0).toBeLessThanOrEqual(64);
    }
    const current = page
      .getByRole('navigation', { name: en.admin.election.nav })
      .locator('[aria-current="page"]');
    const shown = await current.boundingBox();
    expect(shown).not.toBeNull();
    expect(shown?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((shown?.x ?? 0) + (shown?.width ?? 0)).toBeLessThanOrEqual(390);
    // Expressions, not functions: this package's types have no DOM.
    expect(
      await page.evaluate(
        'document.documentElement.scrollWidth > document.documentElement.clientWidth',
      ),
    ).toBe(false);
    // Text buttons too: never smaller than a fingertip.
    const signOut = page.getByRole('button', { name: en.auth.home.signOut });
    expect((await signOut.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expectAccessible(page);
  });
});
