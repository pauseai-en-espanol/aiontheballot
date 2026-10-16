import { messages } from '@aiontheballot/i18n/messages';
import { type Page } from '@playwright/test';

import {
  addMembership,
  createAccount,
  createTenant,
  deleteAccounts,
  PASSWORD,
  purgeTenant,
  visitorAddress,
} from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { mailFor } from '../mail.js';
import { ADMIN_URL, PLATFORM_NAME } from '../servers.js';
import { expect, test } from '../test.js';
import { totpCode } from '../totp.js';

const en = messages.en;
const es = messages.es;
const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

/** The link to choose a password in the last email `address` received with `subject`, on the test's admin host. */
const linkIn = async (address: string, subject: string) => {
  let link = '';
  await expect
    .poll(async () => {
      const mail = (await mailFor(address)).filter((m) => m.headers.subject === subject).at(-1);
      link = /https?:\/\/\S+\/set-password#token=[\w%-]+/u.exec(mail?.text ?? '')?.[0] ?? '';
      return link;
    })
    .not.toBe('');
  return link.replace(/^https?:\/\/[^/]+/u, ADMIN_URL);
};

/** The form's own alert: Next's route announcer is an alert too. */
const formAlert = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

test.describe('password recovery (editorial workflow A5, PLAN R170)', () => {
  test('"I forgot my password" emails a link that sets a new one; the second factor is still asked, every session ends, and the account is told', async ({
    page,
    newContext,
  }) => {
    const account = await signedInAccount(page, created);
    await page.goto(ADMIN_URL);
    await expect(page).toHaveURL(`${ADMIN_URL}/`);

    // Someone signed out, in a browser of their own, on the sign-in page.
    const theirs = await newContext({
      extraHTTPHeaders: { 'x-e2e-client-address': visitorAddress() },
    });
    const them = await theirs.newPage();
    await them.goto(`${ADMIN_URL}/sign-in`);
    await them.getByRole('link', { name: en.auth.signIn.forgot }).click();
    await expect(them).toHaveURL(`${ADMIN_URL}/forgot-password`);
    await expect(them.getByRole('heading', { level: 1 })).toHaveText(en.auth.forgot.title);
    await expect(them.getByText(en.auth.forgot.lostAuthenticator)).toBeVisible();
    await expectAccessible(them);
    await them.getByLabel(en.auth.forgot.email).fill(account.email);
    await them.getByRole('button', { name: en.auth.forgot.submit }).click();
    await expect(them.getByRole('heading', { level: 2 })).toHaveText(en.auth.forgot.sentTitle);
    await expect(them.getByRole('heading', { level: 2 })).toBeFocused();
    await expect(them.getByText(fill(en.auth.forgot.sent, { email: account.email }))).toBeVisible();
    await expectAccessible(them);

    const subject = fill(en.email.passwordReset.subject, { platform: PLATFORM_NAME });
    const link = await linkIn(account.email, subject);
    // The token is in the fragment, and the page takes it out of the address bar.
    await them.goto(link);
    await expect.poll(() => them.url()).toBe(`${ADMIN_URL}/set-password`);
    const newPassword = 'otra contraseña de ejemplo nueva';
    await them.getByLabel(en.auth.setPassword.password, { exact: true }).fill(newPassword);
    await them.getByLabel(en.auth.setPassword.confirm).fill(newPassword);
    await them.getByRole('button', { name: en.auth.setPassword.submit }).click();
    await expect(them.getByRole('heading', { level: 2 })).toHaveText(en.auth.setPassword.doneTitle);

    // The session that was open ended.
    await page.reload();
    await expect(page).toHaveURL(`${ADMIN_URL}/sign-in`);
    // The old password no longer works; the new one leads to the code, not past it.
    await page.getByLabel(en.auth.signIn.email).fill(account.email);
    await page.getByLabel(en.auth.signIn.password, { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: en.auth.signIn.submit }).click();
    await expect(formAlert(page)).toContainText(en.auth.errors.invalidCredentials);
    await page.getByLabel(en.auth.signIn.password, { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: en.auth.signIn.submit }).click();
    await expect(page).toHaveURL(`${ADMIN_URL}/two-factor`);
    await page.getByLabel(en.auth.challenge.code).fill(totpCode(account.secret));
    await page.getByRole('button', { name: en.auth.challenge.submit }).click();
    await expect(page).toHaveURL(`${ADMIN_URL}/`);

    // The account was told.
    const changed = fill(en.email.passwordChanged.subject, { platform: PLATFORM_NAME });
    await expect
      .poll(async () => (await mailFor(account.email)).some((m) => m.headers.subject === changed))
      .toBe(true);
    // The link worked once.
    await them.goto(link);
    await them.getByLabel(en.auth.setPassword.password, { exact: true }).fill(newPassword);
    await them.getByLabel(en.auth.setPassword.confirm).fill(newPassword);
    await them.getByRole('button', { name: en.auth.setPassword.submit }).click();
    await expect(formAlert(them)).toContainText(en.auth.errors.invalidLink);
  });

  test('answers an address with no account as it answers one with, and sends it nothing', async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({ 'x-e2e-client-address': visitorAddress() });
    const nobody = `nadie-${crypto.randomUUID()}@example.org`;
    await page.goto(`${ADMIN_URL}/forgot-password`);
    await page.getByLabel(en.auth.forgot.email).fill(nobody);
    await page.getByRole('button', { name: en.auth.forgot.submit }).click();
    await expect(page.getByText(fill(en.auth.forgot.sent, { email: nobody }))).toBeVisible();
    await page.waitForTimeout(1000);
    expect(await mailFor(nobody)).toEqual([]);
  });

  test("sends a member a reset email from the members page, in the site's language, naming who sent it", async ({
    page,
    newContext,
  }) => {
    const site = await createTenant();
    try {
      const manager = await signedInAccount(page, created, 'Persona administradora');
      await addMembership(manager.id, site.slug, 'country_admin');
      // A member with a second factor: an account without one gets no link (PLAN R170).
      const memberPage = await (await newContext()).newPage();
      const member = await signedInAccount(memberPage, created, 'Persona revisora');
      await addMembership(member.id, site.slug, 'reviewer');
      const unenrolled = await createAccount('Persona sin verificación');
      created.push(unenrolled.id);
      await addMembership(unenrolled.id, site.slug, 'editor');

      await page.goto(`${ADMIN_URL}/t/${site.slug}/members`);
      const send = page.getByRole('button', {
        name: fill(en.admin.members.resetLabel, { name: 'Persona revisora' }),
      });
      await send.click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toContainText(
        fill(en.admin.members.resetBody, { name: 'Persona revisora' }),
      );
      await expectAccessible(page);
      const [answer] = await Promise.all([
        page.waitForResponse((response) => response.url().endsWith('/password-reset')),
        dialog.getByRole('button', { name: en.admin.members.resetConfirm }).click(),
      ]);
      await expect(
        page.getByRole('status').filter({
          hasText: fill(en.admin.members.resetSent, { name: 'Persona revisora' }),
        }),
      ).toBeVisible();
      // The manager's page never sees the link: the answer has no content.
      expect(answer.status()).toBe(204);

      const subject = fill(es.email.passwordReset.subject, { platform: PLATFORM_NAME });
      await linkIn(member.email, subject);
      const [mail] = (await mailFor(member.email)).filter((m) => m.headers.subject === subject);
      expect(mail?.text).toContain('Persona administradora');
      expect(mail?.text).toContain(`Sitio de prueba ${site.slug}`);

      // Another within 15 minutes is refused, and said so.
      await send.click();
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: en.admin.members.resetConfirm })
        .click();
      await expect(page.getByText(en.errors.tooSoon)).toBeVisible();
      expect(
        (await mailFor(member.email)).filter((m) => m.headers.subject === subject),
      ).toHaveLength(1);

      // An account still to enrol gets none, and the manager is told why.
      await page
        .getByRole('button', {
          name: fill(en.admin.members.resetLabel, { name: 'Persona sin verificación' }),
        })
        .click();
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: en.admin.members.resetConfirm })
        .click();
      await expect(page.getByText(en.errors.notEnrolled)).toBeVisible();
      expect(await mailFor(unenrolled.email)).toEqual([]);
    } finally {
      await purgeTenant(site.id);
    }
  });

  test('offers no reset email to someone who does not manage the members', async ({ page }) => {
    const site = await createTenant();
    try {
      const editor = await signedInAccount(page, created, 'Persona editora');
      await addMembership(editor.id, site.slug, 'editor');
      await page.goto(`${ADMIN_URL}/t/${site.slug}/members`);
      await expect(page.getByRole('row', { name: /Persona editora/u })).toBeVisible();
      await expect(page.getByRole('button', { name: en.admin.members.resetPassword })).toHaveCount(
        0,
      );
    } finally {
      await purgeTenant(site.id);
    }
  });
});
