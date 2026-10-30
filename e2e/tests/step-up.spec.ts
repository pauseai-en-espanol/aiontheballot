import type { Page } from '@playwright/test';

import { messages } from '@aiontheballot/i18n/messages';

import { addMembership, asOwner, createTenant, deleteAccounts, purgeTenant } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { ADMIN_URL } from '../servers.js';
import { expect, test } from '../test.js';
import { totpCode } from '../totp.js';

const en = messages.en;

const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

/** The account signed in 13 hours ago: its second factor is no longer recent (PLAN D23). */
const signedInLongAgo = (userId: string) =>
  asOwner(
    `UPDATE auth.sessions SET created_at = now() - interval '13 hours', expires_at = now() + interval '1 hour'
      WHERE user_id = $1`,
    [userId],
  );

/** A device whose passkey store checks who holds it: Chromium's virtual authenticator (as passkeys.spec.ts). */
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

const confirmPage = (next: string) =>
  `${ADMIN_URL}/confirm?${new URLSearchParams({ next }).toString()}`;

test.describe("confirming it's you again (PLAN D23)", () => {
  test('a country admin signed in long ago confirms with a code before the audit log, and lands back on it', async ({
    page,
  }) => {
    const member = await signedInAccount(page, created, 'Persona que confirma de ejemplo');
    const site = await createTenant();
    try {
      await addMembership(member.id, site.slug, 'country_admin');
      await signedInLongAgo(member.id);

      // Everyday pages don't ask.
      await page.goto(`${ADMIN_URL}/t/${site.slug}`);
      await expect(page).toHaveURL(`${ADMIN_URL}/t/${site.slug}`);

      await page.goto(`${ADMIN_URL}/t/${site.slug}/audit`);
      await expect(page).toHaveURL(confirmPage(`/t/${site.slug}/audit`));
      await expect(
        page.getByRole('heading', { level: 1, name: en.auth.stepUp.title }),
      ).toBeVisible();
      await expectAccessible(page);
      await page.getByLabel(en.auth.challenge.code, { exact: true }).fill(totpCode(member.secret));
      await page.getByRole('button', { name: en.auth.stepUp.submit }).click();
      await expect(page).toHaveURL(`${ADMIN_URL}/t/${site.slug}/audit`);
      await expect(
        page.getByRole('heading', { level: 1, name: en.admin.audit.title }),
      ).toBeVisible();
    } finally {
      await purgeTenant(site.id);
    }
  });

  test('minting a token asks to confirm, a passkey confirms it, and the page is there to try again', async ({
    page,
  }) => {
    const member = await signedInAccount(page, created, 'Persona con llave que confirma');
    await withPasskeyDevice(page);
    // Added while the sign-in is fresh.
    await page.goto(`${ADMIN_URL}/passkeys`);
    await page.getByLabel(en.admin.passkeys.name).fill('Portátil');
    await page.getByRole('button', { name: en.admin.passkeys.submit }).click();
    await expect(page.getByText(en.admin.passkeys.added)).toBeVisible();
    await signedInLongAgo(member.id);

    await page.goto(`${ADMIN_URL}/tokens`);
    await page.getByLabel(en.admin.tokens.name).fill('Asistente de ejemplo');
    await page.getByRole('button', { name: en.admin.tokens.submit }).click();
    await expect(page).toHaveURL(confirmPage('/tokens'));
    await page.getByRole('button', { name: en.auth.signIn.passkey }).click();
    await expect(page).toHaveURL(`${ADMIN_URL}/tokens`);

    await page.getByLabel(en.admin.tokens.name).fill('Asistente de ejemplo');
    await page.getByRole('button', { name: en.admin.tokens.submit }).click();
    await expect(page.getByText(en.admin.tokens.created)).toBeVisible();
  });
});
