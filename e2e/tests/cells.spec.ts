import { messages } from '@aiontheballot/i18n/messages';
import { expect, test } from '@playwright/test';

import { addMembership, deleteAccounts } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { ADMIN_URL } from '../servers.js';

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
        name: `PEA, Ejemplo 1: ${cells.states.published} · ${en.rating.meets}`,
      }),
    ).toBeVisible();
    await expect(
      row.getByRole('link', { name: `PEA, Ejemplo 2: ${cells.states.draft}` }),
    ).toBeVisible();
    await expectAccessible(page);
  });

  test('take a quote that the live match checks as it is typed, and give it back', async ({
    page,
  }) => {
    const { id } = await signedInAccount(page, created, 'Persona editora de citas');
    await addMembership(id, 'ejemplo-a', 'editor');
    await page.goto(GRID);
    await page
      .getByRole('row', { name: /Partido Ejemplo A/ })
      .getByRole('link', { name: `PEA, Ejemplo 2: ${cells.states.draft}` })
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

  test('are started by an editor, and deleted again while never published', async ({ page }) => {
    const { id } = await signedInAccount(page, created, 'Persona editora nueva');
    await addMembership(id, 'ejemplo-a', 'editor');
    await page.goto(GRID);
    await page
      .getByRole('row', { name: /Partido Ejemplo B/ })
      .getByRole('link', { name: `PEB, Ejemplo 2: ${cells.states.none}` })
      .click();
    await expect(page.getByText(cells.notStarted)).toBeVisible();
    await page.getByRole('button', { name: cells.create }).click();
    await expect(page.getByRole('button', { name: cells.save })).toBeVisible();
    // B has no source to cite yet: the screen says so rather than offering a form that can't succeed.
    await expect(page.getByText(cells.noCitable)).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: cells.delete }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: cells.delete }).click();
    await expect(page).toHaveURL(GRID);
  });

  test('are a 404 for anyone outside the site', async ({ page }) => {
    await signedInAccount(page, created, 'Persona sin sitio');
    const response = await page.goto(GRID);
    expect(response?.status()).toBe(404);
  });
});
