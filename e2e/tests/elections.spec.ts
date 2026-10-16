import { messages } from '@aiontheballot/i18n/messages';
import { type Page } from '@playwright/test';

import { addMembership, asOwner, createTenant, deleteAccounts, purgeTenant } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { ADMIN_URL } from '../servers.js';
import { expect, test } from '../test.js';

/** A 2×1 PNG, fictional: a logo the admin uploads. */
const PARTY_LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAC0lEQVR42mNggAIAAAkAAWj2z04AAAAASUVORK5CYII=',
  'base64',
);

const en = messages.en;
const es = messages.es;
const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

type Role = 'country_admin' | 'editor' | 'reviewer' | 'platform_admin';

/**
 * A site of the test's own (country XE unless `country` says, Spanish and English, a fictional operator), opened by a
 * new account with `role`; purged afterwards, with its operator.
 */
const asMemberOfOwnSite = async (
  page: Page,
  role: Role,
  run: (site: Awaited<ReturnType<typeof createTenant>>) => Promise<void>,
  country?: string,
) => {
  const site = await createTenant({ operator: true, ...(country ? { country } : {}) });
  try {
    const { id } = await signedInAccount(page, created);
    if (role === 'platform_admin') {
      await asOwner('INSERT INTO app.platform_admins (user_id) VALUES ($1)', [id]);
    } else {
      await addMembership(id, site.slug, role);
    }
    await run(site);
  } finally {
    await purgeTenant(site.id, site.operatorId);
  }
};

const nameField = (page: Page, label: string, language = 'Spanish') =>
  page.getByLabel(
    language === 'Spanish'
      ? `${label} (Spanish, ${en.admin.localized.needed})`
      : `${label} (${language})`,
    { exact: true },
  );

/** Fills the new-election form, as the signed-in editor; the test submits it. */
const createElection = async (
  page: Page,
  site: { slug: string },
  { slug, name, type = 'general' }: { slug: string; name: string; type?: string },
) => {
  await page.goto(`${ADMIN_URL}/t/${site.slug}/elections/new`);
  await nameField(page, en.admin.elections.form.name).fill(name);
  await page.getByLabel(en.admin.elections.form.slug).fill(slug);
  await page.getByLabel(en.admin.elections.form.type).selectOption(type);
};

test.describe('elections (editorial workflow §6)', () => {
  test('are created by an editor as drafts, listed, and changed while drafts', async ({ page }) => {
    await asMemberOfOwnSite(page, 'editor', async (site) => {
      await page.goto(`${ADMIN_URL}/t/${site.slug}`);
      await page
        .getByRole('navigation', { name: en.admin.shell.nav })
        .getByRole('link', { name: en.admin.shell.elections })
        .click();
      await expect(page.getByText(en.admin.elections.none)).toBeVisible();
      await page.getByRole('link', { name: en.admin.elections.new }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.admin.elections.new);
      await expectAccessible(page);

      // The address name follows the name until it is edited, and shows the public address it makes (§1.5).
      await nameField(page, en.admin.elections.form.name).fill('Elecciones de Prueba Ñ');
      await expect(page.getByLabel(en.admin.form.slug.label)).toHaveValue('elecciones-de-prueba-n');
      await expect(
        page.getByText(en.admin.form.slug.preview.replace('{address}', '/elecciones-de-prueba-n')),
      ).toBeVisible();
      await page.getByLabel(en.admin.form.slug.label).fill('elecciones-de-prueba');
      await nameField(page, en.admin.elections.form.name).fill('Elecciones de prueba');
      await expect(page.getByLabel(en.admin.form.slug.label)).toHaveValue('elecciones-de-prueba');
      await page.getByLabel(en.admin.elections.form.type).selectOption('regional');
      // A regional election names its territory: the part after the country's code.
      await expect(page.getByText(en.admin.elections.form.territoryNone)).toHaveCount(0);
      await page.getByLabel(en.admin.elections.form.territory).fill('an');
      await page.getByLabel(en.admin.elections.form.date).fill('2030-05-26');
      await page.getByRole('button', { name: en.admin.elections.form.create }).click();

      await expect(page).toHaveURL(`${ADMIN_URL}/t/${site.slug}/e/elecciones-de-prueba`);
      // Said where it lands (§1.4).
      await expect(page.locator('#page-announcer')).toHaveText(en.admin.elections.form.created);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Elecciones de prueba');
      await expect(
        page.getByText(`${en.admin.elections.statuses.draft} · May 26, 2030`),
      ).toBeVisible();
      expect(
        await asOwner(
          `SELECT 1 FROM app.elections WHERE tenant_id = $1 AND territory_code = 'XE-AN'
              AND status = 'draft' AND require_second_reviewer AND NOT announced`,
          [site.id],
        ),
      ).toBe(1);
      // An editor sees the announcement and the review setting, but changes neither.
      await expect(page.getByText(en.admin.election.notAnnounced)).toBeVisible();
      await expect(page.getByRole('switch', { name: en.admin.election.fourEyes })).toHaveCount(0);
      await expect(page.getByRole('button', { name: en.admin.election.delete })).toHaveCount(0);
      await expectAccessible(page);

      // Renamed, with a new slug, the page follows it.
      await nameField(page, en.admin.elections.form.name).fill('Elecciones de prueba cambiadas');
      await page.getByLabel(en.admin.elections.form.slug).fill('elecciones-cambiadas');
      await page.getByRole('button', { name: en.admin.election.saveDetails }).click();
      await expect(page).toHaveURL(`${ADMIN_URL}/t/${site.slug}/e/elecciones-cambiadas`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Elecciones de prueba cambiadas',
      );

      await page.goto(`${ADMIN_URL}/t/${site.slug}/elections`);
      const row = page.getByRole('row').filter({ hasText: 'Elecciones de prueba cambiadas' });
      await expect(row).toContainText(en.admin.elections.types.regional);
      await expect(row).toContainText('XE-AN');
      await expect(row).toContainText(en.admin.elections.statuses.draft);
      await expectAccessible(page);
    });
  });

  test('say at the field what is missing, and which field the database refused', async ({
    page,
  }) => {
    await asMemberOfOwnSite(page, 'editor', async (site) => {
      // Nothing filled in: each field says what it needs, in the page's words, and the first takes focus (admin forms
      // §1.2); nothing is sent.
      await page.goto(`${ADMIN_URL}/t/${site.slug}/elections/new`);
      await page.getByRole('button', { name: en.admin.elections.form.create }).click();
      await expect(page.getByText(en.admin.form.problems.localized)).toBeVisible();
      await expect(page.getByText(en.admin.form.problems.required)).toBeVisible();
      await expect(nameField(page, en.admin.elections.form.name)).toBeFocused();
      await expectAccessible(page);

      const slug = page.getByLabel(en.admin.elections.form.slug);
      const refused = async (message: string) => {
        await page.getByRole('button', { name: en.admin.elections.form.create }).click();
        await expect(page.getByText(message)).toBeVisible();
        await expect(slug).toHaveAttribute('aria-invalid', 'true');
        await expect(slug).toBeFocused();
      };
      await createElection(page, site, { slug: 'pt-br', name: 'Elecciones de prueba' });
      await refused(en.admin.elections.constraints.slugLocale);
      await slug.fill('brand');
      await refused(en.admin.elections.constraints.slugReserved);

      await slug.fill('elecciones-de-prueba');
      await page.getByRole('button', { name: en.admin.elections.form.create }).click();
      await expect(page).toHaveURL(`${ADMIN_URL}/t/${site.slug}/e/elecciones-de-prueba`);
      await createElection(page, site, { slug: 'elecciones-de-prueba', name: 'Otras elecciones' });
      await refused(en.admin.elections.constraints.slugTaken);
      await expectAccessible(page);
    });
  });

  test('are announced and deleted by a country admin while drafts', async ({ page }) => {
    await asMemberOfOwnSite(page, 'country_admin', async (site) => {
      await createElection(page, site, {
        slug: 'elecciones-anunciadas',
        name: 'Elecciones de prueba',
      });
      await page.getByRole('button', { name: en.admin.elections.form.create }).click();
      await expect(page).toHaveURL(`${ADMIN_URL}/t/${site.slug}/e/elecciones-anunciadas`);

      // A switch that saves as it is switched, its state in words; focus stays on it (admin forms §2).
      const announced = page.getByRole('switch', { name: en.admin.election.announced });
      await expect(announced).toHaveAttribute('aria-checked', 'false');
      await expect(announced).toContainText(en.admin.settings.off);
      await announced.click();
      await expect(announced).toHaveAttribute('aria-checked', 'true');
      await expect(announced).toContainText(en.admin.settings.on);
      await expect(
        page.getByRole('status').filter({ hasText: en.admin.settings.saved }),
      ).toBeVisible();
      await expect(announced).toBeFocused();
      expect(
        await asOwner(`SELECT 1 FROM app.elections WHERE tenant_id = $1 AND announced`, [site.id]),
      ).toBe(1);

      // Nothing hangs from it, so it can be deleted (a draft with a methodology, parties, criteria or sources says
      // why it can't, by a button that can't be pressed).
      await page.getByRole('button', { name: en.admin.election.delete }).click();
      const dialog = page.getByRole('alertdialog', { name: en.admin.election.deleteTitle });
      await expect(dialog).toContainText(en.admin.election.deleteBody);
      await expectAccessible(page);
      await dialog.getByRole('button', { name: en.admin.election.delete }).click();
      await expect(page).toHaveURL(`${ADMIN_URL}/t/${site.slug}/elections`);
      await expect(page.locator('#page-announcer')).toHaveText(en.admin.election.deleted);
      await expect(page.getByText(en.admin.elections.none)).toBeVisible();
    });
  });

  test('let only a platform admin turn four-eyes off, after saying what it means', async ({
    page,
  }) => {
    await asMemberOfOwnSite(page, 'platform_admin', async (site) => {
      await createElection(page, site, {
        slug: 'elecciones-de-prueba',
        name: 'Elecciones de prueba',
      });
      await page.getByRole('button', { name: en.admin.elections.form.create }).click();
      await expect(page).toHaveURL(`${ADMIN_URL}/t/${site.slug}/e/elecciones-de-prueba`);

      const fourEyes = page.getByRole('switch', { name: en.admin.election.fourEyes });
      await expect(fourEyes).toHaveAttribute('aria-checked', 'true');
      await fourEyes.click();
      const dialog = page.getByRole('alertdialog', { name: en.admin.election.fourEyesOffTitle });
      await expect(dialog).toContainText(en.admin.election.fourEyesOffBody);
      await expectAccessible(page);
      // Cancelling changes nothing, and the switch still says so.
      await dialog.getByRole('button', { name: en.admin.members.cancel }).click();
      await expect(fourEyes).toHaveAttribute('aria-checked', 'true');
      expect(
        await asOwner(
          `SELECT 1 FROM app.elections WHERE tenant_id = $1 AND require_second_reviewer`,
          [site.id],
        ),
      ).toBe(1);
      await fourEyes.click();
      await dialog.getByRole('button', { name: en.admin.election.fourEyesOff }).click();
      await expect(fourEyes).toHaveAttribute('aria-checked', 'false');
      await expect(
        page.getByRole('status').filter({ hasText: en.admin.settings.saved }),
      ).toBeVisible();
      expect(
        await asOwner(
          `SELECT 1 FROM app.elections WHERE tenant_id = $1 AND NOT require_second_reviewer`,
          [site.id],
        ),
      ).toBe(1);
    });
  });

  test('have a methodology a country admin writes, with its named reviewers', async ({ page }) => {
    await asMemberOfOwnSite(page, 'country_admin', async (site) => {
      await createElection(page, site, {
        slug: 'elecciones-de-prueba',
        name: 'Elecciones de prueba',
      });
      await page.getByRole('button', { name: en.admin.elections.form.create }).click();
      await expect(page).toHaveURL(`${ADMIN_URL}/t/${site.slug}/e/elecciones-de-prueba`);
      await page
        .getByRole('navigation', { name: en.admin.election.nav })
        .getByRole('link', { name: en.admin.election.methodology })
        .click();
      await expect(page.getByText(en.admin.methodology.none)).toHaveCount(0);
      await expect(page.getByLabel(en.admin.methodology.owner)).toContainText(
        `Organización de prueba ${site.slug}`,
      );
      await nameField(page, en.admin.methodology.body).fill('Una metodología de ejemplo.');
      const kinds = page.getByRole('group', { name: en.admin.methodology.admissible });
      await expect(
        kinds.getByRole('checkbox', { name: en.admin.methodology.kinds.pdf }),
      ).toBeChecked();
      await kinds.getByRole('checkbox', { name: en.admin.methodology.kinds.video }).check();
      await expectAccessible(page);
      await page.getByRole('button', { name: en.admin.methodology.create }).click();
      await expect(
        page.getByRole('status').filter({ hasText: en.admin.settings.saved }),
      ).toBeFocused();
      expect(
        await asOwner(
          `SELECT 1 FROM app.methodologies m JOIN app.elections e ON e.id = m.election_id
            WHERE e.tenant_id = $1 AND m.admissible_source_kinds = '{pdf,web_page,video}'
              AND m.demands_owner_id = $2`,
          [site.id, site.operatorId],
        ),
      ).toBe(1);

      // A reviewer is named publicly only with their agreement, which the form asks to confirm.
      await expect(page.getByText(en.admin.methodology.noReviewers)).toBeVisible();
      await page
        .getByLabel(en.admin.methodology.reviewerName, { exact: true })
        .fill('Persona Revisora de Ejemplo');
      await page
        .getByLabel(en.admin.methodology.affiliation, { exact: true })
        .fill('Universidad de ejemplo');
      const consent = page.getByRole('checkbox', { name: en.admin.methodology.consent });
      // Not without it: said at the box, which takes focus (admin forms §1.2).
      await page.getByRole('button', { name: en.admin.methodology.addReviewer }).click();
      await expect(page.getByText(en.admin.form.problems.confirm)).toBeVisible();
      await expect(consent).toBeFocused();
      await consent.check();
      await page.getByRole('button', { name: en.admin.methodology.addReviewer }).click();
      await expect(page.getByText('Persona Revisora de Ejemplo', { exact: true })).toBeVisible();
      await expectAccessible(page);

      await page
        .getByText(fill(en.admin.methodology.editReviewer, { name: 'Persona Revisora de Ejemplo' }))
        .click();
      await page
        .getByRole('button', {
          name: fill(en.admin.methodology.deleteReviewerLabel, {
            name: 'Persona Revisora de Ejemplo',
          }),
        })
        .click();
      await page
        .getByRole('alertdialog', { name: en.admin.methodology.deleteReviewerTitle })
        .getByRole('button', { name: en.admin.methodology.deleteReviewer })
        .click();
      await expect(page.getByText(en.admin.methodology.noReviewers)).toBeVisible();
      // The button went with the reviewer: the page's own status line says it's done, and has focus.
      await expect(page.locator('#page-announcer')).toHaveText(
        en.admin.methodology.reviewerDeleted,
      );
      await expect(page.locator('#page-announcer')).toBeFocused();
    });
  });

  test('have parties and criteria an editor adds, orders by keyboard, changes and deletes', async ({
    page,
  }) => {
    await asMemberOfOwnSite(page, 'editor', async (site) => {
      await createElection(page, site, {
        slug: 'elecciones-de-prueba',
        name: 'Elecciones de prueba',
      });
      await page.getByRole('button', { name: en.admin.elections.form.create }).click();
      await expect(page).toHaveURL(`${ADMIN_URL}/t/${site.slug}/e/elecciones-de-prueba`);
      const parties = `${ADMIN_URL}/t/${site.slug}/e/elecciones-de-prueba/parties`;
      const problems = en.admin.parties.problems;
      // Nothing filled in: each field says what it needs, in words, and the first takes focus (admin forms §1.2).
      await page.goto(`${parties}/new`);
      await page.getByRole('button', { name: en.admin.parties.add }).click();
      await expect(page.getByText(problems.nameMissing)).toBeVisible();
      await expect(page.getByText(problems.shortNameMissing)).toBeVisible();
      await expect(page.getByText(problems.slugMissing)).toBeVisible();
      await expect(nameField(page, en.admin.parties.name)).toBeFocused();
      await expectAccessible(page);
      for (const [letter, short, colour] of [
        ['A', 'PEA', '#1a6b3c'],
        ['B', 'PEB', null],
      ] as const) {
        await page.goto(parties);
        await page.getByRole('link', { name: en.admin.parties.add }).click();
        await nameField(page, en.admin.parties.name).fill(`Partido Ejemplo ${letter}`);
        await nameField(page, en.admin.parties.shortName).fill(short);
        await page
          .getByLabel(en.admin.parties.slugFact)
          .fill(`partido-ejemplo-${letter.toLowerCase()}`);
        // No colour to start with, never a grey nobody chose; one is chosen by its code (or the picker).
        const colours = page.getByRole('group', { name: en.admin.parties.colour });
        await expect(colours).toContainText(en.admin.form.colour.none);
        if (colour) {
          await colours.getByRole('button', { name: en.admin.form.colour.choose }).click();
          await colours.getByLabel(en.admin.form.colour.code).fill(colour);
          // A's logo, chosen before the party exists, previewed, and uploaded right after it is created.
          await page.locator('input[type="file"]').setInputFiles({
            name: 'logo.png',
            mimeType: 'image/png',
            buffer: PARTY_LOGO_PNG,
          });
          await expect(page.getByRole('img', { name: en.admin.parties.logo })).toHaveJSProperty(
            'naturalWidth',
            2,
          );
        }
        await page.getByLabel(en.admin.parties.website).fill('https://partido.example');
        await page.getByLabel(en.admin.parties.territories).fill('xe-an');
        await expectAccessible(page);
        await page.getByRole('button', { name: en.admin.parties.add }).click();
        await expect(page).toHaveURL(parties);
        await expect(page.locator('#page-announcer')).toHaveText(en.admin.parties.added);
      }
      const list = page.getByRole('list', { name: en.admin.election.parties });
      await expect(list.getByRole('link')).toHaveText(['Partido Ejemplo A', 'Partido Ejemplo B']);
      // What each still lacks, in words.
      await expect(list.getByRole('listitem').nth(1)).toContainText(en.admin.parties.missing.logo);
      await expect(list.getByRole('listitem').nth(0)).not.toContainText(
        en.admin.parties.missing.logo,
      );
      await expectAccessible(page);

      // By keyboard: B moves up, and focus stays with it, on the button it can still use.
      await page
        .getByRole('button', {
          name: fill(en.admin.structure.upLabel, { name: 'Partido Ejemplo B' }),
        })
        .focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('status')).toHaveText(
        fill(en.admin.structure.moved, { name: 'Partido Ejemplo B' }),
      );
      await expect(list.getByRole('link')).toHaveText(['Partido Ejemplo B', 'Partido Ejemplo A']);
      await expect(
        page.getByRole('button', {
          name: fill(en.admin.structure.downLabel, { name: 'Partido Ejemplo B' }),
        }),
      ).toBeFocused();
      expect(
        await asOwner(
          `SELECT 1 FROM app.parties p JOIN app.elections e ON e.id = p.election_id
            WHERE e.tenant_id = $1 AND p.slug = 'partido-ejemplo-b' AND p.display_order = 1
              AND p.territory_codes = '{XE-AN}' AND p.colour IS NULL AND p.logo_file_id IS NULL`,
          [site.id],
        ),
      ).toBe(1);
      expect(
        await asOwner(
          `SELECT 1 FROM app.parties p JOIN app.elections e ON e.id = p.election_id
            WHERE e.tenant_id = $1 AND p.slug = 'partido-ejemplo-a' AND p.colour = '#1a6b3c'
              AND p.logo_file_id IS NOT NULL`,
          [site.id],
        ),
      ).toBe(1);

      // A logo for B (PLAN R142), on its page: chosen, saved with its details, then shown; the page stays.
      await list.getByRole('link', { name: 'Partido Ejemplo B' }).click();
      await expect(page.getByRole('heading', { level: 2 })).toContainText('Partido Ejemplo B');
      await page.locator('input[type="file"]').setInputFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: PARTY_LOGO_PNG,
      });
      await page.getByRole('button', { name: en.admin.settings.save }).click();
      await expect(
        page.getByRole('status').filter({ hasText: en.admin.settings.saved }),
      ).toBeVisible();
      // In the page's head, and in the form as the logo there is now.
      const logo = page
        .getByRole('img', { name: fill(en.admin.parties.logoAlt, { name: 'Partido Ejemplo B' }) })
        .first();
      await expect(logo).toBeVisible();
      await expect(logo).toHaveJSProperty('naturalWidth', 2);
      await expectAccessible(page);
      await page.goto(parties);

      await list.getByRole('link', { name: 'Partido Ejemplo A' }).click();
      await expect(page.getByRole('heading', { level: 2 })).toContainText('Partido Ejemplo A');
      await page.getByLabel(en.admin.parties.slugFact).fill('partido-ejemplo-b');
      await page.getByRole('button', { name: en.admin.settings.save }).click();
      // Said at the field, which takes focus.
      await expect(page.getByText(problems.slugTaken)).toBeVisible();
      await expect(page.getByLabel(en.admin.parties.slugFact)).toBeFocused();
      await page.getByRole('button', { name: en.admin.parties.delete }).click();
      await page
        .getByRole('alertdialog', { name: en.admin.parties.deleteTitle })
        .getByRole('button', { name: en.admin.parties.delete })
        .click();
      await expect(page).toHaveURL(parties);
      await expect(list.getByRole('link')).toHaveText(['Partido Ejemplo B']);

      const criteria = `${ADMIN_URL}/t/${site.slug}/e/elecciones-de-prueba/criteria`;
      await page.goto(criteria);
      await page.getByRole('link', { name: en.admin.criteria.add }).click();
      await nameField(page, en.admin.criteria.title).fill('Criterio de ejemplo 1');
      await nameField(page, en.admin.criteria.shortTitle).fill('Ejemplo 1');
      await nameField(page, en.admin.criteria.description).fill('Una descripción de ejemplo.');
      await page.getByLabel(en.admin.elections.form.slug).fill('criterio-de-ejemplo-1');
      await expectAccessible(page);
      await page.getByRole('button', { name: en.admin.settings.save }).click();
      await expect(page).toHaveURL(criteria);
      await expect(page.locator('#page-announcer')).toHaveText(en.admin.criteria.added);
      await expect(
        page.getByRole('list', { name: en.admin.election.criteria }).getByRole('link'),
      ).toHaveText(['Criterio de ejemplo 1']);
    });
  });

  test("pick territories from the country's subdivisions, by name, where ISO lists them (PLAN R201)", async ({
    page,
  }) => {
    // A site in a country ISO lists subdivisions of; what the test picks is read from the page, not named here.
    const country = 'ES';
    await asMemberOfOwnSite(
      page,
      'editor',
      async (site) => {
        // A regional election's territory, chosen from a list rather than typed, and still needed.
        await createElection(page, site, {
          slug: 'elecciones-regionales',
          name: 'Elecciones regionales de prueba',
          type: 'regional',
        });
        const territory = page.getByLabel(en.admin.elections.form.territory);
        await expect(territory.locator('option').first()).toHaveText(
          en.admin.form.territories.choose,
        );
        await page.getByRole('button', { name: en.admin.elections.form.create }).click();
        await expect(page.getByText(en.admin.elections.constraints.territoryNeeded)).toBeVisible();
        await expect(territory).toBeFocused();
        const suffix = (await territory.locator('option').nth(1).getAttribute('value')) ?? '';
        await territory.selectOption(suffix);
        await expectAccessible(page);
        await page.getByRole('button', { name: en.admin.elections.form.create }).click();
        await expect(page).toHaveURL(`${ADMIN_URL}/t/${site.slug}/e/elecciones-regionales`);
        await expect(page.getByLabel(en.admin.elections.form.territory)).toHaveValue(suffix);
        expect(
          await asOwner(
            'SELECT 1 FROM app.elections WHERE tenant_id = $1 AND territory_code = $2',
            [site.id, `${country}-${suffix}`],
          ),
        ).toBe(1);

        // A party's territories, ticked: those directly under the country, each with the ones inside it folded.
        const parties = `${ADMIN_URL}/t/${site.slug}/e/elecciones-regionales/parties`;
        await page.goto(`${parties}/new`);
        await nameField(page, en.admin.parties.name).fill('Partido Ejemplo A');
        await nameField(page, en.admin.parties.shortName).fill('PEA');
        const picker = page.getByRole('group', { name: en.admin.parties.territories });
        await expect(picker).toContainText(en.admin.form.territories.noneChosen);
        const labelOf = async (box: ReturnType<Page['locator']>) =>
          (await box.locator('xpath=following-sibling::label').textContent()) ?? '';
        const codeOf = (label: string) => /\(([A-Z]{2}-[A-Z0-9]{1,3})\)$/u.exec(label)?.[1] ?? '';
        const top = picker.getByRole('checkbox').first();
        const topLabel = await labelOf(top);
        await top.check();
        const group = picker.locator('details').first();
        await group.locator('summary').click();
        const inner = group.getByRole('checkbox').first();
        const innerLabel = await labelOf(inner);
        await inner.check();
        await expect(picker).toContainText(
          fill(en.admin.form.territories.chosen, { list: `${topLabel}, ${innerLabel}` }),
        );
        // Found by name, whatever its accents and case; Enter there finds rather than sends the form.
        const find = picker.getByLabel(en.admin.form.territories.find);
        await find.fill(
          innerLabel
            .replace(/ \(.*$/u, '')
            .normalize('NFD')
            .replace(/\p{M}/gu, '')
            .toUpperCase(),
        );
        await find.press('Enter');
        await expect(page).toHaveURL(`${parties}/new`);
        await expect(picker.getByRole('checkbox', { name: innerLabel, exact: true })).toBeChecked();
        await find.fill('ningún territorio de ejemplo');
        await expect(picker.getByText(en.admin.form.territories.noMatch)).toBeVisible();
        await find.fill('');
        await expectAccessible(page);
        await page.getByRole('button', { name: en.admin.parties.add }).click();
        await expect(page).toHaveURL(parties);
        expect(
          await asOwner(
            `SELECT 1 FROM app.parties p JOIN app.elections e ON e.id = p.election_id
              WHERE e.tenant_id = $1 AND p.territory_codes = $2::text[]`,
            [site.id, [codeOf(topLabel), codeOf(innerLabel)]],
          ),
        ).toBe(1);

        // Opened again: both ticked, the one inside its territory unfolded.
        await page.getByRole('link', { name: 'Partido Ejemplo A' }).click();
        const again = page.getByRole('group', { name: en.admin.parties.territories });
        await expect(again.getByRole('checkbox', { name: topLabel, exact: true })).toBeChecked();
        await expect(again.getByRole('checkbox', { name: innerLabel, exact: true })).toBeVisible();
        await expect(again.getByRole('checkbox', { name: innerLabel, exact: true })).toBeChecked();
        await expectAccessible(page);
      },
      country,
    );
  });

  test('show a live election read-only, its structure changing only through change requests', async ({
    page,
  }) => {
    const { id } = await signedInAccount(page, created);
    await addMembership(id, 'ejemplo-a', 'editor');
    await page.goto(`${ADMIN_URL}/t/ejemplo-a/elections`);
    const live = page.getByRole('row').filter({ hasText: en.admin.elections.statuses.live });
    await live.getByRole('link').click();
    await expect(page.getByText(en.admin.election.liveNotice)).toBeVisible();
    await expect(page.getByRole('button', { name: en.admin.election.saveDetails })).toHaveCount(0);
    await page
      .getByRole('navigation', { name: en.admin.election.nav })
      .getByRole('link', { name: en.admin.election.parties })
      .click();
    await expect(
      page.getByRole('list', { name: en.admin.election.parties }).getByRole('link'),
    ).toHaveCount(2);
    await expect(page.getByRole('link', { name: en.admin.parties.add })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Move / })).toHaveCount(0);
    await expectAccessible(page);
  });

  test.describe('in Spanish', () => {
    test.use({ locale: 'es-ES' });

    test('speak Spanish', async ({ page }) => {
      await asMemberOfOwnSite(page, 'editor', async (site) => {
        await page.goto(`${ADMIN_URL}/t/${site.slug}/elections/new`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(es.admin.elections.new);
        await expect(page.getByLabel(es.admin.elections.form.slug)).toBeVisible();
        await expect(
          page.getByRole('tablist', { name: es.admin.elections.form.name }).getByRole('tab'),
        ).toHaveText([`Español (${es.admin.localized.needed})`, 'Inglés']);
        await expectAccessible(page);
      });
    });
  });
});
