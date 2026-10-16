import { messages } from '@aiontheballot/i18n/messages';

import { addMembership, deleteAccounts } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { ADMIN_URL } from '../servers.js';
import { expect, test } from '../test.js';

const en = messages.en;
const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

test.describe('the records (editorial workflow H1, H3; PLAN R150)', () => {
  test("a country admin reads the site's audit log, filtered; an editor finds no such page", async ({
    browser,
  }) => {
    const admin = await (await browser.newContext()).newPage();
    const { id } = await signedInAccount(admin, created);
    await addMembership(id, 'ejemplo-a', 'country_admin');
    await admin.goto(`${ADMIN_URL}/t/ejemplo-a`);
    await admin.getByRole('link', { name: en.admin.shell.audit }).click();
    await expect(admin.getByRole('heading', { level: 1 })).toHaveText(en.admin.audit.title);
    // Each entry, not the changed columns listed inside it.
    const entries = admin.getByRole('main').locator('ol > li');
    await expect(entries.first()).toBeVisible();
    await expectAccessible(admin);
    // On a phone, long row ids and values wrap rather than push the page sideways (admin forms §2, WCAG 1.4.10).
    await admin.setViewportSize({ width: 390, height: 844 });
    expect(
      await admin.evaluate(
        'document.documentElement.scrollWidth > document.documentElement.clientWidth',
      ),
    ).toBe(false);
    await admin.setViewportSize({ width: 1280, height: 720 });
    // One table's entries only.
    await admin.getByLabel(en.admin.audit.table).selectOption('elections');
    await admin.getByRole('button', { name: en.admin.audit.apply }).click();
    await expect(admin).toHaveURL(/table=elections/);
    for (const text of await entries.allTextContents()) {
      expect(text).toContain('elections');
    }

    const editor = await (await browser.newContext()).newPage();
    const { id: editorId } = await signedInAccount(editor, created);
    await addMembership(editorId, 'ejemplo-a', 'editor');
    await editor.goto(`${ADMIN_URL}/t/ejemplo-a`);
    await expect(editor.getByRole('link', { name: en.admin.shell.audit })).toHaveCount(0);
    const answer = await editor.goto(`${ADMIN_URL}/t/ejemplo-a/audit`);
    expect(answer?.status()).toBe(404);
  });

  test("every member reads the election's corrections log, as the public will see it", async ({
    page,
  }) => {
    const { id } = await signedInAccount(page, created);
    await addMembership(id, 'ejemplo-a', 'reviewer');
    await page.goto(`${ADMIN_URL}/t/ejemplo-a/e/generales-de-ejemplo`);
    await page.getByRole('link', { name: en.admin.election.corrections }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: en.correctionsPage.title }),
    ).toBeVisible();
    await expect(page.getByText(en.correctionsPage.empty)).toBeVisible();
  });
});
