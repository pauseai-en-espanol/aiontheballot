import { messages } from '@aiontheballot/i18n/messages';

import { addMembership, asOwner, createTenant, deleteAccounts, purgeTenant } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { get } from '../fetch-by-host.js';
import { ADMIN_URL, PLATFORM_HOST, PORTS } from '../servers.js';
import { expect, test } from '../test.js';

const en = messages.en;
const sites = en.admin.platformSites;
const form = sites.form;
/** The platform host, where a site without addresses is served by path. */
const PLATFORM = `http://${PLATFORM_HOST}:${PORTS.web}`;

const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

test.describe('sites (PLAN R129)', () => {
  test('are created off by a platform admin, then turned on, kept out of search engines and opened', async ({
    page,
  }) => {
    // The public site may take a routing refresh (30 seconds) to follow.
    test.setTimeout(90_000);
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
      await page.getByLabel(form.countryCode, { exact: true }).selectOption('XD');
      await page.getByLabel(form.defaultLocale).selectOption('en');
      await page.getByLabel(en.admin.methodology.kindLabels.descriptive).check();
      await page
        .getByLabel(form.operator)
        .selectOption({ label: `Organización de prueba ${runner.slug}` });
      await page.getByLabel(form.reportRetentionDays).fill('30');
      await page.getByRole('button', { name: form.create }).click();

      // Its own page, which says it was created, off.
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Demo site ${slug}`);
      await expect(page.locator('#page-announcer')).toHaveText(form.created);
      await expect(page.getByText(sites.active.off)).toBeVisible();
      // Its name, other languages and operator change there; its main language doesn't, and says why (PLAN R195).
      const details = sites.detailsForm;
      await expect(
        page.getByText(details.mainLanguage.replace('{language}', 'English')),
      ).toBeVisible();
      await page
        .getByLabel(`${form.name} (English, ${en.admin.localized.needed})`, { exact: true })
        .fill(`Demo site ${slug}, renamed`);
      await page.getByRole('checkbox', { name: 'Spanish' }).check();
      await page.getByRole('tab', { name: 'Spanish' }).click();
      await page
        .getByLabel(`${form.name} (Spanish)`, { exact: true })
        .fill(`Sitio de demostración ${slug}`);
      await expectAccessible(page);
      await page.getByRole('button', { name: details.save }).click();
      await expect(page.getByRole('status').filter({ hasText: details.saved })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        `Demo site ${slug}, renamed`,
      );
      expect(
        await asOwner(
          `SELECT 1 FROM app.tenants
            WHERE slug = $1 AND default_locale = 'en' AND enabled_locales = '{en,es}'
              AND display_name ->> 'es' = $2`,
          [slug, `Sitio de demostración ${slug}`],
        ),
      ).toBe(1);
      // Taking a language away, whose pages go, asks first; cancelling changes nothing (the review of R195).
      await page.getByRole('checkbox', { name: 'Spanish' }).uncheck();
      await page.getByRole('button', { name: details.save }).click();
      const removing = page.getByRole('alertdialog', { name: details.confirmTitle });
      await expect(removing).toContainText(
        details.languagesRemoved.replace('{languages}', 'Spanish'),
      );
      await expectAccessible(page);
      await removing.getByRole('button', { name: en.admin.members.cancel }).click();
      expect(
        await asOwner(`SELECT 1 FROM app.tenants WHERE slug = $1 AND enabled_locales = '{en,es}'`, [
          slug,
        ]),
      ).toBe(1);
      await page.getByRole('checkbox', { name: 'Spanish' }).check();
      // Turning it on asks first, in a dialog.
      await page.getByRole('button', { name: sites.active.turnOn }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toContainText(sites.active.turnOnBody);
      await expectAccessible(page);
      await dialog.getByRole('button', { name: sites.active.turnOn }).click();
      await expect(page.getByText(sites.active.on)).toBeVisible();
      // Its public settings (PLAN R135): kept out of search engines, counted by Plausible, then opened, each a
      // platform admin's, the switches behind a confirmation.
      await expect(page.getByText(sites.indexing.on)).toBeVisible();
      await page.getByRole('button', { name: sites.indexing.hide }).click();
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: sites.indexing.hide })
        .click();
      await expect(page.getByText(sites.indexing.off)).toBeVisible();
      await page.getByLabel(sites.analytics.script).fill('pa-Demo_e2e.js');
      await page.getByRole('button', { name: sites.analytics.save, exact: true }).click();
      await expect(
        page.getByRole('status').filter({ hasText: sites.analytics.saved }),
      ).toBeVisible();
      await expect(page.getByText(sites.open.off)).toBeVisible();
      await page.getByRole('button', { name: sites.open.openSite }).click();
      const opening = page.getByRole('alertdialog');
      await expect(opening).toContainText(sites.open.openBody);
      await opening.getByRole('button', { name: sites.open.openSite }).click();
      await expect(page.getByText(sites.open.on)).toBeVisible();
      await expectAccessible(page);
      // The public site follows once it refreshes its routing data (every 30 seconds): never indexed, and open, so a
      // page it doesn't have is the site's own 404 page rather than the coming-soon site's plain refusal.
      await expect
        .poll(
          async () => {
            const answer = await get(`${PLATFORM}/${slug}/no-existe`);
            return [answer.headers['x-robots-tag'], answer.headers['content-type']?.split(';')[0]];
          },
          { timeout: 45_000 },
        )
        .toEqual(['noindex, nofollow', 'text/html']);
      // Addresses are shown, never added here: that is a runbook (ADR-0002, Hostnames).
      await expect(page.getByText(sites.hostname.intro)).toBeVisible();
      await expect(page.getByRole('textbox', { name: /address/i })).toHaveCount(0);
      expect(
        await asOwner(
          `SELECT 1 FROM app.tenants
            WHERE slug = $1 AND active AND country_code = 'XD' AND default_locale = 'en'
              AND site_open AND NOT search_indexing AND plausible_script = 'pa-Demo_e2e.js'`,
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
