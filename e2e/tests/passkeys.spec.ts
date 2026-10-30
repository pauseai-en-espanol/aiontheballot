import type { Page } from '@playwright/test';

import { messages } from '@aiontheballot/i18n/messages';

import { deleteAccounts } from '../accounts.js';
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

/**
 * A device with a passkey store that checks who holds it, as a phone's fingerprint or a laptop's Touch ID would:
 * Chromium's virtual authenticator, which answers every prompt at once.
 */
const withPasskeyDevice = async (page: Page) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
};

/** From the admin's home, where the button is: the passkeys page, like the tokens one, has only a link back. */
const signOut = async (page: Page) => {
  await page.goto(ADMIN_URL);
  await page.getByRole('button', { name: en.auth.home.signOut }).click();
  await expect(page).toHaveURL(`${ADMIN_URL}/sign-in`);
};

test('a member adds a passkey, signs in with it alone, and removes it (PLAN D22)', async ({
  page,
}) => {
  await signedInAccount(page, created, 'Persona con llave de ejemplo');
  await withPasskeyDevice(page);

  await page.goto(ADMIN_URL);
  await page.getByRole('link', { name: en.admin.passkeys.navLink }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: en.admin.passkeys.title }),
  ).toBeVisible();
  await expect(page.getByText(en.admin.passkeys.none)).toBeVisible();
  await page.getByLabel(en.admin.passkeys.name).fill('Portátil');
  await page.getByRole('button', { name: en.admin.passkeys.submit }).click();
  await expect(page.getByText(en.admin.passkeys.added)).toBeVisible();
  const row = page.getByRole('row').filter({
    has: page.getByRole('rowheader', { name: 'Portátil' }),
  });
  await expect(row).toBeVisible();
  await expectAccessible(page);

  // Signed out, the passkey alone signs in: no email, password or code.
  await signOut(page);
  await expectAccessible(page);
  await page.getByRole('button', { name: en.auth.signIn.passkey }).click();
  await expect(page).toHaveURL(`${ADMIN_URL}/`);
  await expect(page.getByRole('heading', { level: 1, name: en.auth.home.title })).toBeVisible();

  // Removed, it signs everyone out, opens nothing, and the page says so in words.
  await page.getByRole('link', { name: en.admin.passkeys.navLink }).click();
  await row
    .getByRole('button', { name: fill(en.admin.passkeys.remove.label, { name: 'Portátil' }) })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: en.admin.passkeys.remove.confirm })
    .click();
  await expect(page).toHaveURL(`${ADMIN_URL}/sign-in`);
  await page.goto(`${ADMIN_URL}/passkeys`);
  await expect(page).toHaveURL(`${ADMIN_URL}/sign-in`);
  await page.getByRole('button', { name: en.auth.signIn.passkey }).click();
  await expect(page.locator('#passkey-error')).toContainText(en.auth.errors.passkeyUnknown);
  await expect(page).toHaveURL(`${ADMIN_URL}/sign-in`);
});
