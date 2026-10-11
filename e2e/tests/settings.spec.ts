import { messages } from '@aiontheballot/i18n/messages';
import { expect, type Page, test } from '@playwright/test';

import { addMembership, asOwner, createTenant, deleteAccounts, purgeTenant } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { ADMIN_URL } from '../servers.js';

const en = messages.en;
const es = messages.es;

const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

type Role = 'country_admin' | 'editor' | 'reviewer';

/** A site of the test's own, opened by a new account with `role` there (or as a platform admin); purged afterwards. */
const asMemberOfOwnSite = async (
  page: Page,
  role: Role | 'platform_admin',
  run: (site: Awaited<ReturnType<typeof createTenant>>) => Promise<void>,
) => {
  const site = await createTenant();
  try {
    const { id } = await signedInAccount(page, created);
    if (role === 'platform_admin') {
      await asOwner('INSERT INTO app.platform_admins (user_id) VALUES ($1)', [id]);
    } else {
      await addMembership(id, site.slug, role);
    }
    await run(site);
  } finally {
    await purgeTenant(site.id);
  }
};

test.describe("a site's settings (editorial workflow §5, P1)", () => {
  test('let a country admin change how long reports are kept, and show the review setting', async ({
    page,
  }) => {
    await asMemberOfOwnSite(page, 'country_admin', async (site) => {
      await page.goto(`${ADMIN_URL}/t/${site.slug}`);
      await page
        .getByRole('navigation', { name: en.admin.shell.nav })
        .getByRole('link', { name: en.admin.shell.settings })
        .click();
      await expect(page).toHaveURL(`${ADMIN_URL}/t/${site.slug}/settings`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.admin.settings.title);
      // Only a platform admin changes it; everyone sees it, in words.
      await expect(
        page.getByRole('checkbox', { name: en.admin.settings.review.liveEdits }),
      ).toHaveCount(0);
      await expect(page.getByText(en.admin.settings.off, { exact: true })).toBeVisible();
      await expectAccessible(page);

      const days = page.getByLabel(en.admin.settings.retention.label);
      await expect(days).toHaveValue('365');
      await days.fill('30');
      await page.getByRole('button', { name: en.admin.settings.retention.save }).click();
      await expect(page.getByRole('status')).toHaveText(en.admin.settings.saved);
      await expect(page.getByRole('status')).toBeFocused();
      expect(
        await asOwner(`SELECT 1 FROM app.tenants WHERE id = $1 AND report_retention_days = 30`, [
          site.id,
        ]),
      ).toBe(1);
      await page.reload();
      await expect(page.getByLabel(en.admin.settings.retention.label)).toHaveValue('30');
    });
  });

  test('let only a platform admin turn on a second approver for live changes', async ({ page }) => {
    await asMemberOfOwnSite(page, 'platform_admin', async (site) => {
      await page.goto(`${ADMIN_URL}/t/${site.slug}/settings`);
      const toggle = page.getByRole('checkbox', { name: en.admin.settings.review.liveEdits });
      await expect(toggle).not.toBeChecked();
      await toggle.check();
      await page.getByRole('button', { name: en.admin.settings.review.save }).click();
      await expect(page.getByRole('status').first()).toHaveText(en.admin.settings.saved);
      expect(
        await asOwner(
          `SELECT 1 FROM app.tenants WHERE id = $1 AND live_edits_need_second_approver`,
          [site.id],
        ),
      ).toBe(1);
      await expectAccessible(page);
    });
  });

  test('show an editor every setting, and no way to change them', async ({ page }) => {
    await asMemberOfOwnSite(page, 'editor', async (site) => {
      await page.goto(`${ADMIN_URL}/t/${site.slug}/settings`);
      await expect(
        page.getByRole('button', { name: en.admin.settings.retention.save }),
      ).toHaveCount(0);
      await expect(page.getByRole('button', { name: en.admin.settings.review.save })).toHaveCount(
        0,
      );
      await expect(page.getByText('365 days')).toBeVisible();
      await page.getByRole('link', { name: en.admin.settings.texts.kinds.privacy_policy }).click();
      await expect(page.getByText(en.admin.texts.readOnly)).toBeVisible();
      await expect(page.getByRole('button', { name: en.admin.texts.saveDraft })).toHaveCount(0);
      await expectAccessible(page);
    });
  });
});

test.describe("the operator's texts (editorial workflow T2)", () => {
  test('are written per language, saved as drafts, and published after a confirmation', async ({
    page,
  }) => {
    await asMemberOfOwnSite(page, 'country_admin', async (site) => {
      await page.goto(`${ADMIN_URL}/t/${site.slug}/settings`);
      await expect(page.getByText(en.admin.settings.texts.notPublished).first()).toBeVisible();
      await page.getByRole('link', { name: en.admin.settings.texts.kinds.privacy_policy }).click();
      await expect(page).toHaveURL(`${ADMIN_URL}/t/${site.slug}/settings/texts/privacy_policy`);
      await expect(page.getByRole('heading', { level: 2 }).first()).toHaveText('Version 1');

      // One tab per language, the default first and marked as needed to publish.
      const tabs = page.getByRole('tablist', { name: en.admin.texts.body }).getByRole('tab');
      await expect(tabs).toHaveText([`Spanish (${en.admin.localized.needed})`, 'English']);
      await expectAccessible(page);

      // In English only, it saves as a draft but doesn't publish.
      await tabs.nth(1).click();
      await page.getByLabel(`${en.admin.texts.body} (English)`).fill('An example privacy policy.');
      await page.getByRole('button', { name: en.admin.texts.saveDraft }).click();
      await expect(page.getByRole('status')).toHaveText(en.admin.texts.saved);
      // Saved again at once, it changes the same draft, and keeps what was typed.
      await page
        .getByLabel(`${en.admin.texts.body} (English)`)
        .fill('An example privacy policy, revised.');
      await page.getByRole('button', { name: en.admin.texts.saveDraft }).click();
      await expect(page.getByRole('status')).toHaveText(en.admin.texts.saved);
      await expect(page.locator('#document-error')).toBeEmpty();
      await expect(page.getByLabel(`${en.admin.texts.body} (English)`)).toHaveValue(
        'An example privacy policy, revised.',
      );
      await expect(page.getByRole('heading', { level: 2 }).first()).toHaveText(
        'Draft of version 1',
      );
      await page.getByRole('button', { name: en.admin.texts.publish }).click();
      const dialog = page.getByRole('alertdialog', { name: en.admin.texts.publishTitle });
      await expect(dialog).toContainText(en.admin.texts.publishBody);
      await expectAccessible(page);
      await dialog.getByRole('button', { name: en.admin.texts.publish }).click();
      // The refusal names the language, and brings its tab forward with focus in its text.
      await expect(
        page.getByRole('alert').filter({ hasText: 'Publishing needs the text in Spanish.' }),
      ).toBeVisible();
      await expect(
        page.getByRole('tab', { name: `Spanish (${en.admin.localized.needed})` }),
      ).toHaveAttribute('aria-selected', 'true');
      await expect(
        page.getByLabel(`${en.admin.texts.body} (Spanish, ${en.admin.localized.needed})`),
      ).toBeFocused();

      // With the default language too, it publishes, and the next version starts as a copy of it.
      const spanish = page.getByLabel(
        `${en.admin.texts.body} (Spanish, ${en.admin.localized.needed})`,
      );
      await expect(spanish).toHaveAttribute('lang', 'es');
      await spanish.fill('Una política de privacidad de ejemplo.\n\nCon dos párrafos.');
      await page.getByRole('button', { name: en.admin.texts.publish }).click();
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: en.admin.texts.publish })
        .click();
      await expect(page.getByRole('status')).toHaveText('Version 1 published.');
      await expect(page.getByRole('status')).toBeFocused();
      await expect(page.getByRole('heading', { level: 2 }).first()).toHaveText('Version 2');
      await expect(
        page.getByLabel(`${en.admin.texts.body} (Spanish, ${en.admin.localized.needed})`),
      ).toHaveValue('Una política de privacidad de ejemplo.\n\nCon dos párrafos.');
      const history = page.getByRole('group').filter({ hasText: 'Version 1, published' });
      await history.getByText('Version 1, published').click();
      await expect(history.locator('[lang="es"]')).toContainText('Con dos párrafos.');

      // A second draft can be deleted; published versions stay.
      await page.getByRole('button', { name: en.admin.texts.saveDraft }).click();
      await expect(page.getByRole('heading', { level: 2 }).first()).toHaveText(
        'Draft of version 2',
      );
      await page.getByRole('button', { name: en.admin.texts.deleteDraft }).click();
      await page
        .getByRole('alertdialog', { name: en.admin.texts.deleteTitle })
        .getByRole('button', { name: en.admin.texts.deleteDraft })
        .click();
      await expect(page.getByRole('status')).toHaveText(en.admin.texts.deleted);
      await expect(page.getByRole('status')).toBeFocused();
      expect(
        await asOwner(
          `SELECT 1 FROM app.tenant_documents WHERE tenant_id = $1 AND published_at IS NOT NULL`,
          [site.id],
        ),
      ).toBe(1);
      expect(
        await asOwner(`SELECT 1 FROM app.tenant_documents WHERE tenant_id = $1`, [site.id]),
      ).toBe(1);

      expect(
        (await page.goto(`${ADMIN_URL}/t/${site.slug}/settings/texts/legal_notice`))?.status(),
      ).toBe(404);
    });
  });

  test.describe('in Spanish', () => {
    test.use({ locale: 'es-ES' });

    test('speak Spanish', async ({ page }) => {
      await asMemberOfOwnSite(page, 'country_admin', async (site) => {
        await page.goto(`${ADMIN_URL}/t/${site.slug}/settings`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(es.admin.settings.title);
        await expect(page.getByLabel(es.admin.settings.retention.label)).toBeVisible();
        await page
          .getByRole('link', { name: es.admin.settings.texts.kinds.about_operator })
          .click();
        await expect(
          page.getByRole('tablist', { name: es.admin.texts.body }).getByRole('tab'),
        ).toHaveText([`Español (${es.admin.localized.needed})`, 'Inglés']);
        await expectAccessible(page);
      });
    });
  });
});
