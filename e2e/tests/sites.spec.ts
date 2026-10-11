import { messages } from '@aiontheballot/i18n/messages';
import { expect, test } from '@playwright/test';

import { addMembership, asOwner, createTenant, deleteAccounts, purgeTenant } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { ADMIN_URL } from '../servers.js';

const en = messages.en;
const sites = en.admin.platformSites;
const form = sites.form;

const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

test.describe('sites (PLAN R129)', () => {
  test('are created off by a platform admin, then turned on after a confirmation', async ({
    page,
  }) => {
    // A fictional organization to run the new site: the operator of a test site of its own.
    const runner = await createTenant({ operator: true });
    const slug = `e2e-${crypto.randomUUID().slice(0, 8)}`;
    try {
      const { id } = await signedInAccount(page, created);
      await asOwner('INSERT INTO app.platform_admins (user_id) VALUES ($1)', [id]);
      await page.goto(`${ADMIN_URL}/platform/sites`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(sites.title);
      await expect(page.getByRole('row', { name: new RegExp(runner.slug) })).toContainText(
        sites.off,
      );
      await expectAccessible(page);

      await page.getByRole('link', { name: sites.new }).click();
      await expectAccessible(page);
      await page.getByLabel(form.slug).fill(slug);
      await page.getByLabel(`${form.name} (English)`, { exact: true }).fill(`Demo site ${slug}`);
      await page.getByLabel(form.countryCode).fill('xd');
      await page.getByLabel(form.defaultLocale).selectOption('en');
      await page.getByLabel(en.admin.methodology.kindNames.descriptive).check();
      await page
        .getByLabel(form.operator)
        .selectOption({ label: `Organización de prueba ${runner.slug}` });
      await page.getByLabel(form.reportRetentionDays).fill('30');
      await page.getByRole('button', { name: form.create }).click();

      // Its own page, which says it was created, off.
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Demo site ${slug}`);
      await expect(page.locator('#page-announcer')).toHaveText(form.created);
      await expect(page.getByText(sites.active.off)).toBeVisible();
      // Turning it on asks first, in a dialog.
      await page.getByRole('button', { name: sites.active.turnOn }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toContainText(sites.active.turnOnBody);
      await expectAccessible(page);
      await dialog.getByRole('button', { name: sites.active.turnOn }).click();
      await expect(page.getByText(sites.active.on)).toBeVisible();
      // Addresses are shown, never added here: that is a runbook (ADR-0002, Hostnames).
      await expect(page.getByText(sites.hostname.intro)).toBeVisible();
      await expect(page.getByRole('textbox', { name: /address/i })).toHaveCount(0);
      expect(
        await asOwner(
          `SELECT 1 FROM app.tenants
            WHERE slug = $1 AND active AND country_code = 'XD' AND default_locale = 'en'`,
          [slug],
        ),
      ).toBe(1);
    } finally {
      await asOwner(`SELECT private.purge_tenant(id) FROM app.tenants WHERE slug = $1`, [slug]);
      await purgeTenant(runner.id, runner.operatorId);
    }
  });

  test("are a 404 for anyone but a platform admin, as for a page they can't open", async ({
    page,
  }) => {
    const { id } = await signedInAccount(page, created);
    await addMembership(id, 'ejemplo-a', 'country_admin');
    for (const path of ['/platform/sites', '/platform/sites/new', '/platform/sites/ejemplo-a']) {
      const response = await page.goto(`${ADMIN_URL}${path}`);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.admin.notFound.title);
    }
  });
});
