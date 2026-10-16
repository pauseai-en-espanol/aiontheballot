import { messages } from '@aiontheballot/i18n/messages';
import { type Page } from '@playwright/test';

import { addMembership, asOwner, createTenant, deleteAccounts, purgeTenant } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { get, send } from '../fetch-by-host.js';
import { ADMIN_URL, PLATFORM_HOST, PORTS } from '../servers.js';
import { expect, test } from '../test.js';

const en = messages.en;
const es = messages.es;

/** A 2×1 PNG, fictional: a logo. */
const LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAC0lEQVR42mNggAIAAAkAAWj2z04AAAAASUVORK5CYII=',
  'base64',
);

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
      // Each form has its own status line: the colour's is empty.
      const saved = page.getByRole('status').filter({ hasText: en.admin.settings.saved });
      await expect(saved).toHaveText(en.admin.settings.saved);
      await expect(saved).toBeFocused();
      expect(
        await asOwner(`SELECT 1 FROM app.tenants WHERE id = $1 AND report_retention_days = 30`, [
          site.id,
        ]),
      ).toBe(1);
      await page.reload();
      await expect(page.getByLabel(en.admin.settings.retention.label)).toHaveValue('30');
    });
  });

  test("let a country admin choose the site's colour, which its pages and images take at once (T1, R178)", async ({
    page,
  }) => {
    const site = await createTenant({ operator: true, active: true });
    try {
      const { id } = await signedInAccount(page, created);
      await addMembership(id, site.slug, 'country_admin');
      const home = `http://${PLATFORM_HOST}:${PORTS.web}/${site.slug}`;
      // The web learns of the new site as the API tells it, on its internal address only.
      const tell = () =>
        send('POST', `http://127.0.0.1:${PORTS.web}/_internal/revalidate`, {
          json: { tenant: site.slug },
        });
      expect((await tell()).status).toBe(202);
      const page200 = async () => (await get(home)).body.toString('utf8');
      await expect.poll(page200, { timeout: 5_000 }).toContain(site.name.es);
      const image = (html: string) => /property="og:image" content="([^"]+)"/.exec(html)?.[1];
      const before = image(await page200());
      expect(before).toBeDefined();

      await page.goto(`${ADMIN_URL}/t/${site.slug}/settings`);
      const colour = page.getByLabel(en.admin.settings.colours.label, { exact: true });
      // The platform's colour until the site has its own.
      await expect(colour).toHaveValue('#ff9416');
      await expectAccessible(page);

      // What the form sends, to see that the refused colour never leaves the page.
      const sent: unknown[] = [];
      page.on('request', (request) => {
        if (request.method() === 'PATCH') {
          sent.push(request.postDataJSON());
        }
      });

      // A middle grey: neither black nor white reads on it, so it isn't saved.
      await colour.fill('#7a7a7a');
      await expect(page.getByText(/neither black nor white text reads on it/)).toBeVisible();
      await expect(
        page.getByRole('button', { name: en.admin.settings.colours.save }),
      ).toHaveAttribute('aria-disabled', 'true');
      await page.getByRole('button', { name: en.admin.settings.colours.save }).press('Enter');
      expect(
        await asOwner(`SELECT 1 FROM app.tenants WHERE id = $1 AND theme = '{}'`, [site.id]),
      ).toBe(1);

      await colour.fill('#1d3557');
      await expect(page.getByText(/#1d3557: text on it has a contrast of [\d.]+:1/)).toBeVisible();
      await page.getByRole('button', { name: en.admin.settings.colours.save }).click();
      await expect(
        page.getByRole('status').filter({ hasText: en.admin.settings.saved }),
      ).toBeVisible();
      // Only the readable colour was sent: the grey stopped at the form.
      expect(sent).toEqual([{ theme: { accent: '#1d3557' } }]);
      expect(
        await asOwner(
          `SELECT 1 FROM app.tenants WHERE id = $1 AND theme = '{"accent": "#1d3557"}'`,
          [site.id],
        ),
      ).toBe(1);
      // The public site in the site's colour, with paper on it, within the seconds the API's push takes.
      await expect.poll(page200, { timeout: 5_000 }).toContain('--colors-bg-accent:#1d3557');
      const themed = await page200();
      expect(themed).toContain('--colors-fg-on-accent:#ffffff');
      // Its share image too: another picture, so another address.
      expect(image(themed)).not.toBe(before);

      // A reset that fails leaves the site's colour, in the picker as in the database.
      const settings = `${ADMIN_URL}/api/t/${site.slug}/settings`;
      await page.route(settings, (route) =>
        route.request().method() === 'PATCH' ? route.abort('failed') : route.continue(),
      );
      await page.getByRole('button', { name: en.admin.settings.colours.reset }).click();
      await expect(page.getByText(en.errors.unexpected)).toBeVisible();
      await expect(colour).toHaveValue('#1d3557');
      expect(
        await asOwner(
          `SELECT 1 FROM app.tenants WHERE id = $1 AND theme = '{"accent": "#1d3557"}'`,
          [site.id],
        ),
      ).toBe(1);
      await page.unroute(settings);

      // Back to the platform's.
      await page.getByRole('button', { name: en.admin.settings.colours.reset }).click();
      await expect(
        page.getByRole('status').filter({ hasText: en.admin.settings.colours.resetDone }),
      ).toBeVisible();
      expect(
        await asOwner(`SELECT 1 FROM app.tenants WHERE id = $1 AND theme = '{}'`, [site.id]),
      ).toBe(1);
      await expect.poll(page200, { timeout: 5_000 }).not.toContain('--colors-bg-accent');
      expect(image(await page200())).toBe(before);
    } finally {
      await purgeTenant(site.id);
    }
  });

  test("let a country admin set the site's logos, slot by slot, which every member sees (PLAN R195)", async ({
    page,
  }) => {
    await asMemberOfOwnSite(page, 'country_admin', async (site) => {
      await page.goto(`${ADMIN_URL}/t/${site.slug}/settings`);
      const logos = en.admin.settings.logos;
      await expect(page.getByRole('heading', { level: 2, name: logos.title })).toBeVisible();
      // One field per slot, each saying where its image shows; the second is the logo on white.
      await expect(page.getByText(logos.slots.operator_logo_on_canvas.hint)).toBeVisible();
      await page.locator('input[type="file"]').nth(1).setInputFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: LOGO_PNG,
      });
      await expectAccessible(page);
      await page.getByRole('button', { name: logos.save }).click();
      await expect(page.getByRole('status').filter({ hasText: logos.saved })).toBeVisible();
      const shown = page.getByRole('img', {
        name: logos.alt.replace('{slot}', logos.slots.operator_logo_on_canvas.label),
      });
      await expect(shown).toHaveJSProperty('naturalWidth', 2);
      expect(
        await asOwner(
          `SELECT 1 FROM app.tenant_brand_selections s JOIN app.files f ON f.id = s.file_id
            WHERE s.tenant_id = $1 AND s.slot = 'operator_logo_on_canvas' AND f.bucket = 'public_assets'`,
          [site.id],
        ),
      ).toBe(1);
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
      await expect(
        page.getByText(en.admin.settings.colours.platform, { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: en.admin.settings.colours.save })).toHaveCount(
        0,
      );
      // The logos too, each slot saying what it holds (PLAN R195).
      await expect(page.getByRole('button', { name: en.admin.settings.logos.save })).toHaveCount(0);
      await expect(page.getByText(en.admin.settings.logos.none)).toHaveCount(5);
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
      // Previewed as the public site will show it, raw HTML escaped (admin forms §1.9, PLAN R196).
      const englishBody = page.getByLabel(`${en.admin.texts.body} (English)`);
      await englishBody.fill('An **example** policy.\n\n<b>Not HTML</b>');
      const english = page.getByRole('tabpanel', { name: 'English' });
      await english.getByRole('button', { name: en.admin.form.markdown.preview }).click();
      await expect(english.locator('strong')).toHaveText('example');
      await expect(english.getByText('<b>Not HTML</b>')).toBeVisible();
      await expectAccessible(page);
      await english.getByRole('button', { name: en.admin.form.markdown.write }).click();
      await expect(englishBody).toBeVisible();
      await englishBody.fill('An example privacy policy.');
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
      // Without the default language it isn't offered: said at the field, before any confirmation, naming the language,
      // and its tab comes forward with focus in its text (admin forms §1.2).
      await page.getByRole('button', { name: en.admin.texts.publish }).click();
      await expect(page.getByText('Publishing needs the text in Spanish.')).toBeVisible();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
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
      const dialog = page.getByRole('alertdialog', { name: en.admin.texts.publishTitle });
      await expect(dialog).toContainText(en.admin.texts.publishBody);
      await expectAccessible(page);
      await dialog.getByRole('button', { name: en.admin.texts.publish }).click();
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
