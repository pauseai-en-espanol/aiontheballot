import { messages } from '@aiontheballot/i18n/messages';
import { expect, type Page, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  addMembership,
  asOwner,
  createAccount as createTestAccount,
  deleteAccounts,
  PASSWORD,
  visitorAddress,
} from '../accounts.js';
import { expectAccessible } from '../axe.js';
import { ADMIN_URL, AUTH, PLATFORM_NAME, TENANT_URL } from '../servers.js';
import { totpCode } from '../totp.js';

const en = messages.en.auth;
const es = messages.es.auth;

// Each test is its own visitor at the gateway, so tests running together don't share the sign-in rate limit.
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-e2e-client-address': visitorAddress() });
});

// The accounts this worker created, deleted when it is done, so the local database doesn't collect them.
const created: string[] = [];
const createAccount = async () => {
  const account = await createTestAccount();
  created.push(account.id);
  return account;
};
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

/** The form's own alert: Next's route announcer is an alert too. */
const formAlert = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

const signIn = async (page: Page, email: string, password = PASSWORD) => {
  await page.goto(`${ADMIN_URL}/sign-in`);
  await page.getByLabel(en.signIn.email).fill(email);
  await page.getByLabel(en.signIn.password, { exact: true }).fill(password);
  await page.getByRole('button', { name: en.signIn.submit }).click();
};

/** Enrols TOTP through the pages, checking each step, and returns what they showed. */
const enrol = async (page: Page, landing = `${ADMIN_URL}/`) => {
  await expect(page).toHaveURL(`${ADMIN_URL}/two-factor/enrol`);
  await page.getByLabel(en.enrol.password, { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: en.enrol.begin }).click();
  await expect(page.getByRole('heading', { name: en.enrol.scanTitle })).toBeFocused();
  await expect(page.getByRole('img', { name: en.enrol.qrLabel })).toBeVisible();
  const key = (await page.getByTestId('setup-key').textContent()) ?? '';
  await page.getByLabel(en.enrol.code, { exact: true }).fill(totpCode(key));
  await page.getByRole('button', { name: en.enrol.verify }).click();
  const codes = page.getByRole('list', { name: en.enrol.backupList }).getByRole('listitem');
  await expect(codes).toHaveCount(10);
  const backupCodes = await codes.allTextContents();
  await page.getByRole('button', { name: en.enrol.done }).click();
  await expect(page).toHaveURL(landing);
  return { key, backupCodes };
};

const signOut = async (page: Page) => {
  await page.getByRole('button', { name: en.home.signOut }).click();
  await expect(page).toHaveURL(`${ADMIN_URL}/sign-in`);
};

test.describe('admin sign-in (editorial workflow A4)', () => {
  test("sends a signed-out visitor to sign-in, in the browser's language, with nothing for search engines", async ({
    page,
  }) => {
    const response = await page.goto(ADMIN_URL);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(`${ADMIN_URL}/sign-in`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.signIn.title);
    await expect(page).toHaveTitle(`${en.signIn.title} · ${PLATFORM_NAME}`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
    expect(await page.context().cookies()).toEqual([]);
    await expectAccessible(page);
  });

  test.describe('in Spanish', () => {
    test.use({ locale: 'es-ES' });

    test('speaks Spanish to a Spanish browser', async ({ page }) => {
      await page.goto(ADMIN_URL);
      await expect(page.locator('html')).toHaveAttribute('lang', 'es');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(es.signIn.title);
      await expect(page).toHaveTitle(`${es.signIn.title} · ${PLATFORM_NAME}`);
      await expect(page.getByLabel(es.signIn.email)).toBeVisible();
      await expect(page.getByLabel(es.signIn.password, { exact: true })).toBeVisible();
      await page.getByLabel(es.signIn.email).fill('nadie@example.org');
      await page.getByLabel(es.signIn.password, { exact: true }).fill(PASSWORD);
      await page.getByRole('button', { name: es.signIn.submit }).click();
      await expect(formAlert(page)).toHaveText(`⚠ ${es.errors.invalidCredentials}`);
      await expectAccessible(page);
    });
  });

  test('says when the email or password is wrong, and then that there were too many attempts', async ({
    page,
  }) => {
    const { email } = await createAccount();
    await signIn(page, email, 'una contraseña equivocada');
    const alert = formAlert(page);
    await expect(alert).toHaveText(`⚠ ${en.errors.invalidCredentials}`);
    await expectAccessible(page);
    // Better Auth's limit for sign-in: three attempts per address every ten seconds.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.getByRole('button', { name: en.signIn.submit }).click();
      await expect(page.getByRole('button', { name: en.signIn.submit })).toBeEnabled();
    }
    await page.getByRole('button', { name: en.signIn.submit }).click();
    await expect(alert).toHaveText(`⚠ ${en.errors.rateLimited}`);
  });

  test('enrols a new account in TOTP, shows its backup codes once, and signs it in', async ({
    page,
  }) => {
    const { email, name } = await createAccount();
    await signIn(page, email);
    await expect(page).toHaveURL(`${ADMIN_URL}/two-factor/enrol`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.enrol.title);
    await expectAccessible(page);
    // No language switch here: a reload would lose the secret and the backup codes, which are shown once.
    await expect(page.getByRole('form', { name: messages.en.admin.language })).toHaveCount(0);

    await page.getByLabel(en.enrol.password, { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: en.enrol.begin }).click();
    await expect(page.getByRole('img', { name: en.enrol.qrLabel })).toBeVisible();
    await expectAccessible(page);
    // A wrong code leaves the account without TOTP.
    await page.getByLabel(en.enrol.code, { exact: true }).fill('000000');
    await page.getByRole('button', { name: en.enrol.verify }).click();
    await expect(formAlert(page)).toHaveText(`⚠ ${en.errors.invalidCode}`);
    await expect(page.getByLabel(en.enrol.code, { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );

    const key = (await page.getByTestId('setup-key').textContent()) ?? '';
    await page.getByLabel(en.enrol.code, { exact: true }).fill(totpCode(key));
    await page.getByRole('button', { name: en.enrol.verify }).click();
    await expect(page.getByRole('heading', { name: en.enrol.backupTitle })).toBeFocused();
    await expect(
      page.getByRole('list', { name: en.enrol.backupList }).getByRole('listitem'),
    ).toHaveCount(10);
    await expectAccessible(page);
    await page.getByRole('button', { name: en.enrol.done }).click();

    await expect(page).toHaveURL(`${ADMIN_URL}/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.home.title);
    await expect(page.getByText(en.home.signedInAs.replace('{name}', name))).toBeVisible();
    await expect(page.getByText(en.home.noTenants)).toBeVisible();
    await expectAccessible(page);

    // The session is a host-only cookie, sent only over https (or to localhost), out of scripts' reach.
    const cookies = await page.context().cookies();
    expect(cookies.map((cookie) => cookie.name)).toEqual(['__Host-admin.session_token']);
    expect(cookies[0]).toMatchObject({
      domain: 'localhost',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    });
    expect(await page.evaluate('document.cookie')).toBe('');

    // Signed in, the sign-in and enrolment pages lead home.
    await page.goto(`${ADMIN_URL}/sign-in`);
    await expect(page).toHaveURL(`${ADMIN_URL}/`);
    await page.goto(`${ADMIN_URL}/two-factor/enrol`);
    await expect(page).toHaveURL(`${ADMIN_URL}/`);
  });

  test('gives a password-only session nothing but enrolment', async ({ page }) => {
    const { email } = await createAccount();
    await signIn(page, email);
    await expect(page).toHaveURL(`${ADMIN_URL}/two-factor/enrol`);
    for (const path of ['/', '/two-factor']) {
      await page.goto(`${ADMIN_URL}${path}`);
      await expect(page).toHaveURL(`${ADMIN_URL}/two-factor/enrol`);
    }
    const tenants = await page.request.get(`${ADMIN_URL}/api/tenants`);
    expect(tenants.status()).toBe(401);
    // Someone on the wrong account, or a shared computer, can leave.
    await page.goto(`${ADMIN_URL}/two-factor/enrol`);
    await signOut(page);
    expect(await page.context().cookies()).toEqual([]);
  });

  test('asks an enrolled account for its code at every sign-in, and refuses a wrong one', async ({
    page,
  }) => {
    const { email } = await createAccount();
    await signIn(page, email);
    const { key } = await enrol(page);
    await signOut(page);
    expect(await page.context().cookies()).toEqual([]);

    await signIn(page, email);
    await expect(page).toHaveURL(`${ADMIN_URL}/two-factor`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.challenge.title);
    await expectAccessible(page);
    // Before the code, only the short-lived cookie that holds the sign-in exists, and nothing past it opens.
    expect((await page.context().cookies()).map((cookie) => cookie.name)).toEqual([
      '__Host-admin.two_factor',
    ]);
    expect((await page.request.get(`${ADMIN_URL}/api/tenants`)).status()).toBe(401);

    await page.getByLabel(en.challenge.code, { exact: true }).fill('000000');
    await page.getByRole('button', { name: en.challenge.submit }).click();
    await expect(formAlert(page)).toHaveText(`⚠ ${en.errors.invalidCode}`);
    await expect(page.getByLabel(en.challenge.code, { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expectAccessible(page);

    await page.getByLabel(en.challenge.code, { exact: true }).fill(totpCode(key));
    await page.getByRole('button', { name: en.challenge.submit }).click();
    await expect(page).toHaveURL(`${ADMIN_URL}/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.home.title);
  });

  test('signs in once with each backup code', async ({ page }) => {
    const { email } = await createAccount();
    await signIn(page, email);
    const { backupCodes } = await enrol(page);
    const [code = ''] = backupCodes;
    await signOut(page);

    await signIn(page, email);
    await page.getByRole('button', { name: en.challenge.useBackupCode }).click();
    const field = page.getByLabel(en.challenge.backupCode, { exact: true });
    await expect(field).toBeFocused();
    await expectAccessible(page);
    await field.fill(code);
    await page.getByRole('button', { name: en.challenge.submit }).click();
    await expect(page).toHaveURL(`${ADMIN_URL}/`);
    await signOut(page);

    await signIn(page, email);
    await page.getByRole('button', { name: en.challenge.useBackupCode }).click();
    await page.getByLabel(en.challenge.backupCode, { exact: true }).fill(code);
    await page.getByRole('button', { name: en.challenge.submit }).click();
    await expect(formAlert(page)).toHaveText(`⚠ ${en.errors.invalidCode}`);
  });

  test('takes a member of one site to its dashboard, once signed in with the second factor', async ({
    page,
  }) => {
    const { id, email } = await createAccount();
    await addMembership(id, 'ejemplo-a');
    await signIn(page, email);
    await enrol(page, `${ADMIN_URL}/t/ejemplo-a`);
    // In the admin's language where the tenant has one (the seeds name ejemplo-a in English too).
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Example tenant A');
  });

  // The gateway's half of ADR-0002 T8: a public host routes nothing to the API's /api, so sign-in isn't there at all
  // (the API's own refusal of other hosts is in its tests).
  test('has no sign-in on a public host', async ({ page }) => {
    await page.goto(TENANT_URL);
    const answer = await page.evaluate(async () => {
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'persona@example.org',
          password: 'una contraseña de ejemplo',
        }),
      });
      return response.status;
    });
    expect(answer).toBe(404);
    expect(await page.context().cookies()).toEqual([]);
  });

  test("signs the owner's first account in: the command's link sets its password, once", async ({
    page,
  }) => {
    const email = `persona-${crypto.randomUUID()}@example.org`;
    // The command as the owner runs it in an API pod, with the API's sign-in settings, answering its two questions.
    const stdout = execFileSync(
      'node',
      [fileURLToPath(new URL('../../apps/api/dist/create-account.js', import.meta.url))],
      {
        input: `${email}\nPersona de ejemplo\n`,
        encoding: 'utf8',
        env: {
          ...process.env,
          BETTER_AUTH_SECRET: AUTH.secret,
          ADMIN_ORIGIN: ADMIN_URL,
          PLATFORM_NAME,
        },
      },
    );
    const id = /Account created: (\S+)/.exec(stdout)?.[1] ?? '';
    created.push(id);
    // The SQL that makes it a platform admin adds nothing until the account has enrolled TOTP.
    const makeAdmin = /^\s*(INSERT INTO app\.platform_admins .*)$/m.exec(stdout)?.[1] ?? '';
    expect(makeAdmin).toContain(`'${id}'`);
    expect(await asOwner(makeAdmin)).toBe(0);
    expect(stdout).not.toContain(email);
    const link = /(\S+\/set-password#token=\S+)/.exec(stdout)?.[1] ?? '';
    const token = new URLSearchParams(new URL(link).hash.slice(1)).get('token') ?? '';
    expect(token).not.toBe('');

    // The token is in the fragment: no request the page makes carries it, and the page takes it out of the address bar.
    const requests: string[] = [];
    page.on('request', (request) => {
      requests.push(`${request.url()} ${JSON.stringify(request.headers())}`);
    });
    // Opened first without its token (cut off when pasted, say), then pasted whole into the same tab: only the
    // fragment changes, and the page reads it as it arrives.
    await page.goto(`${ADMIN_URL}/set-password`);
    await expect(page.getByText(en.setPassword.missing)).toBeVisible();
    await page.goto(link);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.setPassword.title);
    await expect(page.getByLabel(en.setPassword.password, { exact: true })).toBeVisible();
    await expect.poll(() => page.url()).toBe(`${ADMIN_URL}/set-password`);
    await expectAccessible(page);
    // Its language can change on the way: the page redraws in place, so the token, which only the page holds, and what
    // was typed stay.
    await page.getByLabel(en.setPassword.password, { exact: true }).fill(PASSWORD);
    await page
      .getByRole('form', { name: messages.en.admin.language })
      .getByRole('button', { name: 'Español' })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(es.setPassword.title);
    await expect(page.getByLabel(es.setPassword.password, { exact: true })).toHaveValue(PASSWORD);
    await page
      .getByRole('form', { name: messages.es.admin.language })
      .getByRole('button', { name: 'English' })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.setPassword.title);
    const password = page.getByLabel(en.setPassword.password, { exact: true });
    const confirm = page.getByLabel(en.setPassword.confirm, { exact: true });
    await password.fill(PASSWORD);
    await confirm.fill(`${PASSWORD}!`);
    await page.getByRole('button', { name: en.setPassword.submit }).click();
    await expect(formAlert(page)).toHaveText(`⚠ ${en.errors.passwordsDiffer}`);
    await expect(confirm).toBeFocused();
    // The same slip again is announced again: the alert's text is put back, not left in place.
    const announced = formAlert(page).locator('p');
    await page.evaluate(
      `document.querySelector('#set-password-error p').setAttribute('data-seen', '')`,
    );
    await page.getByRole('button', { name: en.setPassword.submit }).click();
    await expect(announced).toHaveText(`⚠ ${en.errors.passwordsDiffer}`);
    await expect(announced).not.toHaveAttribute('data-seen');
    await confirm.fill(PASSWORD);
    await page.getByRole('button', { name: en.setPassword.submit }).click();
    await expect(page.getByRole('heading', { name: en.setPassword.doneTitle })).toBeFocused();
    await expectAccessible(page);
    // Only the API's own call carries it, in its JSON body, which this list doesn't hold.
    expect(requests.filter((line) => line.includes(token))).toEqual([]);

    // The link works once. Followed from another page, as a link is (from this one, only its fragment would change).
    await page.goto(`${ADMIN_URL}/sign-in`);
    await page.goto(link);
    await page.getByLabel(en.setPassword.password, { exact: true }).fill(PASSWORD);
    await page.getByLabel(en.setPassword.confirm, { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: en.setPassword.submit }).click();
    await expect(formAlert(page)).toHaveText(`⚠ ${en.errors.invalidLink}`);

    await signIn(page, email);
    await enrol(page);
    expect(await asOwner(makeAdmin)).toBe(1);
    // A platform admin sees every tenant.
    await page.reload();
    await expect(page.getByRole('listitem').filter({ hasText: 'Example tenant A' })).toBeVisible();
  });

  test('asks for the link on the set-password page without one', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/set-password`);
    await expect(page.getByText(en.setPassword.missing)).toBeVisible();
    await expect(page.getByLabel(en.setPassword.password, { exact: true })).toHaveCount(0);
  });
});
