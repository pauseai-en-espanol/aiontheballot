import { messages } from '@aiontheballot/i18n/messages';
import { expect, test } from '@playwright/test';

import { addMembership, deleteAccounts } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { ADMIN_URL, API_URL } from '../servers.js';

const en = messages.en.admin.parties.programme;

const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

test.describe("a party's programme status (editorial workflow PS1)", () => {
  test('an editor records a check in a live election, and the public sees its date', async ({
    page,
  }) => {
    const { id } = await signedInAccount(page, created, 'Persona editora de programas');
    await addMembership(id, 'ejemplo-a', 'editor');
    await page.goto(`${ADMIN_URL}/t/ejemplo-a/e/generales-de-ejemplo/parties`);
    await page.getByRole('link', { name: 'Partido Ejemplo B' }).click();
    // B has no source marked as its programme: "published" says why, and sends nothing.
    const publish = page.getByRole('button', { name: en.checkPublished });
    await expect(publish).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText(en.needsSource)).toBeVisible();
    await expectAccessible(page);

    await page.goto(`${ADMIN_URL}/t/ejemplo-a/e/generales-de-ejemplo/parties`);
    await page.getByRole('link', { name: 'Partido Ejemplo A' }).click();
    await page.getByRole('button', { name: en.checkPending }).click();
    await expect(page.getByRole('status')).toHaveText(en.saved);
    await expect(page.getByText(/Last checked on/)).toBeVisible();

    // The public data says the programme isn't out yet, and when it was last checked: what the party's page shows
    // ("Programa aún no publicado (comprobado el …)") once the web app's copy, kept up to a minute, refreshes.
    const response = await page.request.get(
      `${API_URL}/public/tenants/ejemplo-a/elections/generales-de-ejemplo`,
    );
    const { parties } = (await response.json()) as {
      parties: { slug: string; programmeStatus: string; programmeCheckedAt: string | null }[];
    };
    const party = parties.find((p) => p.slug === 'partido-ejemplo-a');
    expect(party?.programmeStatus).toBe('pending');
    expect(Date.now() - Date.parse(party?.programmeCheckedAt ?? '')).toBeLessThan(60_000);
  });
});
