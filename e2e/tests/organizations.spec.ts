import { messages } from '@aiontheballot/i18n/messages';
import { expect, test } from '@playwright/test';

import { addMembership, asOwner, createTenant, deleteAccounts, purgeTenant } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { ADMIN_URL } from '../servers.js';

const en = messages.en;
const form = en.admin.organizations.form;

const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

test.describe('organizations (editorial workflow P2)', () => {
  test("are a platform admin's to change, every field, from the platform's screens", async ({
    page,
  }) => {
    const site = await createTenant({ operator: true });
    try {
      const { id } = await signedInAccount(page, created);
      await asOwner('INSERT INTO app.platform_admins (user_id) VALUES ($1)', [id]);
      await page.goto(`${ADMIN_URL}/`);
      await page.getByRole('link', { name: en.admin.organizations.title }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        en.admin.organizations.title,
      );
      // Each organization with the sites it serves, and how.
      const row = page.getByRole('row', { name: `Organización de prueba ${site.slug}` });
      await expect(row).toContainText(`${site.name.en} (${en.admin.organizations.roles.operator})`);
      await expectAccessible(page);

      await row.getByRole('link').click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        `Organización de prueba ${site.slug}`,
      );
      await page.getByLabel(form.contactEmail).fill(' Contacto@Ejemplo.ORG ');
      await page.getByLabel(form.url).fill('https://ejemplo.org');
      await page.getByRole('button', { name: form.save }).click();
      await expect(page.getByRole('status').first()).toHaveText(form.saved);
      expect(
        await asOwner(
          `SELECT 1 FROM app.organizations
            WHERE id = $1 AND contact_email = 'contacto@ejemplo.org' AND url = 'https://ejemplo.org'`,
          [site.operatorId],
        ),
      ).toBe(1);
      // A refusal points at the field it is about, in words.
      await page.getByLabel(form.legalName).fill('   ');
      await page.getByRole('button', { name: form.save }).click();
      await expect(page.getByRole('alert').first()).toHaveText(
        `⚠ ${en.admin.organizations.constraints.legalName}`,
      );
      await expect(page.getByLabel(form.legalName)).toHaveAttribute('aria-invalid', 'true');
      await expectAccessible(page);
    } finally {
      await purgeTenant(site.id, site.operatorId);
    }
  });

  test('are created by a platform admin, and then changed on their own page', async ({ page }) => {
    const { id } = await signedInAccount(page, created);
    await asOwner('INSERT INTO app.platform_admins (user_id) VALUES ($1)', [id]);
    const name = `Organización nueva ${crypto.randomUUID().slice(0, 8)}`;
    await page.goto(`${ADMIN_URL}/platform/organizations/new`);
    await expectAccessible(page);
    // The admin's own language comes first, and none is required on its own.
    await page.getByLabel(`${form.displayName} (English)`, { exact: true }).fill(name);
    await page.getByLabel(form.legalName).fill(`${name}, asociación de ejemplo`);
    await page.getByRole('button', { name: form.create }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
    // Its own page says it was saved, and takes focus there, since the form that was used is gone.
    await expect(page.locator('#page-announcer')).toHaveText(form.saved);
    await expect(page.locator('#page-announcer')).toBeFocused();
    const organization = /\/platform\/organizations\/([0-9a-f-]{36})$/.exec(page.url())?.[1];
    expect(organization).toBeDefined();
    try {
      await expect(page.getByText(en.admin.organizations.noSites)).toBeVisible();
      await page.getByLabel(form.privacyEmail).fill('privacidad@example.org');
      await page.getByRole('button', { name: form.save }).click();
      await expect(page.getByRole('status').first()).toHaveText(form.saved);
      expect(
        await asOwner(
          `SELECT 1 FROM app.organizations WHERE id = $1 AND privacy_email = 'privacidad@example.org'`,
          [organization],
        ),
      ).toBe(1);
    } finally {
      await asOwner('DELETE FROM app.organizations WHERE id = $1', [organization]);
    }
  });

  test('are a 404 for anyone but a platform admin, who alone finds them from the site list', async ({
    page,
  }) => {
    const site = await createTenant({ operator: true });
    try {
      const { id } = await signedInAccount(page, created);
      await addMembership(id, site.slug, 'country_admin');
      await addMembership(id, 'ejemplo-a', 'country_admin');
      await page.goto(`${ADMIN_URL}/`);
      await expect(page.getByRole('heading', { name: en.admin.platform.title })).toHaveCount(0);
      await expect(page.getByRole('link', { name: en.admin.organizations.title })).toHaveCount(0);
      for (const path of [
        '/platform',
        '/platform/organizations',
        '/platform/organizations/new',
        // Even the operator of a site this account runs.
        `/platform/organizations/${site.operatorId}`,
      ]) {
        const response = await page.goto(`${ADMIN_URL}${path}`);
        expect(response?.status(), path).toBe(404);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.admin.notFound.title);
      }
    } finally {
      await purgeTenant(site.id, site.operatorId);
    }
  });
});
