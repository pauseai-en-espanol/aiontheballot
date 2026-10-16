import { messages } from '@aiontheballot/i18n/messages';
import { type Page } from '@playwright/test';

import {
  addMembership,
  asOwner,
  createTenant,
  deleteAccounts,
  ownerRows,
  purgeTenant,
} from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { get, send } from '../fetch-by-host.js';
import { ADMIN_URL, PLATFORM_HOST, PORTS } from '../servers.js';
import { expect, test } from '../test.js';

const en = messages.en;

/** A 2×1 PNG, fictional: a party's logo. */
const PARTY_LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAC0lEQVR42mNggAIAAAkAAWj2z04AAAAASUVORK5CYII=',
  'base64',
);

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
  run: (
    site: Awaited<ReturnType<typeof createTenant>>,
    election: string,
    /** The country admin's account. */
    account: string,
  ) => Promise<void>,
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
    await run(site, 'elecciones-de-prueba', id);
  } finally {
    await purgeTenant(site.id, site.operatorId);
  }
};

test.describe("an election's status (editorial workflow E5–E7, PLAN R181)", () => {
  test('goes to preview once its checklist is complete, then live after its slug is typed', async ({
    page,
  }) => {
    await withDraftElection(page, async (site, election) => {
      await page.goto(`${ADMIN_URL}/t/${site.slug}/e/${election}`);
      const needs = page.getByRole('list').filter({ hasText: en.admin.status.needs.operator });
      await expect(needs.getByRole('listitem').filter({ hasText: 'short name' })).toContainText(
        `${en.admin.status.missing}:`,
      );
      await expect(needs).toContainText('partido-ejemplo-a');
      // What is missing links to where it is done (admin forms §2, PLAN R193).
      await expect(
        needs.getByRole('listitem').filter({ hasText: 'short name' }).getByRole('link'),
      ).toHaveAttribute('href', `/t/${site.slug}/e/${election}/parties`);
      await expect(page.getByRole('button', { name: en.admin.status.openPreview })).toHaveCount(0);
      await expect(page.getByText(en.admin.status.previewNotReady)).toBeVisible();
      await expect(page.getByText(en.admin.status.warnings.noReviewers)).toBeVisible();
      // It has parties and criteria: deleting it isn't offered to fail, and the page says why.
      await expect(page.getByRole('button', { name: en.admin.election.delete })).toBeDisabled();
      await expect(
        page.getByRole('button', { name: en.admin.election.delete }),
      ).toHaveAccessibleDescription(en.admin.election.deleteLinked);
      await expectAccessible(page);

      await asOwner(
        `UPDATE app.parties SET short_name = '{"es": "PEA"}'
          WHERE slug = 'partido-ejemplo-a' AND tenant_id = $1`,
        [site.id],
      );
      await page.reload();
      // Into preview: a confirmation, nothing to type.
      await page.getByRole('button', { name: en.admin.status.openPreview }).click();
      const toPreview = page.getByRole('alertdialog', {
        name: en.admin.status.previewConfirmTitle,
      });
      await expect(toPreview).toContainText(en.admin.status.previewConfirmBody);
      await expectAccessible(page);
      await toPreview.getByRole('button', { name: en.admin.status.openPreview }).click();
      await expect(page.locator('#page-announcer')).toHaveText(en.admin.status.previewOpened);
      await expect(page.locator('#page-announcer')).toBeFocused();
      await expect(page.getByText(en.admin.election.previewNotice)).toBeVisible();
      await expect(page.getByRole('link', { name: en.admin.election.seePreview })).toHaveAttribute(
        'href',
        `/t/${site.slug}/preview/${election}`,
      );
      expect(
        await asOwner(
          `SELECT 1 FROM app.elections WHERE tenant_id = $1 AND status = 'preview' AND went_live_at IS NULL`,
          [site.id],
        ),
      ).toBe(1);
      // Still edited as a draft: its details' form is there.
      await expect(page.getByRole('button', { name: en.admin.election.saveDetails })).toBeVisible();
      await expectAccessible(page);

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

      // Live: a freeze window, behind its own button while there is none, in the reader's time zone, named; then
      // archiving.
      await page.getByText(en.admin.status.scheduleFreeze).click();
      await expect(page.getByText(/^In your time zone, \S+\.$/u)).toBeVisible();
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
      // It can't be undone: the address name typed first, as for going live.
      const archiveIt = archive.getByRole('button', { name: en.admin.status.archiveConfirm });
      await expect(archiveIt).toHaveAttribute('aria-disabled', 'true');
      await archive
        .getByLabel(en.admin.status.typeToArchive.replace('{slug}', election))
        .fill(election);
      await archiveIt.click();
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

  test("shows an election in preview in the admin's preview, never on the open site, until it goes live", async ({
    page,
  }) => {
    await withDraftElection(page, async (site, election, id) => {
      // Opening a site is a platform admin's setting: the test's account is one too.
      await asOwner('INSERT INTO app.platform_admins (user_id) VALUES ($1)', [id]);
      await asOwner(
        `UPDATE app.parties SET short_name = '{"es": "PEA"}' WHERE slug = 'partido-ejemplo-a' AND tenant_id = $1`,
        [site.id],
      );
      // The site is open, and its one election in preview.
      await asOwner(
        `DO $$ BEGIN
           PERFORM set_config('app.user_id', '${id}', true), set_config('app.aal', '2', true);
           UPDATE app.elections SET status = 'preview' WHERE tenant_id = '${site.id}';
           UPDATE app.tenants SET site_open = true WHERE id = '${site.id}';
         END $$`,
      );
      const tell = () =>
        send('POST', `http://127.0.0.1:${PORTS.web}/_internal/revalidate`, {
          json: { tenant: site.slug },
        });
      expect((await tell()).status).toBe(202);
      const scorecard = `http://${PLATFORM_HOST}:${PORTS.web}/${site.slug}/${election}`;
      const publicSite = `http://${PLATFORM_HOST}:${PORTS.web}/${site.slug}`;
      // Once the site is routed (its home answers), its election in preview is nowhere on it.
      await expect.poll(async () => (await get(publicSite)).status, { timeout: 5_000 }).toBe(200);
      expect((await get(scorecard)).status).toBe(404);
      expect((await get(publicSite)).body.toString('utf8')).not.toContain('Elecciones de prueba');

      // A logo, uploaded as for a draft: an election in preview is edited as one.
      await page.goto(`${ADMIN_URL}/t/${site.slug}/e/${election}/parties`);
      await page.getByRole('link', { name: 'Partido Ejemplo A' }).click();
      await page.locator('input[type="file"]').setInputFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: PARTY_LOGO_PNG,
      });
      await page.getByRole('button', { name: en.admin.settings.save }).click();
      await expect(
        page.getByRole('status').filter({ hasText: en.admin.settings.saved }),
      ).toBeVisible();

      // Its members see it whole in the preview, its logo and its share images too.
      const root = `/t/${site.slug}/preview`;
      const previewed = await page.goto(`${ADMIN_URL}${root}/${election}`);
      expect(previewed?.status()).toBe(200);
      const html = (await previewed?.text()) ?? '';
      expect(html).toContain('Partido Ejemplo A');
      // The party's own logo, by its hash.
      const [{ sha256 } = { sha256: '' }] = await ownerRows<{ sha256: string }>(
        `SELECT f.sha256 FROM app.parties p JOIN app.files f ON f.id = p.logo_file_id
          WHERE p.tenant_id = $1 AND p.slug = 'partido-ejemplo-a'`,
        [site.id],
      );
      const logo = `${root}/brand/${sha256}.png`;
      expect(html).toContain(logo);
      const [image] = html.match(new RegExp(`${root}/${election}/og/[^"]+\\.png`, 'u')) ?? [];
      for (const path of [logo, image]) {
        expect(path).toBeTruthy();
        const answer = await page.request.get(`${ADMIN_URL}${path ?? ''}`);
        expect(answer.status()).toBe(200);
        expect(answer.headers()['content-type']).toBe('image/png');
      }
      // Never on the public site's addresses, before or after the preview was seen (no cache passes it on).
      expect((await get(`${publicSite}${logo.slice(root.length)}`)).status).toBe(404);
      expect((await get(scorecard)).status).toBe(404);
      expect((await get(publicSite)).body.toString('utf8')).not.toContain('Elecciones de prueba');

      // Live: the public sees it.
      await asOwner(
        `DO $$ BEGIN
           PERFORM set_config('app.user_id', '${id}', true), set_config('app.aal', '2', true);
           UPDATE app.elections SET status = 'live' WHERE tenant_id = '${site.id}';
         END $$`,
      );
      expect((await tell()).status).toBe(202);
      await expect
        .poll(
          async () => (await get(scorecard)).body.toString('utf8').includes('Partido Ejemplo A'),
          {
            timeout: 5_000,
          },
        )
        .toBe(true);
    });
  });
});
