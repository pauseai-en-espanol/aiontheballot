import { messages } from '@aiontheballot/i18n/messages';
import pg from 'pg';

import { addMembership, createTenant, deleteAccounts, purgeTenant } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { mailFor } from '../mail.js';
import { ADMIN_URL } from '../servers.js';
import { expect, test } from '../test.js';

const en = messages.en;
const invitations = en.admin.invitations;
const accept = en.auth.invitation;

const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

/** The id of the account an invitation made, to delete it afterwards. */
const accountId = async (email: string) => {
  const client = new pg.Client({ connectionString: process.env.AUTH_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      'SELECT id FROM auth.users WHERE email = $1',
      [email],
    );
    return rows[0]?.id;
  } finally {
    await client.end();
  }
};

test.describe('invitations (editorial workflow A2, A3; PLAN R114)', () => {
  test('go out by email, and make the account and the membership when followed', async ({
    page,
    newContext,
  }) => {
    const site = await createTenant({ operator: true });
    const invited = `invitada-${crypto.randomUUID()}@example.org`;
    try {
      const { id } = await signedInAccount(page, created, 'Persona administradora');
      await addMembership(id, site.slug, 'country_admin');
      await page.goto(`${ADMIN_URL}/t/${site.slug}/members`);
      await page.getByLabel(invitations.email, { exact: true }).fill(invited);
      // Editing is chosen to start with, never the most powerful role (admin forms §2).
      const roles = page.getByRole('group', { name: invitations.role });
      await expect(roles.getByRole('radio', { name: en.admin.roles.editor })).toBeChecked();
      await expect(
        roles.getByRole('radio', { name: en.admin.roles.country_admin }),
      ).not.toBeChecked();
      await roles.getByRole('radio', { name: en.admin.roles.reviewer }).check();
      await page.getByRole('button', { name: invitations.send }).click();
      await expect(page.getByRole('status').filter({ hasText: invitations.sent })).toBeVisible();
      await expect(
        page
          .getByRole('table', { name: invitations.caption })
          .getByRole('row', { name: new RegExp(invited) }),
      ).toContainText(invitations.states.pending);
      await expectAccessible(page);
      // On a phone, the table fits: role, state and expiry go under the address (admin forms §2, WCAG 1.4.10).
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(
          'document.documentElement.scrollWidth > document.documentElement.clientWidth',
        ),
      ).toBe(false);
      await expect(
        page
          .getByRole('table', { name: invitations.caption })
          .getByRole('rowheader', { name: new RegExp(invited) }),
      ).toContainText(`${en.admin.roles.reviewer} · ${invitations.states.pending}`);
      await page.setViewportSize({ width: 1280, height: 720 });

      await expect.poll(async () => (await mailFor(invited)).length).toBe(1);
      const [mail] = await mailFor(invited);
      const link = /https?:\/\/\S+\/invitation#token=[\w%-]+/u.exec(mail?.text ?? '')?.[0];
      expect(link).toBeDefined();

      // The invited person, in a browser of their own, signed in nowhere.
      const theirs = await newContext();
      const them = await theirs.newPage();
      await them.goto((link ?? '').replace(/^https?:\/\/[^/]+/u, ADMIN_URL));
      await expect(them.getByText(invited)).toBeVisible();
      // It names the site it invites to, in the page's language when the site has a name in it (PLAN R199).
      await expect(them.getByText(`Test site ${site.slug}`, { exact: true })).toBeVisible();
      // The token left the address bar.
      expect(new URL(them.url()).hash).toBe('');
      await expectAccessible(them);
      await them.getByLabel(accept.name).fill('Persona invitada');
      await them
        .getByLabel(accept.password, { exact: true })
        .fill('una contraseña de ejemplo nueva');
      await them.getByLabel(accept.confirm).fill('una contraseña de ejemplo nueva');
      await them.getByRole('button', { name: accept.create }).click();
      await expect(them.getByRole('heading', { level: 2 })).toHaveText(accept.created);
      await expect(them.getByRole('heading', { level: 2 })).toBeFocused();
      await theirs.close();
      const newId = await accountId(invited);
      expect(newId).toBeDefined();
      created.push(newId ?? '');

      await page.reload();
      await expect(
        page
          .getByRole('table', { name: invitations.caption })
          .getByRole('row', { name: new RegExp(invited) }),
      ).toContainText(invitations.states.accepted);
    } finally {
      await purgeTenant(site.id, site.operatorId);
    }
  });

  test('answer a made-up or spent link with one message, saying nothing about it', async ({
    page,
  }) => {
    await page.goto(`${ADMIN_URL}/invitation#token=un-token-inventado`);
    await expect(page.getByText(accept.invalid)).toBeVisible();
    await page.goto(`${ADMIN_URL}/invitation`);
    await expect(page.getByText(accept.missing)).toBeVisible();
  });
});
