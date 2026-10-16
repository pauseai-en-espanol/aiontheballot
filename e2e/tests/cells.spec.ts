import { messages } from '@aiontheballot/i18n/messages';

import { addMembership, deleteAccounts } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { ADMIN_URL } from '../servers.js';
import { expect, test } from '../test.js';

const en = messages.en;
const cells = en.admin.cells;
const GRID = `${ADMIN_URL}/t/ejemplo-a/e/generales-de-ejemplo/cells`;

const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

test.describe('cells (editorial workflow §8)', () => {
  test("show the election's grid, every state in words", async ({ page }) => {
    const { id } = await signedInAccount(page, created, 'Persona editora de celdas');
    await addMembership(id, 'ejemplo-a', 'editor');
    await page.goto(GRID);
    await expect(page.getByRole('heading', { level: 2, name: cells.title })).toBeVisible();
    const row = page.getByRole('row', { name: /Partido Ejemplo A/ });
    // Each link names its party and criterion too, for a list of links.
    await expect(
      row.getByRole('link', {
        name: `PEA, Ejemplo 1: ${en.rating.meets} · ${cells.states.published}`,
      }),
    ).toBeVisible();
    await expect(
      row.getByRole('link', { name: `PEA, Ejemplo 2: ${en.cell.pending} · ${cells.states.draft}` }),
    ).toBeVisible();
    // Each rating as the public sees it: an icon beside its words, never colour alone (§2.5).
    const published = row.locator('[data-rating="meets"]');
    await expect(published).toContainText(en.rating.meets);
    await expect(published.locator('img[alt=""]')).toHaveCount(1);
    await expect(row.locator('[data-rating="pending"]').first()).toContainText(en.cell.pending);
    await expectAccessible(page);
  });

  // Both write quotes on the seeded draft cell: one after the other, or each would find the other's change.
  test.describe('quotes on the seeded draft', () => {
    test.describe.configure({ mode: 'default' });

    test('take a quote that the live match checks as it is typed, and give it back', async ({
      page,
    }) => {
      const { id } = await signedInAccount(page, created, 'Persona editora de citas');
      await addMembership(id, 'ejemplo-a', 'editor');
      await page.goto(GRID);
      await page
        .getByRole('row', { name: /Partido Ejemplo A/ })
        .getByRole('link', { name: `PEA, Ejemplo 2: ${en.cell.pending} · ${cells.states.draft}` })
        .click();
      await expect(page.getByRole('heading', { level: 3, name: cells.checked })).toBeVisible();
      await expectAccessible(page);

      await page.getByLabel(cells.quoteSource).selectOption({ label: 'Programa de ejemplo' });
      const quote = page.getByLabel(cells.quote);
      await quote.fill('propone una moratoria ficticia sobre los sistemas');
      await expect(page.locator('#quote-live')).toHaveText(
        cells.live.matched.replace('{location}', 'p. 1'),
      );
      await quote.fill('propone una moratoria inventada sobre los sistemas');
      await expect(page.locator('#quote-live')).toContainText(cells.live.unmatched);
      await quote.fill('propone una moratoria ficticia sobre los sistemas');
      await page.getByRole('button', { name: cells.add }).click();
      await expect(page.getByRole('status').filter({ hasText: cells.added })).toBeVisible();
      const added = page.getByRole('listitem').filter({
        hasText: 'propone una moratoria ficticia sobre los sistemas',
      });
      await expect(added).toContainText(cells.matched.replace('{location}', 'p. 1'));

      // Back as it was: other tests read this cell.
      await added.getByRole('button', { name: new RegExp(cells.removeQuote) }).click();
      // The page's own status line says so, since the quote and its button are gone.
      await expect(page.locator('#page-announcer')).toHaveText(cells.quoteRemoved);
      await expect(added).toHaveCount(0);
    });

    test("take a quote picked from the source's text, with its pages", async ({ page }) => {
      const { id } = await signedInAccount(page, created, 'Persona que elige citas');
      await addMembership(id, 'ejemplo-a', 'editor');
      await page.goto(GRID);
      await page
        .getByRole('row', { name: /Partido Ejemplo A/ })
        .getByRole('link', { name: `PEA, Ejemplo 2: ${en.cell.pending} · ${cells.states.draft}` })
        .click();
      await page.getByLabel(cells.quoteSource).selectOption({ label: 'Programa de ejemplo' });
      const text = page.getByRole('region', { name: cells.pick.title });
      await expect(text.getByText('p. 1', { exact: true })).toBeVisible();
      await expect(text).toContainText('También pide crear una agencia de supervisión de ejemplo');
      await expectAccessible(page);

      const use = page.getByRole('button', { name: cells.pick.button });
      await use.click();
      await expect(page.getByText(cells.pick.nothing)).toBeVisible();

      // A paragraph chosen as people do, by clicking it three times: only its page's text, never its label.
      await text.getByText(/^El Partido Ejemplo A propone/).click({ clickCount: 3 });
      await use.click();
      const quote = page.getByLabel(cells.quote);
      await expect(quote).toHaveValue(
        'El Partido Ejemplo A propone una moratoria ficticia sobre los sistemas de prueba más avanzados.',
      );
      await expect(page.getByLabel(cells.sectionLabel)).toHaveValue('p. 1');
      await expect(quote).toBeFocused();
      await expect(page.locator('#quote-live')).toHaveText(
        cells.live.matched.replace('{location}', 'p. 1'),
      );

      // A passage across two pages, joined as the match joins them.
      // An expression, not a function: this package's types have no DOM.
      await page.evaluate(`(() => {
        const [first, second] = [...document.querySelectorAll('[data-unit]')].map((unit) => unit.firstChild);
        const range = document.createRange();
        range.setStart(first, first.data.indexOf('sistemas de prueba'));
        range.setEnd(second, second.data.indexOf(' de supervisión'));
        document.getSelection().removeAllRanges();
        document.getSelection().addRange(range);
      })()`);
      await use.click();
      await expect(
        page.getByText(cells.pick.done.replace('{location}', 'p. 1–p. 2')),
      ).toBeVisible();
      await expect(quote).toHaveValue(
        'sistemas de prueba más avanzados. También pide crear una agencia',
      );
      await expect(page.getByLabel(cells.sectionLabel)).toHaveValue('p. 1–p. 2');
      await expect(page.locator('#quote-live')).toHaveText(
        cells.live.matched.replace('{location}', 'p. 1–p. 2'),
      );

      // The database matches it again on save, and the page keeps the hint.
      await page.getByRole('button', { name: cells.add }).click();
      await expect(page.getByRole('status').filter({ hasText: cells.added })).toBeVisible();
      const added = page.getByRole('listitem').filter({
        hasText: 'sistemas de prueba más avanzados. También pide crear una agencia',
      });
      await expect(added).toContainText(cells.matched.replace('{location}', 'p. 1–p. 2'));
      await expect(added).toContainText(cells.section.replace('{label}', 'p. 1–p. 2'));

      // Back as it was: other tests read this cell.
      await added.getByRole('button', { name: new RegExp(cells.removeQuote) }).click();
      await expect(page.locator('#page-announcer')).toHaveText(cells.quoteRemoved);
      await expect(added).toHaveCount(0);
    });

    test('keep what is typed in the draft while quotes come and go, and ask before leaving it (R190)', async ({
      page,
    }) => {
      const { id } = await signedInAccount(page, created, 'Persona editora a medias');
      await addMembership(id, 'ejemplo-a', 'editor');
      await page.goto(GRID);
      await page
        .getByRole('row', { name: /Partido Ejemplo A/ })
        .getByRole('link', { name: `PEA, Ejemplo 2: ${en.cell.pending} · ${cells.states.draft}` })
        .click();
      const bar = page.getByRole('region', { name: cells.bar.title });
      await expect(bar).toContainText(cells.bar.saved);
      const summary = page.getByLabel(`${cells.summary} (Spanish, ${en.admin.localized.needed})`);
      const original = await summary.inputValue();
      await summary.fill('Un resumen de prueba, todavía sin guardar.');
      await expect(bar).toContainText(cells.bar.unsaved);
      await expect(page.getByText(cells.bar.checklistUnsaved)).toBeVisible();

      // A quote added from this same page moves the cell's version: the summary keeps its text, with no warning that
      // someone else changed the cell (admin forms §2).
      await page.getByLabel(cells.quoteSource).selectOption({ label: 'Programa de ejemplo' });
      await page.getByLabel(cells.quote).fill('propone una moratoria ficticia sobre los sistemas');
      await page.getByRole('button', { name: cells.add }).click();
      await expect(page.getByRole('status').filter({ hasText: cells.added })).toBeVisible();
      const added = page.getByRole('listitem').filter({
        hasText: 'propone una moratoria ficticia sobre los sistemas',
      });
      await expect(added).toBeVisible();
      await added.getByRole('button', { name: new RegExp(cells.removeQuote) }).click();
      await expect(added).toHaveCount(0);
      await expect(summary).toHaveValue('Un resumen de prueba, todavía sin guardar.');
      await expect(page.getByText(cells.stale)).toHaveCount(0);
      await expectAccessible(page);

      // Leaving by a link asks first; staying keeps it all.
      let asked = '';
      page.once('dialog', (dialog) => {
        asked = dialog.message();
        void dialog.dismiss();
      });
      await page
        .getByRole('navigation', { name: en.admin.shell.nav })
        .getByRole('link', { name: en.admin.shell.elections })
        .click();
      await expect.poll(() => asked).toBe(cells.bar.leave);
      await expect(page).toHaveURL(/\/cells\//u);
      await expect(summary).toHaveValue('Un resumen de prueba, todavía sin guardar.');

      // Nothing was saved: leaving, once agreed, leaves the cell as it was for the other tests.
      page.once('dialog', (dialog) => void dialog.accept());
      await page
        .getByRole('navigation', { name: en.admin.shell.nav })
        .getByRole('link', { name: en.admin.shell.elections })
        .click();
      await expect(page).not.toHaveURL(/\/cells\//u);
      await page.goBack();
      await expect(summary).toHaveValue(original);
    });
  });

  test('are started by an editor, and deleted again while never published', async ({ page }) => {
    const { id } = await signedInAccount(page, created, 'Persona editora nueva');
    await addMembership(id, 'ejemplo-a', 'editor');
    await page.goto(GRID);
    await page
      .getByRole('row', { name: /Partido Ejemplo B/ })
      .getByRole('link', { name: `PEB, Ejemplo 2: ${en.cell.pending} · ${cells.states.none}` })
      .click();
    await expect(page.getByText(cells.notStarted)).toBeVisible();
    await page.getByRole('button', { name: cells.create }).click();
    await expect(page.getByRole('button', { name: cells.save })).toBeVisible();
    // Sending it for review saves what is typed first (R190); the database then refuses a draft with no rating or
    // quote, and the bar says so.
    const bar = page.getByRole('region', { name: cells.bar.title });
    const summary = page.getByLabel(`${cells.summary} (Spanish, ${en.admin.localized.needed})`);
    await summary.fill('Un resumen de prueba.');
    await expect(bar).toContainText(cells.bar.unsaved);
    await bar.getByRole('button', { name: cells.submit }).click();
    await expect(bar).toContainText(cells.bar.saved);
    await expect(bar.getByRole('alert')).toContainText(en.errors.incomplete);
    await page.reload();
    await expect(summary).toHaveValue('Un resumen de prueba.');
    // What submitting needs, as the database will check it (C5.2): all of it missing so far, said in words.
    const needs = page.getByRole('region', { name: cells.checklist.title });
    for (const need of [cells.checklist.rating, cells.checklist.quote]) {
      await expect(needs.getByRole('listitem').filter({ hasText: need })).toContainText(
        `${cells.checklist.missing}:`,
      );
    }
    // B has no source to cite yet: the screen says so rather than offering a form that can't succeed.
    await expect(page.getByText(cells.noCitable)).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: cells.delete }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: cells.delete }).click();
    await expect(page).toHaveURL(GRID);
  });

  test('open a published one behind a step that says a change goes through review again (PLAN R197)', async ({
    page,
  }) => {
    const { id } = await signedInAccount(page, created, 'Persona que corrige');
    await addMembership(id, 'ejemplo-a', 'editor');
    await page.goto(GRID);
    await page
      .getByRole('row', { name: /Partido Ejemplo A/ })
      .getByRole('link', { name: `PEA, Ejemplo 1: ${en.rating.meets} · ${cells.states.published}` })
      .click();
    await expect(page.getByText(cells.startChange.notice)).toBeVisible();
    // Nothing reads as a form to fill in until it is asked for.
    await expect(page.getByRole('button', { name: cells.save })).toHaveCount(0);
    await expectAccessible(page);
    await page.getByRole('button', { name: cells.startChange.button }).click();
    await expect(page.getByRole('button', { name: cells.save })).toBeVisible();
    await expect(page.getByRole('radio').first()).toBeFocused();
  });

  test('are a 404 for anyone outside the site', async ({ page }) => {
    await signedInAccount(page, created, 'Persona sin sitio');
    const response = await page.goto(GRID);
    expect(response?.status()).toBe(404);
  });
});
