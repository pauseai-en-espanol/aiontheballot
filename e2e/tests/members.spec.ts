import { messages } from '@aiontheballot/i18n/messages';
import { type Page } from '@playwright/test';

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
import { expect, test } from '../test.js';

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

/** The dialog that sets a member's roles, opened from their row. */
const editRoles = async (page: Page, name: string) => {
  await page.getByRole('button', { name: fill(en.admin.members.editRolesLabel, { name }) }).click();
  return page.getByRole('dialog', { name: fill(en.admin.members.rolesTitle, { name }) });
};

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
      await expect(page.getByRole('button', { name: en.admin.members.editRoles })).toHaveCount(0);
      await expectAccessible(page);
    });
  });

  test("lets a country admin set a member's roles at once, in a dialog", async ({ page }) => {
    await withSite({ 'Persona Y': ['editor', 'reviewer'] }, async (site, ids) => {
      const { id } = await signedInAccount(page, created, 'Persona X');
      await addMembership(id, site.slug, 'country_admin');
      await page.goto(`${ADMIN_URL}/t/${site.slug}/members`);
      const table = page.getByRole('table');
      await expect(table.getByRole('columnheader')).toHaveText([
        en.admin.members.name,
        en.admin.members.email,
        en.admin.members.roles,
        // Editing roles, and a password reset email for each member (PLAN R170).
        en.admin.members.actions,
      ]);
      await expect(row(page, 'Persona Y')).toContainText('@example.org');
      await expect(row(page, 'Persona Y').getByRole('listitem')).toHaveText([
        en.admin.roles.editor,
        en.admin.roles.reviewer,
      ]);
      await expectAccessible(page);

      // Cancelling changes nothing, and gives focus back to the button.
      const open = page.getByRole('button', {
        name: fill(en.admin.members.editRolesLabel, { name: 'Persona Y' }),
      });
      let dialog = await editRoles(page, 'Persona Y');
      await expect(dialog.getByRole('checkbox', { name: en.admin.roles.editor })).toBeChecked();
      await expect(dialog.getByRole('checkbox', { name: en.admin.roles.reviewer })).toBeChecked();
      await expect(
        dialog.getByRole('checkbox', { name: en.admin.roles.country_admin }),
      ).not.toBeChecked();
      await expectAccessible(page);
      await dialog.getByRole('checkbox', { name: en.admin.roles.reviewer }).uncheck();
      await dialog.getByRole('button', { name: en.admin.members.cancel }).click();
      await expect(dialog).toBeHidden();
      await expect(open).toBeFocused();
      await expect(row(page, 'Persona Y').getByRole('listitem')).toHaveCount(2);

      // One less, one more, saved at once: focus lands on the line that says what happened, the members table's own,
      // the first on the page (the invitations form below has its own).
      dialog = await editRoles(page, 'Persona Y');
      await dialog.getByRole('checkbox', { name: en.admin.roles.reviewer }).uncheck();
      await dialog.getByRole('checkbox', { name: en.admin.roles.country_admin }).check();
      await dialog.getByRole('button', { name: en.admin.members.saveRoles }).click();
      const status = page.getByRole('status').first();
      await expect(status).toBeFocused();
      await expect(status).toHaveText(fill(en.admin.members.rolesSaved, { name: 'Persona Y' }));
      await expect(row(page, 'Persona Y').getByRole('listitem')).toHaveText([
        en.admin.roles.country_admin,
        en.admin.roles.editor,
      ]);
      expect(
        await asOwner(
          `SELECT 1 FROM app.memberships WHERE user_id = $1 AND role IN ('country_admin', 'editor')`,
          [ids['Persona Y']],
        ),
      ).toBe(2);

      // Unticking every role says the member loses the site.
      dialog = await editRoles(page, 'Persona Y');
      for (const role of ['country_admin', 'editor'] as const) {
        await dialog.getByRole('checkbox', { name: en.admin.roles[role] }).uncheck();
      }
      await expect(dialog).toContainText(fill(en.admin.members.loseAccess, { name: 'Persona Y' }));
      await dialog.getByRole('button', { name: en.admin.members.saveRoles }).click();
      await expect(row(page, 'Persona Y')).toHaveCount(0);
      expect(
        await asOwner(`SELECT 1 FROM app.memberships WHERE user_id = $1`, [ids['Persona Y']]),
      ).toBe(0);
    });
  });

  test("never lets the site's only country admin lose that role, and the API refuses it anyway", async ({
    page,
  }) => {
    await withSite({ 'Persona Z': ['country_admin'] }, async (site, ids) => {
      const { id } = await signedInAccount(page, created, 'Persona X');
      await addMembership(id, site.slug, 'country_admin');
      await page.goto(`${ADMIN_URL}/t/${site.slug}/members`);
      const self = `Persona X (${en.admin.members.you})`;
      let dialog = await editRoles(page, self);
      const own = dialog.getByRole('checkbox', { name: en.admin.roles.country_admin });
      await expect(own).toBeEnabled();

      // Another country admin removes Persona Z meanwhile: this page still lets Persona X untick theirs.
      await asOwner(`DELETE FROM app.memberships WHERE user_id = $1`, [ids['Persona Z'] ?? '']);
      await own.uncheck();
      await expect(dialog).toContainText(en.admin.members.loseAccessSelf);
      await dialog.getByRole('button', { name: en.admin.members.saveRoles }).click();
      await expect(page.locator('#members-error')).toHaveText(`⚠ ${en.errors.lastCountryAdmin}`);

      // Reloaded, the page knows Persona X is the only one: the box can't be unticked, and says why.
      await page.reload();
      dialog = await editRoles(page, self);
      await expect(
        dialog.getByRole('checkbox', { name: en.admin.roles.country_admin }),
      ).toBeDisabled();
      await expect(dialog).toContainText(en.admin.members.onlyCountryAdmin);
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
      const dialog = await editRoles(page, `Persona X (${en.admin.members.you})`);
      await dialog.getByRole('checkbox', { name: en.admin.roles.country_admin }).uncheck();
      await dialog.getByRole('button', { name: en.admin.members.saveRoles }).click();
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
            name: fill(es.admin.members.editRolesLabel, { name: 'Persona Y' }),
          })
          .click();
        const dialog = page.getByRole('dialog', {
          name: fill(es.admin.members.rolesTitle, { name: 'Persona Y' }),
        });
        await expect(dialog.getByRole('checkbox', { name: es.admin.roles.reviewer })).toBeChecked();
        await expect(dialog).toContainText(es.admin.members.roleHints.reviewer);
        await expectAccessible(page);
      });
    });
  });
});
