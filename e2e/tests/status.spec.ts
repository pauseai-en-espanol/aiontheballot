import { messages } from '@aiontheballot/i18n/messages';
import { expect, type Page, test } from '@playwright/test';

import { addMembership, asOwner, createTenant, deleteAccounts, purgeTenant } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { ADMIN_URL } from '../servers.js';

const en = messages.en;

const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

/**
 * An active site of the test's own, with a fictional operator, and a draft election in it with what going live needs
 * but a party's short name in Spanish; opened by a new country admin. Purged afterwards, with its operator.
 */
const withDraftElection = async (
  page: Page,
  run: (site: Awaited<ReturnType<typeof createTenant>>, election: string) => Promise<void>,
) => {
  const site = await createTenant({ operator: true, active: true });
  try {
    const { id } = await signedInAccount(page, created);
    await addMembership(id, site.slug, 'country_admin');
    await asOwner(
      `WITH e AS (
         INSERT INTO app.elections (tenant_id, slug, type, name)
         VALUES ($1, 'elecciones-de-prueba', 'general', '{"es": "Elecciones de prueba"}') RETURNING id, tenant_id
       ), m AS (
         INSERT INTO app.methodologies (tenant_id, election_id, kind, demands_owner_id, body)
         SELECT tenant_id, id, 'demands', $2, '{"es": "Metodología de ejemplo."}' FROM e RETURNING id
       ), p AS (
         INSERT INTO app.parties (tenant_id, election_id, slug, name, short_name, display_order)
         SELECT tenant_id, id, 'partido-ejemplo-a', '{"es": "Partido Ejemplo A"}', '{"en": "EPA"}', 1 FROM e
       )
       INSERT INTO app.criteria (tenant_id, election_id, slug, title, short_title, description, display_order)
       SELECT tenant_id, id, 'criterio-de-ejemplo-1', '{"es": "Criterio de ejemplo 1"}', '{"es": "Ejemplo 1"}',
              '{"es": "Descripción de ejemplo."}', 1 FROM e`,
      [site.id, site.operatorId],
    );
    await run(site, 'elecciones-de-prueba');
  } finally {
    await purgeTenant(site.id, site.operatorId);
  }
};

test.describe("an election's status (editorial workflow E5–E7)", () => {
  test('goes live once its checklist is complete, after its slug is typed', async ({ page }) => {
    await withDraftElection(page, async (site, election) => {
      await page.goto(`${ADMIN_URL}/t/${site.slug}/e/${election}`);
      const needs = page.getByRole('list').filter({ hasText: en.admin.status.needs.operator });
      await expect(needs.getByRole('listitem').filter({ hasText: 'short name' })).toContainText(
        `${en.admin.status.missing}:`,
      );
      await expect(needs).toContainText('partido-ejemplo-a');
      await expect(page.getByRole('button', { name: en.admin.status.goLive })).toHaveCount(0);
      await expect(page.getByText(en.admin.status.notReady)).toBeVisible();
      await expect(page.getByText(en.admin.status.warnings.noReviewers)).toBeVisible();
      await expectAccessible(page);

      await asOwner(
        `UPDATE app.parties SET short_name = '{"es": "PEA"}'
          WHERE slug = 'partido-ejemplo-a' AND tenant_id = $1`,
        [site.id],
      );
      await page.reload();
      await page.getByRole('button', { name: en.admin.status.goLive }).click();
      const dialog = page.getByRole('alertdialog', { name: en.admin.status.confirmTitle });
      const confirm = dialog.getByRole('button', { name: en.admin.status.confirm });
      await expect(confirm).toHaveAttribute('aria-disabled', 'true');
      await expectAccessible(page);
      await dialog.getByLabel(en.admin.status.typeSlug.replace('{slug}', election)).fill(election);
      await expect(confirm).toHaveAttribute('aria-disabled', 'false');
      await confirm.click();
      // The go-live panel goes with the draft: the page's own status line says it's done, and has focus.
      await expect(page.locator('#page-announcer')).toHaveText(en.admin.status.wentLive);
      await expect(page.locator('#page-announcer')).toBeFocused();
      await expect(page.getByText(en.admin.election.liveNotice)).toBeVisible();
      expect(
        await asOwner(
          `SELECT 1 FROM app.elections WHERE tenant_id = $1 AND status = 'live' AND went_live_at IS NOT NULL`,
          [site.id],
        ),
      ).toBe(1);

      // Live: a freeze window, then archiving.
      await page.getByLabel(en.admin.status.frozenFrom).fill('2030-01-01T09:00');
      await page.getByRole('button', { name: en.admin.status.saveFreeze }).click();
      await expect(page.locator('#page-announcer')).toHaveText(en.admin.status.freezeSaved);
      await expect(page.getByText(/^Frozen since|^A freeze window starts/)).toBeVisible();
      // Archiving would leave the window for good: it isn't offered until the window is cleared.
      await expect(page.getByRole('button', { name: en.admin.status.archiveConfirm })).toHaveCount(
        0,
      );
      await expect(page.getByText(en.admin.status.archiveFrozen)).toBeVisible();
      await page.getByRole('button', { name: en.admin.status.clearFreeze }).click();
      await expect(page.locator('#page-announcer')).toHaveText(en.admin.status.freezeCleared);
      await expect(page.getByText(en.admin.status.noFreeze)).toBeVisible();

      await page.getByRole('button', { name: en.admin.status.archiveConfirm }).click();
      const archive = page.getByRole('alertdialog', { name: en.admin.status.archiveTitle });
      await expect(archive).toContainText(en.admin.status.archiveBody);
      await archive.getByRole('button', { name: en.admin.status.archiveConfirm }).click();
      await expect(page.getByText(en.admin.election.archivedNotice)).toBeVisible();
      await expect(page.locator('#page-announcer')).toHaveText(en.admin.status.archived);
      await expect(page.locator('#page-announcer')).toBeFocused();
      expect(
        await asOwner(`SELECT 1 FROM app.elections WHERE tenant_id = $1 AND status = 'archived'`, [
          site.id,
        ]),
      ).toBe(1);
      await expectAccessible(page);
    });
  });
});
