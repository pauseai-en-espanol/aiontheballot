import { messages } from '@aiontheballot/i18n/messages';
import { expect, type Page, test } from '@playwright/test';

import {
  addMembership,
  asOwner,
  createAccount,
  createTenant,
  deleteAccounts,
  purgeTenant,
} from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { ADMIN_URL } from '../servers.js';

const en = messages.en;
const es = messages.es;
const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

type Role = 'country_admin' | 'editor' | 'reviewer';

/**
 * A site of the test's own, with a member for each entry (fictional names, roles as given): what a test changes there
 * touches nothing another test reads. It is purged afterwards.
 */
const withSite = async (
  members: Record<string, Role[]>,
  run: (
    site: Awaited<ReturnType<typeof createTenant>>,
    ids: Record<string, string>,
  ) => Promise<void>,
) => {
  const site = await createTenant();
  try {
    const ids: Record<string, string> = {};
    for (const [name, roles] of Object.entries(members)) {
      const account = await createAccount(name);
      created.push(account.id);
      ids[name] = account.id;
      for (const role of roles) {
        await addMembership(account.id, site.slug, role);
      }
    }
    await run(site, ids);
  } finally {
    await purgeTenant(site.id);
  }
};

const row = (page: Page, name: string) =>
  page.getByRole('row').filter({ has: page.getByRole('rowheader', { name, exact: true }) });

test.describe("a site's members (editorial workflow A7)", () => {
  test('shows every member names and roles, but emails only to those who manage members', async ({
    page,
  }) => {
    await withSite({ 'Persona Coordinadora': ['country_admin'] }, async (site) => {
      const { id } = await signedInAccount(page, created, 'Persona Editora');
      await addMembership(id, site.slug, 'editor');
      await page.goto(`${ADMIN_URL}/t/${site.slug}/members`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.admin.members.title);
      const table = page.getByRole('table', { name: `Members of ${site.name.en}` });
      await expect(table.getByRole('columnheader')).toHaveText([
        en.admin.members.name,
        en.admin.members.roles,
      ]);
      await expect(row(page, 'Persona Coordinadora')).toContainText(en.admin.roles.country_admin);
      await expect(row(page, `Persona Editora (${en.admin.members.you})`)).toContainText(
        en.admin.roles.editor,
      );
      await expect(page.getByText('@example.org')).toHaveCount(0);
      await expect(page.getByRole('button', { name: en.admin.members.remove })).toHaveCount(0);
      await expect(page.getByRole('button', { name: en.admin.members.add })).toHaveCount(0);
      await expectAccessible(page);
    });
  });

  test('lets a country admin remove a role after confirming it, and give another', async ({
    page,
  }) => {
    await withSite({ 'Persona Y': ['editor', 'reviewer'] }, async (site, ids) => {
      const { id } = await signedInAccount(page, created, 'Persona X');
      await addMembership(id, site.slug, 'country_admin');
      await page.goto(`${ADMIN_URL}/t/${site.slug}/members`);
      const table = page.getByRole('table');
      await expect(table.getByRole('columnheader')).toHaveText([
        en.admin.members.name,
        en.admin.members.email,
        en.admin.members.roles,
      ]);
      await expect(row(page, 'Persona Y')).toContainText('@example.org');
      await expectAccessible(page);

      const removeReviewer = page.getByRole('button', {
        name: fill(en.admin.members.removeLabel, {
          role: en.admin.roles.reviewer.toLowerCase(),
          name: 'Persona Y',
        }),
      });
      // Cancelling changes nothing, and gives focus back to the button.
      await removeReviewer.click();
      const dialog = page.getByRole('alertdialog', { name: en.admin.members.confirmTitle });
      await expect(dialog).toContainText(
        fill(en.admin.members.confirmBody, {
          role: en.admin.roles.reviewer.toLowerCase(),
          name: 'Persona Y',
        }),
      );
      await expectAccessible(page);
      await dialog.getByRole('button', { name: en.admin.members.cancel }).click();
      await expect(dialog).toBeHidden();
      await expect(removeReviewer).toBeFocused();

      await removeReviewer.click();
      await dialog.getByRole('button', { name: en.admin.members.confirm }).click();
      // The button is gone with the role: focus lands on the line that says what happened. It is the members table's
      // own, the first on the page: the invitations form below has its own status line.
      const status = page.getByRole('status').first();
      await expect(status).toBeFocused();
      await expect(status).toHaveText(
        fill(en.admin.members.removed, {
          role: en.admin.roles.reviewer.toLowerCase(),
          name: 'Persona Y',
        }),
      );
      await expect(row(page, 'Persona Y').getByRole('listitem')).toHaveText([
        `${en.admin.roles.editor}${en.admin.members.remove}`,
      ]);
      expect(
        await asOwner(`SELECT 1 FROM app.memberships WHERE user_id = $1 AND role = 'reviewer'`, [
          ids['Persona Y'],
        ]),
      ).toBe(0);

      const addLabel = fill(en.admin.members.addLabel, { name: 'Persona Y' });
      await page.getByLabel(addLabel).selectOption({ label: en.admin.roles.reviewer });
      await row(page, 'Persona Y').getByRole('button', { name: en.admin.members.add }).click();
      await expect(status).toHaveText(
        fill(en.admin.members.added, {
          role: en.admin.roles.reviewer.toLowerCase(),
          name: 'Persona Y',
        }),
      );
      await expect(row(page, 'Persona Y').getByRole('listitem')).toHaveCount(2);
    });
  });

  test("never offers to remove the site's only country admin, and the API refuses it anyway", async ({
    page,
  }) => {
    await withSite({ 'Persona Z': ['country_admin'] }, async (site, ids) => {
      const { id } = await signedInAccount(page, created, 'Persona X');
      await addMembership(id, site.slug, 'country_admin');
      await page.goto(`${ADMIN_URL}/t/${site.slug}/members`);
      const own = page.getByRole('button', {
        name: fill(en.admin.members.removeLabel, {
          role: en.admin.roles.country_admin.toLowerCase(),
          name: `Persona X (${en.admin.members.you})`,
        }),
      });
      await expect(own).toBeVisible();

      // Another country admin removes Persona Z meanwhile: this page still offers Persona X's removal.
      await asOwner(`DELETE FROM app.memberships WHERE user_id = $1`, [ids['Persona Z'] ?? '']);
      await own.click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toContainText(
        fill(en.admin.members.confirmSelf, { role: en.admin.roles.country_admin.toLowerCase() }),
      );
      await dialog.getByRole('button', { name: en.admin.members.confirm }).click();
      await expect(page.locator('#members-error')).toHaveText(`⚠ ${en.errors.lastCountryAdmin}`);

      // Reloaded, the page knows Persona X is the only one, and says so instead.
      await page.reload();
      await expect(own).toHaveCount(0);
      await expect(page.getByText(en.admin.members.onlyCountryAdmin)).toBeVisible();
      await expectAccessible(page);
    });
  });

  test('lets a country admin whose only role it is leave the site, while another remains', async ({
    page,
  }) => {
    await withSite({ 'Persona Z': ['country_admin'] }, async (site) => {
      const { id } = await signedInAccount(page, created, 'Persona X');
      await addMembership(id, site.slug, 'country_admin');
      await page.goto(`${ADMIN_URL}/t/${site.slug}/members`);
      await page
        .getByRole('button', {
          name: fill(en.admin.members.removeLabel, {
            role: en.admin.roles.country_admin.toLowerCase(),
            name: `Persona X (${en.admin.members.you})`,
          }),
        })
        .click();
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: en.admin.members.confirm })
        .click();
      // Without a role there, the site is gone for them: back to the list of their sites.
      await expect(page).toHaveURL(`${ADMIN_URL}/`);
      await expect(page.getByText(en.auth.home.noTenants)).toBeVisible();
    });
  });

  test.describe('in Spanish', () => {
    test.use({ locale: 'es-ES' });

    test('speaks Spanish', async ({ page }) => {
      await withSite({ 'Persona Y': ['reviewer'] }, async (site) => {
        const { id } = await signedInAccount(page, created, 'Persona X');
        await addMembership(id, site.slug, 'country_admin');
        await page.goto(`${ADMIN_URL}/t/${site.slug}/members`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(es.admin.members.title);
        await expect(
          page.getByRole('table', { name: `Miembros de ${site.name.es}` }),
        ).toBeVisible();
        await expect(row(page, 'Persona Y')).toContainText(es.admin.roles.reviewer);
        await page
          .getByRole('button', {
            name: fill(es.admin.members.removeLabel, {
              role: es.admin.roles.reviewer.toLowerCase(),
              name: 'Persona Y',
            }),
          })
          .click();
        await expect(
          page.getByRole('alertdialog', { name: es.admin.members.confirmTitle }),
        ).toBeVisible();
        await expectAccessible(page);
      });
    });
  });
});
