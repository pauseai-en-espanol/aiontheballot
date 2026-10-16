import { messages } from '@aiontheballot/i18n/messages';

import { addMembership, createTenant, deleteAccounts, purgeTenant } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { ADMIN_URL } from '../servers.js';
import { expect, test } from '../test.js';

const en = messages.en;
const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

test.describe("a member's tokens for tools (ADR-0008, PLAN R203)", () => {
  test('are created, shown once, used by a tool within their routes, and revoked', async ({
    page,
    request,
  }) => {
    const member = await signedInAccount(page, created, 'Persona con herramienta de ejemplo');
    const site = await createTenant();
    try {
      await addMembership(member.id, site.slug, 'editor');
      await page.goto(`${ADMIN_URL}/t/${site.slug}`);
      await page.getByRole('link', { name: en.admin.tokens.navLink }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: en.admin.tokens.title }),
      ).toBeVisible();
      await expect(page.getByText(en.admin.tokens.none)).toBeVisible();
      await expectAccessible(page);

      await page.getByLabel(en.admin.tokens.name).fill('Asistente de ejemplo en el portátil');
      await page.getByRole('button', { name: en.admin.tokens.submit }).click();
      await expect(page.getByText(en.admin.tokens.created)).toBeVisible();
      const token = await page.getByLabel(en.admin.tokens.yours).inputValue();
      expect(token).toMatch(/^aiontheballot_/);

      // A tool's request: the token alone, no cookie.
      const asTool = (path: string) =>
        request.get(`${ADMIN_URL}${path}`, { headers: { authorization: `Bearer ${token}` } });
      expect((await asTool(`/api/t/${site.slug}/elections`)).status()).toBe(200);
      const members = await asTool(`/api/t/${site.slug}/members`);
      expect([members.status(), await members.json()]).toEqual([403, { error: 'notForTokens' }]);

      // Listed, never shown again once the page reloads.
      await page.reload();
      await expect(page.getByLabel(en.admin.tokens.yours)).toHaveCount(0);
      const row = page.getByRole('row').filter({
        has: page.getByRole('rowheader', { name: 'Asistente de ejemplo en el portátil' }),
      });
      await expect(row.getByRole('cell', { name: en.admin.tokens.status.active })).toBeVisible();

      await row
        .getByRole('button', {
          name: fill(en.admin.tokens.revoke.label, { name: 'Asistente de ejemplo en el portátil' }),
        })
        .click();
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: en.admin.tokens.revoke.confirm })
        .click();
      await expect(row.getByRole('cell', { name: en.admin.tokens.status.revoked })).toBeVisible();
      expect((await asTool(`/api/t/${site.slug}/elections`)).status()).toBe(401);
    } finally {
      await purgeTenant(site.id);
    }
  });
});
